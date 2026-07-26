-- Ops: retention clocks and the unverified alarm (#33).
--
-- TWO CLOCKS, TWO JOBS, and they must stay independent.
--
--   * Unconverted GUEST play rows purge at 90 days. A guest who never signed in has
--     no history to protect and no streak that survives them; the rows are only
--     useful while the guest might still merge them onto an account.
--   * MOVE LOGS drop on their own, much shorter clock, while the play rows they
--     belonged to are kept FOREVER — history and streaks depend on those. This split
--     is the entire reason `play_move_logs` is a separate table rather than a column.
--
-- They are two functions rather than one with a flag precisely so neither can delete
-- the other's data: a bug in the move-log sweep cannot reach a play row, and a bug in
-- the guest purge cannot orphan a log belonging to a converted account.
--
-- THE ALARM. A replay mismatch flags a play `unverified`, and the spec's reasoning is
-- that a mismatch is as likely a SOLVER-CORE DEPLOY SKEW as a cheater. So a spike in
-- `unverified` means "suspect a deploy first", not "suspect a cheating wave" — and an
-- alarm nobody can see is not an alarm. `unverified_rate` makes it observable, with
-- the versions an operator needs beside it.

-- ---------------------------------------------------------------------------
-- purge_guest_plays — the 90-day clock on unconverted guest rows.
--
-- The `guest_id is not null` predicate is doing the load-bearing work. The merge
-- re-keys a guest's rows to their user id, so a converted player's rows have
-- `user_id` set and `guest_id` null and can never match this. A row belonging to an
-- account is therefore unreachable from here by construction, not by care.
-- ---------------------------------------------------------------------------

create function public.purge_guest_plays(p_older_than_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with doomed as (
    delete from public.plays
    where guest_id is not null
      and user_id is null
      and started_at < now() - make_interval(days => p_older_than_days)
    returning 1
  )
  select count(*) into v_deleted from doomed;

  -- The move log goes with its play (FK cascade), which is correct here: the play
  -- itself is being deleted, so there is nothing left for the log to be evidence of.
  return v_deleted;
end;
$$;

comment on function public.purge_guest_plays(integer) is
  'Deletes UNCONVERTED guest play rows older than N days (default 90). Cannot touch a row with a user_id, so a merged account''s history is unreachable from here.';

-- ---------------------------------------------------------------------------
-- purge_move_logs — the shorter, independent clock on forensic data.
--
-- Deletes only from `play_move_logs`. The play rows stay. A log is forensic data
-- for bot detection and "replay your solve"; a play row is the player's history and
-- their streak, and those are kept indefinitely.
-- ---------------------------------------------------------------------------

create function public.purge_move_logs(p_older_than_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with doomed as (
    delete from public.play_move_logs l
    using public.plays p
    where l.play_id = p.id
      and p.started_at < now() - make_interval(days => p_older_than_days)
    returning 1
  )
  select count(*) into v_deleted from doomed;
  return v_deleted;
end;
$$;

comment on function public.purge_move_logs(integer) is
  'Drops move logs older than N days (default 30) while KEEPING their play rows forever. The separate retention clock that justifies play_move_logs being its own table.';

-- ---------------------------------------------------------------------------
-- unverified_rate — make the deploy alarm visible.
--
-- Returns a daily rate over a recent window, with the generator and move-log format
-- versions in play on each day. The versions are what turn "the rate jumped" into a
-- diagnosis: a spike that begins on the day a version changed is a deploy skew, and
-- one that does not is worth a closer look.
-- ---------------------------------------------------------------------------

create function public.unverified_rate(p_days integer default 14)
returns table (
  day date,
  completed_plays bigint,
  unverified_plays bigint,
  unverified_pct numeric,
  generator_versions integer[],
  move_log_versions smallint[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.dublin_date(p.completed_at) as day,
    count(*) as completed_plays,
    count(*) filter (where p.unverified) as unverified_plays,
    round(100.0 * count(*) filter (where p.unverified) / nullif(count(*), 0), 2) as unverified_pct,
    array_agg(distinct s.generator_version) filter (where s.generator_version is not null),
    array_agg(distinct l.format_version) filter (where l.format_version is not null)
  from public.plays p
  left join public.puzzle_solutions s on s.puzzle_id = p.puzzle_id
  left join public.play_move_logs l on l.play_id = p.id
  where p.completed_at is not null
    and p.completed_at >= now() - make_interval(days => p_days)
  group by 1
  order by 1 desc;
$$;

comment on function public.unverified_rate(integer) is
  'Daily unverified rate over a recent window, with the generator_version and move-log format versions in play each day. A SPIKE MEANS "SUSPECT A DEPLOY SKEW FIRST", not a cheating wave — the versions beside it are how you tell.';

-- Operator tooling, not player surface. service_role only: none of these are things
-- a client should be able to run, and the rate query reads across every identity.
revoke all on function public.purge_guest_plays(integer) from public;
revoke all on function public.purge_move_logs(integer) from public;
revoke all on function public.unverified_rate(integer) from public;

grant execute on function public.purge_guest_plays(integer) to service_role;
grant execute on function public.purge_move_logs(integer) to service_role;
grant execute on function public.unverified_rate(integer) to service_role;
