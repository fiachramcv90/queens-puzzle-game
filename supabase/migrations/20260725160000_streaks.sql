-- Streaks (issue #26).
--
-- The reason to come back tomorrow. A streak is CONSECUTIVE DAYS THE DAILY WAS
-- SOLVED, measured against the single global Dublin rollover (dublin_today()), never
-- a per-user local midnight. Solving is the trigger; attempting is not.
--
-- The crux this migration keeps honest: a streak BREAKS BY THE PASSAGE OF TIME, NOT
-- BY AN EVENT. Nobody writes a row when a player fails to show up, so a raw stored
-- `current_streak` is wrong the moment a player lapses. Three columns cache the streak
-- on `profiles` (claimed by the profiles migration: current_streak, longest_streak,
-- last_streak_date), written by the same server function that records a solve — but
-- EVERY READ goes through `effective_current_streak`, which returns the cached value
-- only while `last_streak_date >= dublin_today() - 1` and 0 otherwise. That helper IS
-- the at-risk rule, expressed once instead of scattered across clients. Pure derivation
-- was rejected because the friends board puts a streak on every row.
--
-- Three functions land here:
--   * effective_current_streak(current, last) — the time-aware READ helper.
--   * bump_streak(user, solved_date)          — the incremental WRITE on a solve.
--   * recompute_streaks(user)                 — the authoritative REBUILD from plays.
-- and two existing functions are extended: complete_play bumps the streak on an
-- eligible solve, and merge_guest_plays recomputes after re-keying a guest's history.

-- ---------------------------------------------------------------------------
-- Reserved room for the deferred freeze/grace mechanic — CLAIMED here, NOT built.
--
-- v1 hard-resets on one fully-elapsed unsolved day; a freeze/grace fast-follow is
-- explicitly deferred, but "the data model leaves room for it without a migration". A
-- freeze is per-user persistent state (banked freezes that auto-cover a missed day), so
-- the room it needs is a column that exists now. This one is nullable and defaulted, so
-- it changes nothing today: the read helper and recompute below ignore it, and no row
-- carries a value until the mechanic ships. When it does, it plugs into the SAME two
-- choke points — effective_current_streak (widen the tolerance when a freeze covers the
-- gap) and recompute_streaks (spend a banked freeze instead of breaking the run) —
-- rather than forcing a schema change. Same pattern #25 used to claim the streak columns.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column streak_freezes_remaining integer;

comment on column public.profiles.streak_freezes_remaining is
  'Reserved for the deferred freeze/grace fast-follow (issue #26): banked freezes that would auto-cover a missed day. Nullable and unused in v1 — the streak functions ignore it — so the mechanic can later read/spend it through effective_current_streak and recompute_streaks without a migration.';

-- ---------------------------------------------------------------------------
-- effective_current_streak — the at-risk read, expressed ONCE.
--
-- Returns the cached current streak while it is still live (solved today, → held at
-- N+1; or solved yesterday and pending today, → held at N, at-risk), and 0 the moment
-- a whole day has elapsed unsolved. STABLE, not immutable: it reads dublin_today().
--
-- This is the function the friends board (and every other multi-row read of someone
-- else's streak) calls per row, so the passage-of-time reset never has to be a write
-- and never has to be re-derived by a client. A player must never be told they have
-- lost something they still have all day to keep — so "solved yesterday" still reads
-- as the full cached streak, at-risk, right up until the day elapses.
-- ---------------------------------------------------------------------------

create function public.effective_current_streak(
  p_current_streak integer,
  p_last_streak_date date
)
returns integer
language sql
stable
as $$
  select case
    when p_last_streak_date is not null and p_last_streak_date >= public.dublin_today() - 1
      then p_current_streak
    else 0
  end;
$$;

comment on function public.effective_current_streak(integer, date) is
  'The time-aware streak read: the cached current_streak while last_streak_date >= dublin_today() - 1 (solved today, or solved yesterday and pending today = at-risk), else 0. The single home of the at-risk/reset rule; the friends board calls it per row.';

grant execute on function public.effective_current_streak(integer, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- bump_streak — the incremental write, applied when an eligible solve is recorded.
--
-- Called from complete_play for the FIRST completed, non-archive play of a daily by a
-- signed-in player (see the eligibility check there). Guests have no profile row, so a
-- missing profile is a silent no-op — a guest's streak is derived client-side and
-- rebuilt server-side by recompute after the merge.
--
-- The chain rule, in stored terms:
--   * already counted this date (or a later one)  → no-op (idempotent; also the
--     replay guard's backstop).
--   * last_streak_date = solved_date - 1          → continue: current + 1.
--   * otherwise (a gap, or the very first solve)  → reset the run to 1.
-- longest only ever grows (greatest), so a bad week never erases a good year. The
-- passage-of-time reset is NOT applied here — it lives in the read helper, so the
-- stored current_streak is always "as of the last solve", never silently zeroed.
--
-- SECURITY DEFINER so complete_play (also definer) reaches profiles; locked to
-- service_role for the repair hatch, never the Data API roles.
-- ---------------------------------------------------------------------------

create function public.bump_streak(p_user_id uuid, p_solved_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date;
  v_current integer;
  v_new integer;
begin
  select last_streak_date, current_streak
    into v_last, v_current
  from public.profiles
  where id = p_user_id
  for update;
  if not found then
    return; -- a guest, or no profile yet: nothing to cache here
  end if;

  -- This date already counts (a replay of today, or an out-of-order older solve):
  -- leave the cache as it is. recompute_streaks is the authority for reorderings.
  if v_last is not null and v_last >= p_solved_date then
    return;
  end if;

  v_new := case
    when v_last = p_solved_date - 1 then v_current + 1
    else 1
  end;

  update public.profiles
  set current_streak = v_new,
      longest_streak = greatest(longest_streak, v_new),
      last_streak_date = p_solved_date
  where id = p_user_id;
end;
$$;

comment on function public.bump_streak(uuid, date) is
  'Incrementally advance a signed-in player''s streak cache for a newly-recorded eligible solve. Continues the run when the prior counted day was solved_date - 1, else resets to 1; longest only grows. A missing profile (guest) is a no-op. Called by complete_play.';

revoke all on function public.bump_streak(uuid, date) from public;
grant execute on function public.bump_streak(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- recompute_streaks — the authoritative rebuild of all three fields from `plays`
-- alone. Its existence is what makes the cache a cache rather than a second source of
-- truth: the merge calls it after re-keying a guest's history, and it is the repair
-- hatch if the incremental cache is ever suspected wrong.
--
-- Eligibility is DERIVED, never stored: a play counts iff it is completed and was
-- solved within the daily's own window — `puzzle_date = dublin_date(started_at)`. An
-- archived daily played today has started_at today but a past puzzle_date, so the two
-- disagree and it is streak-neutral: no backfill, ever. `replay` does not matter to
-- the date SET (a day is a day), so distinct eligible puzzle_dates are the input.
--
-- From the sorted distinct dates: longest = the longest consecutive run, current = the
-- run ending at the most recent eligible date, last_streak_date = that most recent
-- date. The time-aware reset is applied at READ time by effective_current_streak, not
-- here — recompute stores the run "as of the last solve", exactly as bump_streak does,
-- so the two agree.
-- ---------------------------------------------------------------------------

create function public.recompute_streaks(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_longest integer := 0;
  v_current integer := 0;
  v_last date := null;
begin
  with eligible as (
    -- One row per day this user solved within that day's own window.
    select distinct puzzle_date as d
    from public.plays
    where user_id = p_user_id
      and completed_at is not null
      and puzzle_date = public.dublin_date(started_at)
  ),
  ordered as (
    select d, row_number() over (order by d) as rn
    from eligible
  ),
  -- Consecutive dates share a constant (d - rn) offset, so grouping by it isolates
  -- each unbroken run; a one-day gap shifts the offset and starts a new group.
  runs as (
    select count(*)::int as len, max(d) as run_end
    from ordered
    group by d - (rn * interval '1 day')
  )
  select
    coalesce(max(len), 0),
    coalesce((select len from runs order by run_end desc limit 1), 0),
    (select max(run_end) from runs)
  into v_longest, v_current, v_last
  from runs;

  update public.profiles
  set current_streak = v_current,
      longest_streak = v_longest,
      last_streak_date = v_last
  where id = p_user_id;
end;
$$;

comment on function public.recompute_streaks(uuid) is
  'Authoritative rebuild of current_streak, longest_streak and last_streak_date from `plays` alone. Eligibility is derived (completed AND puzzle_date = dublin_date(started_at)); archived-daily solves are streak-neutral. Used by the merge and as a repair hatch; agrees with the incremental bump_streak.';

revoke all on function public.recompute_streaks(uuid) from public;
grant execute on function public.recompute_streaks(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- complete_play — extended to advance the streak cache on an eligible solve.
--
-- Same signature and body as the play-lifecycle migration, with one addition after
-- the row is closed: if this is a signed-in player's FIRST completed play of the daily
-- (not a replay) AND the solve landed within the daily's own window
-- (puzzle_date = dublin_date(started_at), i.e. not an archived board), bump the streak.
-- Guests fall through (user_id is null). The whole thing stays in one transaction, so
-- the solve and its streak effect commit together or not at all.
-- ---------------------------------------------------------------------------

create or replace function public.complete_play(
  p_token uuid,
  p_elapsed_ms bigint,
  p_mistakes integer,
  p_stale boolean,
  p_unverified boolean,
  p_replay boolean,
  p_move_log jsonb,
  p_format_version smallint
)
returns public.plays
language plpgsql
security definer
set search_path = public
as $$
declare
  v_play public.plays;
begin
  select * into v_play from public.plays where token = p_token for update;
  if not found then
    raise exception 'unknown token' using errcode = 'no_data_found';
  end if;
  if v_play.completed_at is not null then
    raise exception 'already submitted' using errcode = 'unique_violation';
  end if;

  update public.plays
  set completed_at = now(),
      elapsed_ms = p_elapsed_ms,
      mistakes = p_mistakes,
      stale = p_stale,
      unverified = p_unverified,
      replay = p_replay
  where id = v_play.id
  returning * into v_play;

  insert into public.play_move_logs (play_id, move_log, format_version)
  values (v_play.id, p_move_log, p_format_version)
  on conflict (play_id) do update
    set move_log = excluded.move_log,
        format_version = excluded.format_version;

  -- Streak: a signed-in player's first completed play of a daily solved within its own
  -- window. A replay (a later attempt) carries no streak effect; an archived daily
  -- (puzzle_date < today) has started_at today, so the two dates disagree and it is
  -- streak-neutral. An assisted or stale solve still counts — integrity lives on the
  -- leaderboard, not the streak. Guests (user_id null) fall through to client-side.
  if v_play.user_id is not null
     and not v_play.replay
     and v_play.puzzle_date = public.dublin_date(v_play.started_at) then
    perform public.bump_streak(v_play.user_id, v_play.puzzle_date);
  end if;

  return v_play;
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_guest_plays — extended to rebuild the streak after re-keying a guest's plays.
--
-- The re-key folds the guest's play history onto the account; the streak that history
-- represents must survive that fold. Rather than replay each solve through
-- bump_streak, we call the authoritative recompute once at the end — the guest's dates
-- are now the account's dates, and recompute derives all three fields from them. This
-- is the server half of "a guest's streak survives the merge"; the client accrued it
-- locally, and the account now carries it for real. Same signature and body as the
-- profiles migration, plus the recompute call.
-- ---------------------------------------------------------------------------

create or replace function public.merge_guest_plays(p_user_id uuid, p_guest_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dates date[];
  v_merged integer;
begin
  if p_user_id is null or p_guest_id is null then
    raise exception 'both a user id and a guest id are required'
      using errcode = 'check_violation';
  end if;

  perform 1 from public.plays where guest_id = p_guest_id for update;

  select coalesce(array_agg(distinct puzzle_date), '{}') into v_dates
  from public.plays where guest_id = p_guest_id;

  if array_length(v_dates, 1) is null then
    return 0; -- nothing to merge; the idempotent no-op path
  end if;

  delete from public.plays gp
  where gp.guest_id = p_guest_id
    and gp.completed_at is null
    and exists (
      select 1 from public.plays up
      where up.user_id = p_user_id
        and up.puzzle_date = gp.puzzle_date
        and up.completed_at is null
    );

  with base as (
    select puzzle_date, max(attempt_no) as max_no
    from public.plays
    where user_id = p_user_id
    group by puzzle_date
  ),
  incoming as (
    select
      p.id,
      p.puzzle_date,
      row_number() over (partition by p.puzzle_date order by p.started_at, p.id) as rn
    from public.plays p
    where p.guest_id = p_guest_id
  )
  update public.plays pl
  set user_id = p_user_id,
      guest_id = null,
      attempt_no = coalesce(b.max_no, 0) + i.rn
  from incoming i
  left join base b on b.puzzle_date = i.puzzle_date
  where pl.id = i.id;

  get diagnostics v_merged = row_count;

  with completed_ranked as (
    select
      id,
      row_number() over (partition by puzzle_date order by completed_at, id) as rn
    from public.plays
    where user_id = p_user_id
      and completed_at is not null
      and puzzle_date = any(v_dates)
  )
  update public.plays pl
  set replay = (cr.rn > 1)
  from completed_ranked cr
  where pl.id = cr.id;

  -- The guest's solves are now the account's. Rebuild the streak cache from the merged
  -- history so the streak the guest accrued survives the fold.
  perform public.recompute_streaks(p_user_id);

  return v_merged;
end;
$$;
