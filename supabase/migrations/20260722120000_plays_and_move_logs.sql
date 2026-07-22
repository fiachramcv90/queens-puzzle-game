-- The server-authoritative play lifecycle (issue #23).
--
-- A solve has to mean something, so the play row is minted, timed and closed by
-- the server — never by the client, and for guests as much as for signed-in
-- players. This migration lands the two tables that record it. There is
-- deliberately NO client write path to either: every write goes through the
-- start/heartbeat/submit Edge Functions on service_role. RLS is enabled in the
-- same migration that creates each table, so no window of exposure ever exists.
--
-- Posture: defend hard against casual tampering (edited requests, reload-to-retry).
-- A determined paper-solve is unfixable while the board renders client-side and is
-- accepted as such — we don't build defences that only stop the honest.

-- ---------------------------------------------------------------------------
-- plays — one row per attempt at a daily, by one identity.
--
-- Ownership is user_id XOR guest_id: a signed-in player or an anonymous guest,
-- never both and never neither (the CHECK enforces it). A guest_id is a
-- client-minted UUID from localStorage, so it has no foreign key; a user_id
-- points at the auth user.
--
-- The row carries TWO dates on purpose: puzzle_date (which daily this is) and the
-- date implied by started_at (when it was actually played). Streak eligibility is
-- derived from their agreement — an archive board played today does not extend a
-- streak. A third "is archive play" boolean would only invite the two to disagree,
-- so it is left out.
--
-- The play token is this row's own random `token` UUID, validated by lookup.
-- Because every play already has a server row, an opaque stateful token is as
-- strong as a signed one with no key management, and it gains revocation and
-- duplicate-submission detection for free (a completed row rejects a second submit).
-- ---------------------------------------------------------------------------

create table public.plays (
  -- Internal identity and foreign-key target. Distinct from `token`, which is what
  -- the client holds, so the value used in URLs/joins is never the client's handle.
  id uuid primary key default gen_random_uuid(),
  -- The opaque play token handed to the client and presented to heartbeat/submit.
  token uuid not null unique default gen_random_uuid(),

  -- Exactly one owner. num_nonnulls keeps the XOR honest at the storage layer.
  user_id uuid references auth.users (id) on delete cascade,
  guest_id uuid,
  constraint plays_one_owner check (num_nonnulls(user_id, guest_id) = 1),

  puzzle_id uuid not null references public.puzzles (id) on delete cascade,
  -- The daily's date (Europe/Dublin). Compared against dublin_date(started_at)
  -- downstream to decide streak eligibility — see the two-dates note above.
  puzzle_date date not null,
  -- 1 for the first attempt at this daily, incrementing per later attempt.
  attempt_no integer not null,

  -- All server-clock. started_at is written by `start`; nothing the client sends
  -- can move it, which is what makes credited time (submitted_at - started_at)
  -- meaningful. last_heartbeat_at drives staleness; it defaults to started_at so a
  -- play that never beats is measured from its start.
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  completed_at timestamptz,

  -- Credited time in milliseconds, set at submit as wall-clock only — there is no
  -- idle-deduction path of any kind (a client-triggerable deduction is one the
  -- client can trigger mid-solve). Null until completed.
  elapsed_ms bigint,
  -- Derived server-side by replaying the move log; the client's count is ignored.
  -- Null when the solve was accepted but could not be verified (see `unverified`).
  mistakes integer,

  -- Assist bookkeeping. No hints or assists exist yet (the reveal feature is a
  -- later slice), so these carry their defaults for now.
  hints_used integer not null default 0,
  assisted boolean not null default false,

  -- No heartbeat for 30 minutes ⇒ stale: the play still completes, still saves, and
  -- still counts for the streak — walking away must not cost someone their day. It
  -- only drops out of ranking.
  stale boolean not null default false,
  -- The move log did not replay to the submitted board. Board legality is checked
  -- directly against the public region_map and cannot skew, so the solve still
  -- counts; this flag doubles as a solver-core deploy alarm.
  unverified boolean not null default false,
  -- Ranked eligibility attaches to the FIRST completed play of a daily per identity;
  -- a later completed attempt is flagged replay — practice, saved to history, no
  -- streak effect.
  replay boolean not null default false,

  created_at timestamptz not null default now()
);

comment on table public.plays is
  'One attempt at a daily by one identity (user XOR guest). Written only by the start/heartbeat/submit Edge Functions on service_role; RLS exposes select-own and no client write path.';

-- One OPEN play per identity per date, enforced in the database rather than the
-- Edge Function, so a raced or retried `start` can never mint a second live play.
-- Two partial indexes because the owner is one of two nullable columns; both
-- ignore completed rows, so a finished attempt does not block starting the next.
create unique index plays_one_open_per_user
  on public.plays (user_id, puzzle_date)
  where user_id is not null and completed_at is null;

create unique index plays_one_open_per_guest
  on public.plays (guest_id, puzzle_date)
  where guest_id is not null and completed_at is null;

-- Attempt numbers are unique per identity per date, so history has a stable,
-- gap-checkable sequence and a duplicated attempt row cannot slip in.
create unique index plays_attempt_no_per_user
  on public.plays (user_id, puzzle_date, attempt_no)
  where user_id is not null;

create unique index plays_attempt_no_per_guest
  on public.plays (guest_id, puzzle_date, attempt_no)
  where guest_id is not null;

-- Leaderboards and history read by (puzzle, date); index for it up front.
create index plays_puzzle_date on public.plays (puzzle_id, puzzle_date);

alter table public.plays enable row level security;

-- ---------------------------------------------------------------------------
-- play_move_logs — the forensic move log, split off from plays on purpose.
--
-- A move log is forensic data, not gameplay data: it is the largest thing in the
-- row, no player or leaderboard read path needs it, and it wants its own retention
-- clock. So it lives in its own table, 1:1 with plays (PK play_id), and gets ZERO
-- policies — unreachable by anon and authenticated under any query or join, a
-- structural wall like puzzle_solutions. It is never row-per-move: a log is only
-- ever replayed as a whole, so it is stored as a single jsonb payload.
-- ---------------------------------------------------------------------------

create table public.play_move_logs (
  play_id uuid primary key references public.plays (id) on delete cascade,
  -- The ordered move log as one jsonb array — replayed as a unit, never a move at a time.
  move_log jsonb not null,
  -- The wire format the log was written in, co-located with the log it describes,
  -- so the server knows how to replay a log a past deploy produced.
  format_version smallint not null,
  created_at timestamptz not null default now()
);

comment on table public.play_move_logs is
  'The forensic move log for a play, 1:1 with plays. RLS on with zero policies: a structural wall, never reachable by anon or authenticated. Its own retention clock.';

alter table public.play_move_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Grants. The Data API roles get SELECT on plays only (RLS then narrows to
-- select-own); they get nothing on play_move_logs. service_role — which the Edge
-- Functions use and which bypasses RLS — gets full access to both. No INSERT,
-- UPDATE or DELETE is ever granted to anon or authenticated: there is no client
-- write path.
-- ---------------------------------------------------------------------------

revoke all on public.plays from anon, authenticated;
revoke all on public.play_move_logs from anon, authenticated;

grant select on public.plays to authenticated;

grant all on public.plays to service_role;
grant all on public.play_move_logs to service_role;

-- ---------------------------------------------------------------------------
-- Policies. Only select-own is exposed, and only to authenticated. A guest has no
-- session, so anon gets no policy at all — guests learn their result from the
-- submit response, not by reading the table. play_move_logs gets no policy.
-- ---------------------------------------------------------------------------

-- A signed-in player may read their own plays and no one else's. auth.uid() is
-- wrapped in a scalar subselect so the planner evaluates it once per query.
create policy "Players read their own plays"
  on public.plays
  for select
  to authenticated
  using (user_id = (select auth.uid()));
