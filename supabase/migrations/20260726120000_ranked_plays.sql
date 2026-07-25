-- The ranked-play filter, in one place (issue #27).
--
-- The build spec is emphatic that ranked eligibility is a RULE, not config, and that
-- it must live in exactly one home so it cannot drift across the leaderboard reads
-- that will consume it (#29 global, #31 friends). This migration lands that home: the
-- `ranked_plays` view. Nothing selects from it yet — the leaderboard functions arrive
-- with those tickets — but the archive slice needs the rule to exist and be provable
-- now, because "an archive play never appears on that day's frozen leaderboard" is one
-- of its acceptance criteria and this view is what makes it true.
--
-- A play is ranked iff it is:
--   * completed;
--   * not a replay (the FIRST completed attempt of the daily for this identity — the
--     stored flag complete_play maintains, so "first completed" is honoured even when
--     the first attempt was abandoned and a later one is the first to finish);
--   * not assisted, not stale, not unverified (the three server-set integrity events);
--   * played WITHIN the daily's own window — puzzle_date = dublin_date(started_at).
--
-- The last clause is the load-bearing one for the archive. An archived daily played
-- today has a past puzzle_date but a started_at of today, so the two disagree and the
-- play is excluded — that day's board can never accept a new entry, no matter how
-- clean or how fast the archive solve was. It is the SAME derived predicate that makes
-- an archive solve streak-neutral in complete_play, kept identical on purpose: freezing
-- the board and freezing the streak are one rule, not two that could fall out of step.
-- The client mirrors it in isRanked() (src/lib/history/history.ts) for guest records
-- that never reach a server row; this is its authoritative, server-side side.
--
-- Note the deliberate use of `not replay` rather than the spec's shorthand
-- `attempt_no = 1`: replay is the flag the rest of the system already maintains and it
-- captures "first COMPLETED" correctly, whereas attempt_no = 1 would wrongly drop a
-- ranked solve whose first attempt was merely opened and abandoned.

-- security_invoker so the caller's RLS on `plays` still applies: a signed-in player
-- reading the view sees only their own ranked rows (select-own), and anon sees none.
-- The leaderboard functions that need to cross identities will be SECURITY DEFINER and
-- project explicit columns, exactly as the data-model decision (#14) requires — a
-- permissive base-table policy is never introduced.
create view public.ranked_plays
with (security_invoker = on)
as
select
  p.id,
  p.user_id,
  p.guest_id,
  p.puzzle_id,
  p.puzzle_date,
  p.attempt_no,
  p.started_at,
  p.completed_at,
  p.elapsed_ms,
  p.mistakes,
  p.hints_used
from public.plays p
where p.completed_at is not null
  and not p.replay
  and not p.assisted
  and not p.stale
  and not p.unverified
  and p.puzzle_date = public.dublin_date(p.started_at);

comment on view public.ranked_plays is
  'The single home of the ranked-play filter: completed, first-completed (not replay), not assisted/stale/unverified, and played within the daily''s own window (puzzle_date = dublin_date(started_at)). The in-window clause freezes archived boards. security_invoker, so the caller''s select-own RLS on plays applies; leaderboard functions (#29/#31) project across identities as SECURITY DEFINER.';

-- The Data API roles may select the view (RLS on plays then narrows to own rows);
-- service_role gets it for the leaderboard functions to build on.
grant select on public.ranked_plays to authenticated, service_role;
