-- Durable, path-independent rate limiting for the play lifecycle (follow-up to #23).
--
-- The #23 rate limit gated only traffic through the SvelteKit proxy, using an
-- in-memory fixed window. Two gaps followed, both flagged in hooks.server.ts as
-- deliberate follow-ups: the guest-capable Edge Functions (verify_jwt = false)
-- are reachable directly and skip the proxy hook entirely, and a per-instance
-- Map evaporates on a serverless cold start, so the nominal caps were far looser
-- than config claimed.
--
-- This closes both by moving the authoritative cap INTO the functions, keyed on
-- the identity (guest_id / user_id) rather than the IP: enforced wherever the
-- call arrives (proxy or direct), and durable because the counter lives in
-- Postgres. The numbers still come from src/lib/config — this is only the store
-- and the atomic check, never the values.
--
-- Posture is unchanged from #23: defend against casual tampering, not a
-- determined attacker. Identity is body-supplied, so rotating guest UUIDs still
-- buys fresh budgets; that residual is accepted, and this is strictly stronger
-- than an IP window that a cold start could wipe.

-- ---------------------------------------------------------------------------
-- play_rate_limits — one fixed-window counter per (action, identity, window).
--
-- A structural wall like play_move_logs: RLS on with ZERO policies, so anon and
-- authenticated can never read or write it under any query. service_role (the
-- Edge Functions) bypasses RLS and is the only caller, always through the
-- SECURITY DEFINER function below.
-- ---------------------------------------------------------------------------

create table public.play_rate_limits (
  -- The limited action: 'start' or 'submit'. heartbeat is unlimited by design.
  action text not null,
  -- The identity the budget belongs to — a guest_id or a user_id. No foreign key:
  -- a guest_id is a client-minted UUID with no auth row, same as in `plays`.
  identity uuid not null,
  -- The start of the fixed window this row counts, floored to the window size.
  window_start timestamptz not null,
  -- Requests seen in this window. Compared against the config limit by the checker.
  count integer not null default 0,
  primary key (action, identity, window_start)
);

comment on table public.play_rate_limits is
  'Fixed-window rate-limit counters for the play Edge Functions, keyed by (action, identity). Written only by check_play_rate_limit on service_role; RLS on with zero policies — a structural wall, unreachable by anon or authenticated.';

alter table public.play_rate_limits enable row level security;

revoke all on public.play_rate_limits from anon, authenticated;
grant all on public.play_rate_limits to service_role;

-- ---------------------------------------------------------------------------
-- check_play_rate_limit — record one request against (action, identity) and say
-- whether it is allowed, mirroring the in-memory limiter it supersedes: a request
-- is allowed up to `p_limit` within the window, then blocked until the window
-- rolls over. The window size (p_window_ms) and budget (p_limit) come from the
-- caller, which reads them from the config bundle — never hard-coded here.
--
-- Atomic by construction: the upsert increments under the row's own lock, so a
-- concurrent flood cannot race two callers past the cap. `allowed` is decided on
-- the post-increment count, so exactly `p_limit` requests pass per window.
-- ---------------------------------------------------------------------------

create function public.check_play_rate_limit(
  p_action text,
  p_identity uuid,
  p_limit integer,
  p_window_ms bigint
)
returns table (allowed boolean, retry_after_ms bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_seconds double precision := p_window_ms / 1000.0;
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz :=
    to_timestamp(floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds);
  v_window_end timestamptz := v_window_start + make_interval(secs => v_window_seconds);
  v_count integer;
begin
  -- Self-trim this identity+action's expired windows (PK-indexed, cheap). A global
  -- sweep of other identities' stale rows is the retention job's concern, not the
  -- hot path.
  delete from public.play_rate_limits
  where action = p_action and identity = p_identity and window_start < v_window_start;

  insert into public.play_rate_limits as l (action, identity, window_start, count)
  values (p_action, p_identity, v_window_start, 1)
  on conflict (action, identity, window_start)
    do update set count = l.count + 1
  returning l.count into v_count;

  allowed := v_count <= p_limit;
  retry_after_ms := case
    when allowed then 0
    else greatest(0, ceil(extract(epoch from (v_window_end - clock_timestamp())) * 1000))::bigint
  end;
  return next;
end;
$$;

-- Lock the checker to service_role only, same as the other lifecycle functions:
-- SECURITY DEFINER runs as the owner, so a leaked grant would be a write path.
revoke all on function public.check_play_rate_limit(text, uuid, integer, bigint) from public;
grant execute on function public.check_play_rate_limit(text, uuid, integer, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- load_play_for_submit — redefined to also return the play's owner, so `submit`
-- can enforce its per-identity rate limit on the true owner of the token without
-- a second round-trip or a client-supplied identity. Everything else is unchanged
-- from the #23 definition. Return-type changes require a drop + recreate, so the
-- grants are re-applied below.
-- ---------------------------------------------------------------------------

drop function public.load_play_for_submit(uuid, uuid);

create function public.load_play_for_submit(p_token uuid, p_puzzle_id uuid)
returns table (
  status text,
  play_id uuid,
  owner_user_id uuid,
  owner_guest_id uuid,
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
  owner_user_id := v_play.user_id;
  owner_guest_id := v_play.guest_id;
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

revoke all on function public.load_play_for_submit(uuid, uuid) from public;
grant execute on function public.load_play_for_submit(uuid, uuid) to service_role;
