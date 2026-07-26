-- Friends: codes, invites, requests, blocks (#30) and the friends board (#31).
--
-- The governing constraint is that NO PUBLIC DIRECTORY EXISTS. There is no handle,
-- no name search, no way to enumerate players. The only way to reach someone is a
-- friend code they chose to give you, and resolving a code is a security-definer
-- function rather than a select, so a code cannot be brute-forced into a profile
-- listing and a blocked user cannot resolve you at all.
--
-- `friendships` stores ONE canonically-ordered row per pair, never a mirrored pair.
-- Mirrored two-row storage was rejected because every accept, unfriend and block
-- becomes a two-row transaction that can half-fail into a friendship that exists for
-- only one person. Unfriend is a single DELETE. The accepted consequence is that a
-- `pending` row is visible to the requester before the other party acts — that is
-- their own outgoing request, which is fine.
--
-- `blocks` is separate and DIRECTIONAL, because blocking is asymmetric, must outlive
-- the unfriend that usually accompanies it, and must suppress requests from someone
-- you were never friends with.

-- ---------------------------------------------------------------------------
-- friendships
-- ---------------------------------------------------------------------------

create table public.friendships (
  -- Canonical ordering: the pair (a,b) and (b,a) are the same row, so a duplicate
  -- request in the other direction collides with the primary key instead of
  -- creating a second, contradictory friendship.
  user_low uuid not null references public.profiles (id) on delete cascade,
  user_high uuid not null references public.profiles (id) on delete cascade,
  -- Who asked. The row is unordered by design, so direction has to be carried
  -- explicitly — it is what decides who is allowed to accept.
  requester_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_low, user_high),
  constraint friendships_canonical_order check (user_low < user_high),
  constraint friendships_requester_is_participant
    check (requester_id = user_low or requester_id = user_high)
);

create index friendships_user_high_idx on public.friendships (user_high);
create index friendships_status_idx on public.friendships (status);

comment on table public.friendships is
  'One canonically-ordered row per pair (user_low < user_high). requester_id carries direction; only the OTHER party may accept. Unfriend is a single DELETE.';

alter table public.friendships enable row level security;

-- Participant-only read. A player sees their own friendships and their own
-- outgoing requests, and nothing else — there is no query that lists other
-- people's relationships.
create policy "Participants read their friendships"
  on public.friendships for select
  to authenticated
  using (auth.uid() = user_low or auth.uid() = user_high);

-- No client INSERT/UPDATE/DELETE policies at all. Every mutation goes through the
-- security-definer functions below, which is what lets them enforce the rules that
-- a policy cannot express: the block check, the soft cap, and "only the non-requester
-- may accept".

-- ---------------------------------------------------------------------------
-- blocks
-- ---------------------------------------------------------------------------

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

comment on table public.blocks is
  'Directional. Separate from friendships because blocking is asymmetric, outlives the unfriend beside it, and must suppress requests from a stranger.';

alter table public.blocks enable row level security;

-- A player reads only the blocks they created. Deliberately NOT "or blocked_id =
-- auth.uid()": being able to list who has blocked you is itself a disclosure, and
-- the point of a block is that the blocked party cannot see it.
create policy "Blockers read their own blocks"
  on public.blocks for select
  to authenticated
  using (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/**
 * Whether either party has blocked the other. Used by every function below, so a
 * block suppresses resolution, requests, acceptance and board visibility alike from
 * one definition rather than four.
 */
create function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

/** Generate a friend code in the QNS-XXXX shape, avoiding ambiguous glyphs. */
create function public.generate_friend_code()
returns text
language sql
volatile
as $$
  -- No I, O, 0 or 1: a friend code gets read aloud and typed from a photo, and those
  -- four are where that goes wrong.
  select 'QNS-' || string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32 + 1)::int, 1), ''
  )
  from generate_series(1, 4);
$$;

-- ---------------------------------------------------------------------------
-- ensure_friend_code — mint this player's code on first use.
--
-- Codes are minted lazily rather than in the new-user trigger: most players never
-- open friends, and an unused code is one more string to collide on. Collisions are
-- handled by retry, which is why this loops rather than trusting one draw.
-- ---------------------------------------------------------------------------

create function public.ensure_friend_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_existing text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select friend_code into v_existing from public.profiles where id = auth.uid();
  if v_existing is not null then
    return v_existing;
  end if;

  for _ in 1..10 loop
    v_code := public.generate_friend_code();
    begin
      update public.profiles set friend_code = v_code where id = auth.uid();
      return v_code;
    exception when unique_violation then
      -- Drawn a code someone already holds. Try again.
    end;
  end loop;

  raise exception 'could not allocate a friend code' using errcode = 'internal_error';
end;
$$;

-- ---------------------------------------------------------------------------
-- regenerate_friend_code — retire a code posted somewhere regrettable.
--
-- The old code stops resolving the instant this returns, which is what invalidates
-- every outstanding invite link: the links embed the code, and nothing else.
-- ---------------------------------------------------------------------------

