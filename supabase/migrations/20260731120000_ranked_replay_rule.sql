-- `replay` is the ranked-replay rule, on both boards (issue #51).
--
-- THE DECISION. #18 originally described `replay` as DERIVED — `attempt_no > 1` — on
-- the principle that the three stored flags (`assisted`, `stale`, `unverified`) are
-- server-set events and everything else is a derivation. `replay` was shipped stored
-- instead, and #51 settles that it stays stored, because it is an event of exactly the
-- same kind as the other three: at the moment this play was submitted, a COMPLETED
-- play already existed for this identity and daily. `attempt_no > 1` is a different
-- proposition — "this is not the first row I opened" — and it is the wrong one.
--
-- Why it is the wrong one, concretely. `start_play` RETURNS the existing open play
-- rather than minting a second, so a player who opens the daily, wanders off and comes
-- back gets the same play and the same attempt_no. The two rules therefore agree on
-- the whole ordinary single-identity path. Where they part company is the guest merge:
-- `merge_guest_plays` renumbers attempt_no as max(account's) + rn, so a guest's clean
-- solve folded onto an account that had merely OPENED the daily lands at attempt_no 2
-- with replay = false. The stored rule ranks that solve. `attempt_no > 1` would drop
-- it — and, because `complete_play` gates `bump_streak` on `not replay`, would cost
-- the player their streak day at the exact moment they commit to an account.
--
-- #18's own anti-cheat section already states the rule this way ("ranked eligibility
-- attaches to the FIRST COMPLETED play of a daily per identity"); the `attempt_no > 1`
-- shorthand in the data-model section was the outlier, and #18 is amended to match.
--
-- WHAT THIS MIGRATION FIXES. `ranked_plays` filters on `not replay` (#27), but
-- `friends_leaderboard` (#31) never read that view — it re-implements the filter
-- inline, because the friends board deliberately INCLUDES assisted plays and the view
-- exists to exclude them. In doing so it reached for the `attempt_no = 1` shorthand.
-- So both rules were live at once, on two boards, over one base table: the merged
-- solve above appeared on the global board and was missing from the friends board.
-- The projection difference between the two boards is deliberate; this one was not.
--
-- The friends board still cannot select from `ranked_plays` (assisted is the whole
-- point of it), so the duplication of the remaining clauses stands as #31 designed it.
-- What must not differ is what "a later attempt" means, and now it does not.

-- The column comment carries the rule at the schema level, where the next person to
-- add a write path to `plays` will meet it.
comment on column public.plays.replay is
  'Server-set EVENT, written by complete_play at submit: a completed play already existed for this identity and daily. NOT attempt_no > 1 — start_play returns the open play rather than minting a new one, and the merge renumbers attempt_no, so the two diverge on a merged solve (#51). Gates both ranked eligibility (ranked_plays, friends_leaderboard) and the streak bump.';

create or replace function public.friends_leaderboard(p_date date default null)
returns table (
  rank bigint,
  user_id uuid,
  display_name text,
  elapsed_ms bigint,
  mistakes integer,
  hints_used integer,
  assisted boolean,
  current_streak integer,
  is_you boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_date date := coalesce(p_date, public.dublin_today());
begin
  if v_me is null then
    return;
  end if;

  return query
  with circle as (
    -- Mutual, accepted friendships only. A pending request is not a friend, and a
    -- blocked user is never on this board regardless of what row survives.
    select case when f.user_low = v_me then f.user_high else f.user_low end as friend_id
    from public.friendships f
    where (f.user_low = v_me or f.user_high = v_me)
      and f.status = 'accepted'
      and not public.is_blocked_between(
        v_me, case when f.user_low = v_me then f.user_high else f.user_low end)
    union
    select v_me
  ),
  board as (
    select
      row_number() over (
        order by p.elapsed_ms asc, p.mistakes asc nulls last, p.completed_at asc, p.id asc
      ) as board_rank,
      p.user_id as owner_id,
      p.elapsed_ms as ms,
      p.mistakes as mistake_count,
      p.hints_used as hints,
      p.assisted as was_assisted
    from public.plays p
    join circle c on c.friend_id = p.user_id
    where p.puzzle_date = v_date
      and p.completed_at is not null
      -- The FIRST COMPLETED attempt, the same way ranked_plays says it (#51). Was
      -- `attempt_no = 1`, which disagreed with the global board on a merged solve.
      and not p.replay
      and not p.stale
      and not p.unverified
      -- Streak-eligible: the play began on the daily's own date. An archive solve is
      -- recorded to history but never appears on that day's frozen board.
      and public.dublin_date(p.started_at) = p.puzzle_date
  )
  select
    b.board_rank,
    b.owner_id,
    pr.display_name,
    b.ms,
    b.mistake_count,
    b.hints,
    b.was_assisted,
    public.effective_current_streak(pr.current_streak, pr.last_streak_date),
    b.owner_id = v_me
  from board b
  join public.profiles pr on pr.id = b.owner_id
  order by b.board_rank;
end;
$$;

comment on function public.friends_leaderboard(date) is
  'One daily, mutual accepted friends only, ranked by solve time then fewest mistakes then earliest submission. Includes ASSISTED plays with their hint count — the opposite of the global board — because among friends a fast assisted solve should be legible as what it is. Excludes replay, stale and unverified plays and archive solves, on the same terms as ranked_plays (#51). Streaks come from the time-aware read helper.';

-- create or replace preserves grants, but state them again so a fresh replay of the
-- migrations from scratch cannot leave the function unreachable.
revoke all on function public.friends_leaderboard(date) from public;
grant execute on function public.friends_leaderboard(date) to authenticated;
