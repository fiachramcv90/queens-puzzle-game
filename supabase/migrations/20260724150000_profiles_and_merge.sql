-- Accounts, profiles and the silent guest merge (issue #25).
--
-- The promise this migration keeps: signing in costs a guest nothing. A player who
-- has played for a week signs in and finds their history already there — no prompt,
-- no wizard, no migration screen. Login gates leaderboards, friends and cross-device
-- sync ONLY; it never gates solo or guest play.
--
-- Two structural pieces:
--   1. `profiles` — one row per auth user, created by trigger, holding the display
--      name, prefs, and columns claimed here for later slices (friend_code, streak
--      cache). RLS: select-own and update-own, with the sensitive columns held back
--      from the client's update grant.
--   2. `merge_guest_plays` — the transactional re-key of a guest's play rows onto a
--      user id, run silently on the first authenticated session after guest play.

-- ---------------------------------------------------------------------------
-- profiles — 1:1 with auth.users.
--
-- ONE table, not a public/private split. A blocked user must not be able to resolve
-- your display name, and friend codes must not be enumerable, so a permissive policy
-- was never on the table: the row is select-own, full stop. The friends and streak
-- features read other players' names and codes through SECURITY DEFINER functions
-- they own, not through a relaxed policy here.
--
-- display_name is deliberately NON-UNIQUE: two people can both be "Sam". Identity is
-- the account, never the name.
-- ---------------------------------------------------------------------------

create table public.profiles (
  -- PK is the auth user id: the 1:1 link, and the cascade that removes the profile
  -- when the account is deleted.
  id uuid primary key references auth.users (id) on delete cascade,

  -- The shown name. Seeded by the new-user trigger (OAuth `name`, or the email
  -- local-part — never the raw address) and editable by the player. Not unique.
  display_name text not null,
  -- The one-time confirm/edit flag. False until the player confirms their seeded
  -- name on their first SOCIAL action (opening friends or the leaderboard); the
  -- prompt never appears during solo or guest play. Set true once confirmed.
  name_confirmed boolean not null default false,

  -- The player's friend code — unique and regenerable. The COLUMN is claimed here so
  -- the profile shape is stable; its minting and rotation arrive with the friends
  -- ticket (#30). Nullable until then. Unique so a code resolves to at most one
  -- account; it is looked up only through the friends functions, never enumerable.
  friend_code text unique,

  -- Streak cache. These columns are CLAIMED here and carry their defaults; the
  -- streaks ticket (#26) populates them. Kept on the profile so a leaderboard row can
  -- show a streak without a recompute per read.
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  -- The last Dublin date that counted toward the streak. Null until the first ranked
  -- solve. Written by the streaks feature, not the client.
  last_streak_date date,

  -- Prefs that follow the player across devices once signed in. Mirrors the guest
  -- blob's local prefs; the client syncs them up on sign-in and down on load. The
  -- palette token set and the region-label toggle are defined by the accessibility
  -- ticket (#24) — stored here as their names so prefs have one home, defaulted to
  -- the base experience until that slice ships.
  palette text not null default 'classic',
  region_labels boolean not null default false,
  auto_mark_x boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user (1:1). RLS is select-own and update-own; the client update grant is columns-only so friend_code and the streak cache stay server-written. display_name is non-unique.';

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- Grants. The client may read and update its OWN profile, but only the columns it
-- owns: display_name, name_confirmed and the three prefs. friend_code and the streak
-- cache are written by SECURITY DEFINER functions on service_role, never by the
-- player — a column-level update grant is what keeps a player from setting their own
-- streak through the Data API while still honouring "update-own" for name and prefs.
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, name_confirmed, palette, region_labels, auto_mark_x)
  on public.profiles to authenticated;

grant all on public.profiles to service_role;

-- select-own: a player reads their own profile and no one else's. Wrapped in a
-- scalar subselect so the planner evaluates auth.uid() once per query.
create policy "Players read their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- update-own: a player may update their own row (narrowed to the granted columns
-- above). WITH CHECK repeats the predicate so a row cannot be re-owned by editing id.
create policy "Players update their own profile"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Keep updated_at honest without trusting the client to set it.
create function public.touch_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_profile_updated_at();

-- ---------------------------------------------------------------------------
-- handle_new_user — create the profile the instant an auth user is created, seeding
-- the display name from what the provider gave us.
--
-- Seeding rule (never store or show the raw email address):
--   OAuth  → the provider's `name` (or `full_name`), whatever it supplied.
--   Magic link → the email LOCAL-PART only (before the @).
-- If nothing usable is present, fall back to a neutral placeholder so display_name's
-- NOT NULL always holds. name_confirmed stays false, so the player gets a one-time
-- confirm/edit the first time they do something social.
--
-- SECURITY DEFINER so it can write public.profiles from the auth schema's trigger.
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  -- OAuth providers put the human name under `name` or `full_name`.
  v_name := nullif(trim(new.raw_user_meta_data ->> 'name'), '');
  if v_name is null then
    v_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  end if;
  -- Magic link: derive from the email local-part, never the raw address.
  if v_name is null and new.email is not null then
    v_name := nullif(trim(split_part(new.email, '@', 1)), '');
  end if;
  -- Last resort, so the NOT NULL always holds.
  if v_name is null then
    v_name := 'Player';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- merge_guest_plays — re-key a guest's play rows onto a user id, in one transaction.
--
-- Why this is smaller than "merge" sounds: localStorage stays the source of truth
-- for in-progress boards, prefs and offline resilience, and it is untouched here. The
-- timing facts that decide ranking already live in server `plays` rows keyed by the
-- guest UUID, and the server wins on disagreement. So the merge is a re-key of those
-- rows to the user id, not a conflict resolution over client-supplied data.
--
-- Idempotent by construction: it consumes the guest's rows (re-keying or deleting
-- them), so a second run finds no guest rows and is a no-op. Running it twice equals
-- running it once. A failed or offline attempt is safe to retry on the next load.
--
-- Two rules on two columns, written down explicitly here because conflating them
-- turns the merge into a retry-shopping mechanism:
--   * HISTORY takes best-result-per-day. Every completed attempt is preserved as its
--     own row; history (#27) reads the best per day. The merge never discards a
--     completed play, so no result is lost.
--   * RANKED keeps the FIRST completed play per day. `replay` is recomputed so the
--     earliest-started completed play per date is the ranked one (replay = false) and
--     every later completed attempt is practice (replay = true) — regardless of which
--     identity played it. Ranked eligibility is chronological, never fastest-wins, so
--     a merged-in faster time cannot displace an earlier genuine solve.
--
-- Leaderboard stays frozen for past days by construction: the merge writes nothing to
-- any leaderboard, and ranked eligibility is first-completed, so a merged improvement
-- to a past day updates history and (via #26) the streak while that day's board is
-- untouched. The open daily's board reads live from `plays`, so a better first solve
-- merged in for today is simply reflected there.
--
-- The one same-day collision the schema forbids is two OPEN plays for one identity.
-- Where the account and the guest each have an open play for the same date, the
-- account's is kept and the guest's open play is dropped ("neither completed → keep
-- the account's"). Completed guest plays are always preserved as extra attempts.
--
-- SECURITY DEFINER on service_role: the merge Edge Function is the sole caller, and
-- it passes the user id from a VERIFIED session — never from the request body.
-- ---------------------------------------------------------------------------

create function public.merge_guest_plays(p_user_id uuid, p_guest_id uuid)
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

  -- Lock every guest row for this identity so a racing merge or a concurrent submit
  -- cannot interleave with the re-key.
  perform 1 from public.plays where guest_id = p_guest_id for update;

  -- The dates the guest has any play on — the only dates the merge can affect. Used
  -- below to scope the attempt renumber and the replay recompute.
  select coalesce(array_agg(distinct puzzle_date), '{}') into v_dates
  from public.plays where guest_id = p_guest_id;

  if array_length(v_dates, 1) is null then
    return 0; -- nothing to merge; the idempotent no-op path
  end if;

  -- Drop the guest's OPEN play on any date where the account already has an open play:
  -- only one open play per identity per date is allowed, and the account's is kept.
  delete from public.plays gp
  where gp.guest_id = p_guest_id
    and gp.completed_at is null
    and exists (
      select 1 from public.plays up
      where up.user_id = p_user_id
        and up.puzzle_date = gp.puzzle_date
        and up.completed_at is null
    );

  -- Re-key the remaining guest rows onto the user, appending their attempt numbers
  -- after the account's existing max for that date. Existing user rows are never
  -- touched, so no attempt_no collision is possible during the update. attempt_no is
  -- a stable unique sequence, not a chronological one — ranked/history order is
  -- derived from started_at and completed_at below, not from the attempt number.
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

  -- Recompute `replay` across every affected date: the FIRST completed play per date
  -- is the ranked one (replay = false); every later completed attempt is practice
  -- (replay = true). "First completed" is ordered by completed_at — the same meaning
  -- the live submit path gives it (the first attempt to submit wins ranked, via
  -- prior_completed_exists), and the one that matters here because a merged guest and
  -- account played concurrently, so completion order need not match start order. Open
  -- plays are left replay = false — not completed, so they carry no ranking either way.
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

  return v_merged;
end;
$$;

-- Lock the merge down to service_role only. SECURITY DEFINER runs as the owner, so a
-- leaked grant would be a way to re-key arbitrary guest rows onto any account.
revoke all on function public.merge_guest_plays(uuid, uuid) from public;
grant execute on function public.merge_guest_plays(uuid, uuid) to service_role;
