-- The global leaderboard (issue #29).
--
-- A board for a daily, ranked by solve time, that a competitive player can believe. The
-- rule deciding WHICH plays are on it is not written here: it lives, entirely, in the
-- `ranked_plays` view (issue #27). This migration adds only the READ PATH over that view.
-- Nothing below re-states "not assisted", "not stale", "first completed" or "in the
-- daily's own window" — a filter scattered across call sites is a filter that will drift,
-- so this function selects from the view and adds exactly one predicate of its own: which
-- daily's board you are asking for.
--
-- SECURITY DEFINER, and that is the whole design.
--   * `plays` is select-own with no client write path, and stays that way. A permissive
--     RLS policy was rejected outright: it would make the BASE TABLE world-readable for a
--     whole class of rows, so every future anti-cheat column added to `plays` would be
--     public by default. Here the projection is explicit and additive-by-choice — a new
--     column on `plays` appears on the board only if someone adds it to this RETURNS
--     TABLE on purpose.
--   * `ranked_plays` is `security_invoker`, so a player reading it directly sees only
--     their own rows. Inside this definer function the current user is the function's
--     owner, so the view resolves across every identity — which is exactly why the
--     cross-identity read is a function and not a policy.
--   * A materialized view was rejected as premature: refresh lag on a board watched
--     mid-solve is a real cost, and there is no scale problem yet to justify paying it.
--
-- What is deliberately NOT projected: `assisted`, `stale`, `unverified`, `replay`,
-- `hints_used`, the play token, the move log, `user_id` and `guest_id`. The first four
-- are constant-false on this board anyway (the view excluded them) and the rest are
-- anti-cheat or identity data with no business on a public board. Ownership is returned
-- as `is_you`, a boolean computed from `auth.uid()`, so a player can find their own row
-- without every player's account id being enumerable from the leaderboard.
--
-- The global board shows CLEAN SOLVES ONLY — no greyed slot, no "assisted" section. A
-- separate assisted board is explicitly out of scope; the friends board (#31) is where
-- assisted plays are shown, with full transparency.

-- ---------------------------------------------------------------------------
-- global_leaderboard(date, limit, offset)
--
-- Ranking: solve time, tie-broken by FEWEST MISTAKES then EARLIEST SUBMISSION, with the
-- play id as a final tiebreak so the order is total and a paged read can never show or
-- skip a row because two plays compared equal. `rank` is computed over the WHOLE board
-- before the page is cut, so page 2 starts at 26 rather than restarting at 1.
--
-- The rollover edge is accepted, not fixed: eligibility keys off `started_at` (through
-- the view's `puzzle_date = dublin_date(started_at)` clause), so a play begun at 23:58
-- and submitted at 00:03 ranks for the day it BEGAN. That is the humane answer and it
-- matches the server-authoritative-start posture.
--
-- `p_date` defaults to today's daily. A past date returns that day's frozen board — the
-- view's in-window clause means no play made after the day passed can ever join it. A
-- future date is not a leak: no play can have been started within a window that has not
-- opened, so the board is empty.
--
-- `p_limit` is clamped to 1..100 and `p_offset` to >= 0, so a client cannot ask for the
-- whole table in one read. These are guardrails on this one read path rather than tunable
-- operational numbers, so they live with the query.
-- ---------------------------------------------------------------------------

create function public.global_leaderboard(
  p_date date default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  rank bigint,
  display_name text,
  elapsed_ms bigint,
  mistakes integer,
  is_you boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with board as (
    select
      row_number() over (
        order by
          rp.elapsed_ms asc,
          rp.mistakes asc nulls last,
          rp.completed_at asc,
          rp.id asc
      ) as board_rank,
      rp.user_id as owner_id,
      rp.elapsed_ms as ms,
      rp.mistakes as mistake_count
    from public.ranked_plays rp
    where rp.puzzle_date = coalesce(p_date, public.dublin_today())
  )
  select
    b.board_rank,
    -- A guest holds a real ranked play but no profile, so the board names them "Guest"
    -- rather than dropping them: guests get real server play rows precisely so a
    -- hand-written localStorage time can never reach this board.
    coalesce(pr.display_name, 'Guest'),
    b.ms,
    b.mistake_count,
    -- coalesce, not a bare comparison: a guest's row has no owner and an anonymous
    -- caller has no `auth.uid()`, and either would make the comparison NULL. The board
    -- answers "is this you" with false in both cases rather than with an unknown.
    coalesce(b.owner_id = auth.uid(), false)
  from board b
  left join public.profiles pr on pr.id = b.owner_id
  order by b.board_rank
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

comment on function public.global_leaderboard(date, integer, integer) is
  'The global board for one daily: ranked_plays for that puzzle_date, ordered by solve time then fewest mistakes then earliest submission, paged by limit/offset. SECURITY DEFINER so it reads across identities without `plays` ever becoming cross-user readable; projects only rank, display name, solve time, mistakes and is_you — never the anti-cheat flags or an account id. Defaults to today; a past date returns that day''s frozen board.';

-- The board is public: a guest can read it without an account, exactly as the archive is
-- open to guests. `anon` and `authenticated` may execute; nobody may reach `plays`.
revoke all on function public.global_leaderboard(date, integer, integer) from public;
grant execute on function public.global_leaderboard(date, integer, integer)
  to anon, authenticated, service_role;
