-- The transactional heart of the play lifecycle (issue #23).
--
-- The start/heartbeat/submit Edge Functions do the rule-checking and replay in
-- TypeScript, but the writes that must be atomic — mint-or-return the one open
-- play, bump last_heartbeat_at, close a play and store its move log together —
-- live here as SECURITY DEFINER functions the Edge Functions call as service_role.
-- Keeping them in the database is what makes "one open play per identity" and
-- "record nothing on reject" true under races and retries, not merely likely.
--
-- Every function is executable by service_role only: the Edge Functions are the
-- sole caller, and the Data API roles must never reach a write path.

-- ---------------------------------------------------------------------------
-- start_play — mint the open play for (owner, date), or return the existing one.
--
-- Idempotent by design: a reload or a raced double-start returns the SAME open
-- play — same token, same started_at — so a player cannot reset their own timer by
-- refreshing. attempt_no is the next number for this identity and daily. The daily
-- must be visible (scheduled for today or a past Dublin date); an unscheduled or
-- future date is a hard error, closing the pre-solve-tomorrow attack.
-- ---------------------------------------------------------------------------

create function public.start_play(p_puzzle_date date, p_user_id uuid, p_guest_id uuid)
returns public.plays
language plpgsql
security definer
set search_path = public
as $$
declare
  v_puzzle_id uuid;
  v_play public.plays;
begin
  if num_nonnulls(p_user_id, p_guest_id) <> 1 then
    raise exception 'exactly one of user_id or guest_id is required'
      using errcode = 'check_violation';
  end if;

  select puzzle_id into v_puzzle_id
  from public.puzzle_schedule
  where date = p_puzzle_date and date <= public.dublin_today();
  if v_puzzle_id is null then
    raise exception 'no daily scheduled for %', p_puzzle_date
      using errcode = 'no_data_found';
  end if;

  -- Return the existing open play if there is one (the idempotent path).
  select * into v_play
  from public.plays
  where puzzle_date = p_puzzle_date
    and completed_at is null
    and ((p_user_id is not null and user_id = p_user_id)
      or (p_guest_id is not null and guest_id = p_guest_id))
  limit 1;
  if found then
    return v_play;
  end if;

  insert into public.plays (user_id, guest_id, puzzle_id, puzzle_date, attempt_no)
  values (
    p_user_id,
    p_guest_id,
    v_puzzle_id,
    p_puzzle_date,
    coalesce(
      (
        select max(attempt_no)
        from public.plays
        where puzzle_date = p_puzzle_date
          and ((p_user_id is not null and user_id = p_user_id)
            or (p_guest_id is not null and guest_id = p_guest_id))
      ),
      0
    ) + 1
  )
  returning * into v_play;
  return v_play;

exception when unique_violation then
  -- A concurrent start won the open-play race; return its row so both callers get
  -- the same play rather than one of them erroring.
  select * into v_play
  from public.plays
  where puzzle_date = p_puzzle_date
    and completed_at is null
    and ((p_user_id is not null and user_id = p_user_id)
      or (p_guest_id is not null and guest_id = p_guest_id))
  limit 1;
  return v_play;
end;
$$;

-- ---------------------------------------------------------------------------
-- heartbeat_play — liveness only. Touch last_heartbeat_at on an open play. Returns
-- false for an unknown or already-completed token so the client can shrug it off.
-- Deliberately does NOTHING to time: credited time is wall-clock at submit, and any
-- client-triggerable time effect would invert into a cheat.
-- ---------------------------------------------------------------------------

create function public.heartbeat_play(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.plays
  set last_heartbeat_at = now()
  where token = p_token and completed_at is null;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- load_play_for_submit — fetch everything the submit decision needs, plus a status
-- telling the Edge Function whether the token is usable. The three rejection cases
-- the spec names (unknown / already-submitted / wrong-puzzle) are decided here,
-- against the row, so the HTTP layer only maps a status to a code.
-- ---------------------------------------------------------------------------

create function public.load_play_for_submit(p_token uuid, p_puzzle_id uuid)
returns table (
  status text,
  play_id uuid,
  puzzle_date date,
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  region_map jsonb,
  prior_completed_exists boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_play public.plays;
begin
  select * into v_play from public.plays where token = p_token;
  if not found then
    status := 'unknown';
    return next;
    return;
  end if;
  if v_play.completed_at is not null then
    status := 'already-submitted';
    return next;
    return;
  end if;
  if v_play.puzzle_id <> p_puzzle_id then
    status := 'wrong-puzzle';
    return next;
    return;
  end if;

  status := 'ok';
  play_id := v_play.id;
  puzzle_date := v_play.puzzle_date;
  started_at := v_play.started_at;
  last_heartbeat_at := v_play.last_heartbeat_at;
  select p.region_map into region_map from public.puzzles p where p.id = v_play.puzzle_id;
  prior_completed_exists := exists (
    select 1
    from public.plays x
    where x.puzzle_date = v_play.puzzle_date
      and x.id <> v_play.id
      and x.completed_at is not null
      and ((v_play.user_id is not null and x.user_id = v_play.user_id)
        or (v_play.guest_id is not null and x.guest_id = v_play.guest_id))
  );
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_play — close the play and store its move log in one transaction. Locks
-- the row so a duplicate submit racing the first cannot both write. Re-checks the
-- token is open (the load call already did, but atomicity demands it here too).
-- ---------------------------------------------------------------------------

create function public.complete_play(
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

  return v_play;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock every function down to service_role. SECURITY DEFINER runs as the owner
-- (postgres), so a leaked grant would be a write path around RLS — revoke from
-- everyone, then grant only the Edge Functions' role.
-- ---------------------------------------------------------------------------

revoke all on function public.start_play(date, uuid, uuid) from public;
revoke all on function public.heartbeat_play(uuid) from public;
revoke all on function public.load_play_for_submit(uuid, uuid) from public;
revoke all on function public.complete_play(uuid, bigint, integer, boolean, boolean, boolean, jsonb, smallint) from public;

grant execute on function public.start_play(date, uuid, uuid) to service_role;
grant execute on function public.heartbeat_play(uuid) to service_role;
grant execute on function public.load_play_for_submit(uuid, uuid) to service_role;
grant execute on function public.complete_play(uuid, bigint, integer, boolean, boolean, boolean, jsonb, smallint) to service_role;