create function public.regenerate_friend_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  for _ in 1..10 loop
    v_code := public.generate_friend_code();
    begin
      update public.profiles set friend_code = v_code where id = auth.uid();
      return v_code;
    exception when unique_violation then
    end;
  end loop;

  raise exception 'could not allocate a friend code' using errcode = 'internal_error';
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_friend_code — the ONLY way to turn a code into a person.
--
-- Security definer and block-aware. It returns exactly one profile's id and display
-- name, and only for an exact code match, so it can never become an enumeration
-- surface: there is no prefix search, no listing, and a wrong code is simply empty.
-- A blocked user resolves nothing, so a block is invisible rather than an error that
-- confirms the account exists.
-- ---------------------------------------------------------------------------

create function public.resolve_friend_code(p_code text)
returns table (
  user_id uuid,
  display_name text,
  already_friends boolean,
  request_pending boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_them uuid;
  v_name text;
begin
  if v_me is null then
    return;
  end if;

  select id, profiles.display_name into v_them, v_name
  from public.profiles
  where friend_code = upper(trim(p_code));

  if v_them is null or v_them = v_me then
    return;
  end if;
  if public.is_blocked_between(v_me, v_them) then
    return;
  end if;

  user_id := v_them;
  display_name := v_name;
  select
    coalesce(f.status = 'accepted', false),
    coalesce(f.status = 'pending', false)
  into already_friends, request_pending
  from public.friendships f
  where f.user_low = least(v_me, v_them) and f.user_high = greatest(v_me, v_them);

  already_friends := coalesce(already_friends, false);
  request_pending := coalesce(request_pending, false);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- request_friendship — send a pending request. No instant-add, ever.
--
-- The soft cap (~1000) is an abuse backstop rather than a product limit; the spec
-- asks for no fine-grained rate limiting in v1.
-- ---------------------------------------------------------------------------

create function public.request_friendship(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_them uuid;
  v_low uuid;
  v_high uuid;
  v_existing public.friendships;
  v_count integer;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select id into v_them from public.profiles where friend_code = upper(trim(p_code));
  if v_them is null then
    return 'unknown-code';
  end if;
  if v_them = v_me then
    return 'self';
  end if;
  -- A block is reported as an unknown code, deliberately: a distinct "you are
  -- blocked" reply would confirm both that the account exists and that they blocked
  -- you, which is exactly what a block is meant to withhold.
  if public.is_blocked_between(v_me, v_them) then
    return 'unknown-code';
  end if;

  -- The soft cap. Mirrors `limits.friendsPerAccount` in src/lib/config — SQL cannot
  -- read the TypeScript config, so the two are kept in step by hand. Changing one
  -- means changing the other; it is an abuse backstop, not a product limit, so it is
  -- expected to move rarely if ever.
  select count(*) into v_count
  from public.friendships
  where (user_low = v_me or user_high = v_me) and status = 'accepted';
  if v_count >= 1000 then
    return 'limit-reached';
  end if;

  v_low := least(v_me, v_them);
  v_high := greatest(v_me, v_them);

  select * into v_existing from public.friendships
  where user_low = v_low and user_high = v_high;

  if found then
    if v_existing.status = 'accepted' then
      return 'already-friends';
    end if;
    -- A pending row already exists. If THEY asked first, this request is really an
    -- acceptance — the two people have now both said yes, and making them find the
    -- other's request to click accept would be a worse product for no gain.
    if v_existing.requester_id = v_them then
      update public.friendships
      set status = 'accepted', accepted_at = now()
      where user_low = v_low and user_high = v_high;
      return 'accepted';
    end if;
    return 'already-pending';
  end if;

  insert into public.friendships (user_low, user_high, requester_id, status)
  values (v_low, v_high, v_me, 'pending');
  return 'requested';
end;
$$;

-- ---------------------------------------------------------------------------
-- respond_to_request — accept or decline, and ONLY as the non-requester.
--
-- This is the rule that makes friendship consensual, and the reason accepting is a
-- function rather than an RLS-guarded update: a policy can restrict which ROWS you
-- may write, but "you may set status to accepted only if you did not ask" is a
-- condition on the row's own contents relative to you.
-- ---------------------------------------------------------------------------

create function public.respond_to_request(p_other uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_low uuid;
  v_high uuid;
  v_existing public.friendships;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  v_low := least(v_me, p_other);
  v_high := greatest(v_me, p_other);

  select * into v_existing from public.friendships
  where user_low = v_low and user_high = v_high and status = 'pending';
  if not found then
    return 'no-request';
  end if;
  if v_existing.requester_id = v_me then
    return 'not-yours';
  end if;

  if p_accept then
    update public.friendships
    set status = 'accepted', accepted_at = now()
    where user_low = v_low and user_high = v_high;
    return 'accepted';
  end if;

  -- Decline deletes the row rather than storing a 'declined' state: keeping one
  -- would be a permanent record that someone said no, readable by the requester,
  -- and would block a later request that both parties wanted.
  delete from public.friendships where user_low = v_low and user_high = v_high;
  return 'declined';
end;
$$;

-- ---------------------------------------------------------------------------
-- unfriend — symmetric by construction. One row, one DELETE, no half state.
-- ---------------------------------------------------------------------------

create function public.unfriend(p_other uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  delete from public.friendships
  where user_low = least(v_me, p_other) and user_high = greatest(v_me, p_other);
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- block_user — block, and clear any friendship in the same transaction.
--
-- Blocking someone you are friends with must also unfriend them, or they keep
-- appearing on your board. The block outlives that unfriend, which is exactly why
-- the two are separate tables.
-- ---------------------------------------------------------------------------

create function public.block_user(p_other uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  if p_other = v_me then
    return false;
  end if;

  delete from public.friendships
  where user_low = least(v_me, p_other) and user_high = greatest(v_me, p_other);

  insert into public.blocks (blocker_id, blocked_id)
  values (v_me, p_other)
  on conflict do nothing;
  return true;
end;
$$;

create function public.unblock_user(p_other uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  delete from public.blocks where blocker_id = v_me and blocked_id = p_other;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- my_friends — the friends list, with pending requests in both directions.
--
-- One call rather than three, because the page renders all three sections together
-- and three round trips would let them disagree about the same moment.
-- ---------------------------------------------------------------------------

create function public.my_friends()
returns table (
  user_id uuid,
  display_name text,
  status text,
  -- 'incoming' (they asked, you decide), 'outgoing' (you asked), or 'friend'.
  direction text,
  current_streak integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    return;
  end if;

  return query
  select
    other.id,
    other.display_name,
    f.status,
    case
      when f.status = 'accepted' then 'friend'
      when f.requester_id = v_me then 'outgoing'
      else 'incoming'
    end,
    -- The TIME-AWARE read, not the raw cached column: a friend who has lapsed shows
    -- 0 rather than the number they were on when they stopped playing.
    public.effective_current_streak(other.current_streak, other.last_streak_date)
  from public.friendships f
  join public.profiles other
    on other.id = case when f.user_low = v_me then f.user_high else f.user_low end
  where (f.user_low = v_me or f.user_high = v_me)
    -- A block suppresses the row on both sides, so blocking someone removes them
    -- from your list immediately even if a friendship row somehow survived.
    and not public.is_blocked_between(v_me, other.id)
  order by (f.status = 'pending' and f.requester_id <> v_me) desc, other.display_name asc;
end;
$$;

-- ---------------------------------------------------------------------------
-- friends_leaderboard(date) — the comparison that actually motivates (#31).
--
-- Same rows as the global board, a DIFFERENT projection and a different filter, and
-- that asymmetry is precisely what a permissive RLS policy cannot express — which is
-- why both boards are security-definer functions over an RLS-locked base table.
--
-- Two differences from `global_leaderboard`, both deliberate:
--
--   * ASSISTED PLAYS ARE INCLUDED, with the hint count and an explicit badge. Among
--     friends a fast assisted solve should be legible as exactly what it is, rather
--     than hidden. This reads `plays` directly rather than `ranked_plays`, because
--     `ranked_plays` exists to exclude exactly what this board wants to show.
--   * Full transparency: time, mistakes, hints, assisted, and current streak.
--
-- Still excluded: `stale` and `unverified` plays, and any attempt after the first.
-- A stale play is an eight-hour tab left open, not an achievement, and showing an
-- unverified one would present a number the server could not stand behind.
-- ---------------------------------------------------------------------------

create function public.friends_leaderboard(p_date date default null)
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
      and p.attempt_no = 1
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
  'One daily, mutual accepted friends only, ranked by solve time then fewest mistakes then earliest submission. Includes ASSISTED plays with their hint count — the opposite of the global board — because among friends a fast assisted solve should be legible as what it is. Streaks come from the time-aware read helper.';

-- ---------------------------------------------------------------------------
-- Grants. Every function is definer and callable by a signed-in player; the tables
-- themselves stay unreachable for write, and `anon` gets nothing — friends requires
-- an account on both sides.
-- ---------------------------------------------------------------------------

revoke all on function public.is_blocked_between(uuid, uuid) from public;
revoke all on function public.generate_friend_code() from public;
revoke all on function public.ensure_friend_code() from public;
revoke all on function public.regenerate_friend_code() from public;
revoke all on function public.resolve_friend_code(text) from public;
revoke all on function public.request_friendship(text) from public;
revoke all on function public.respond_to_request(uuid, boolean) from public;
revoke all on function public.unfriend(uuid) from public;
revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.my_friends() from public;
revoke all on function public.friends_leaderboard(date) from public;

grant execute on function public.ensure_friend_code() to authenticated;
grant execute on function public.regenerate_friend_code() to authenticated;
grant execute on function public.resolve_friend_code(text) to authenticated;
grant execute on function public.request_friendship(text) to authenticated;
grant execute on function public.respond_to_request(uuid, boolean) to authenticated;
grant execute on function public.unfriend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.friends_leaderboard(date) to authenticated;

-- is_blocked_between and generate_friend_code are internal helpers: they are called
-- from inside the definer functions above (which run as owner) and are deliberately
-- NOT reachable by a client. Exposing is_blocked_between would let anyone probe
-- whether two given accounts have blocked each other.
grant execute on function public.is_blocked_between(uuid, uuid) to service_role;
grant execute on function public.generate_friend_code() to service_role;
