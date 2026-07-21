-- Puzzle tables, the rollover rule, and schedule visibility (issue #21).
--
-- This migration lands the puzzle half of the database and the single home of the
-- rollover rule that three later systems lean on (schedule visibility, streak
-- at-risk, the ranked filter). After it runs, a client can ask "what is today's
-- board?" and get a region map, a size and a tier — and ask for tomorrow's and get
-- nothing.
--
-- RLS is enabled in the SAME migration that creates each table — never bolted on
-- later, when a window of exposure would already have existed.

-- ---------------------------------------------------------------------------
-- The rollover rule: the daily flips at 00:00 Europe/Dublin, one global instant
-- for every player.
--
-- Dublin observes DST, so the UTC instant of that flip shifts twice a year. The
-- date is therefore computed IN-ZONE (`at time zone 'Europe/Dublin'`), never as a
-- fixed UTC offset — a fixed offset would be wrong for half the year and its bug
-- would surface silently at each DST transition.
--
-- The rule has two functions so it has exactly one home AND stays testable:
--   * dublin_date(instant) — IMMUTABLE, pure: the rule itself, tested at fixed
--     instants on both sides of both DST transitions.
--   * dublin_today()       — STABLE wrapper over now(): what policies call.
-- ---------------------------------------------------------------------------

create function public.dublin_date(instant timestamptz)
returns date
language sql
immutable
as $$
  select (instant at time zone 'Europe/Dublin')::date;
$$;

comment on function public.dublin_date(timestamptz) is
  'The Europe/Dublin calendar date of an instant, computed in-zone so it is correct across DST. The rollover rule; dublin_today() is its now()-bound wrapper.';

create function public.dublin_today()
returns date
language sql
stable
as $$
  select public.dublin_date(now());
$$;

comment on function public.dublin_today() is
  'Today''s daily date: the Europe/Dublin calendar date of now(). Single home of the 00:00 Dublin rollover, load-bearing in schedule visibility, streak at-risk and the ranked filter.';

grant execute on function public.dublin_date(timestamptz) to anon, authenticated, service_role;
grant execute on function public.dublin_today() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- puzzles — the PUBLIC half of a puzzle: board_size, region_map, tier. No
-- solution. Readable iff a puzzle_schedule row exists for it with date <=
-- dublin_today(); an unscheduled pool puzzle stays invisible even to a guessed id.
-- ---------------------------------------------------------------------------

create table public.puzzles (
  id uuid primary key default gen_random_uuid(),
  board_size smallint not null,
  -- The N×N region map: region_map[row][col] is a region id in 0..N-1. The public
  -- half — this ships to the client. The solution never does (see puzzle_solutions).
  region_map jsonb not null,
  -- The five display tiers, kept in lockstep with DIFFICULTY_TIERS in
  -- src/lib/solver/difficulty.ts (the domain language is fixed). Changing the set
  -- means editing both this constraint and that list.
  tier text not null check (tier in ('Intro', 'Easy', 'Medium', 'Hard', 'Expert')),
  created_at timestamptz not null default now()
);

comment on table public.puzzles is
  'The public half of a puzzle (size, region map, tier). Readable only once scheduled for today or a past date.';

alter table public.puzzles enable row level security;

-- ---------------------------------------------------------------------------
-- puzzle_solutions — 1:1 with puzzles, keyed by puzzle_id. The server-only half:
-- the hidden solution, the difficulty score and its raw signals, the generator
-- version, and the UNIQUE canonical hash the pool dedupes on.
--
-- RLS is enabled with ZERO policies: unreachable by anon and authenticated
-- entirely, under any query or join. This is a deliberate STRUCTURAL wall, chosen
-- over column-level GRANTs precisely because a grant is silently undone by a later
-- migration, whereas RLS-deny-by-default is not.
-- ---------------------------------------------------------------------------

create table public.puzzle_solutions (
  puzzle_id uuid primary key references public.puzzles (id) on delete cascade,
  -- The single legal full board as one {row, col} per row.
  solution jsonb not null,
  difficulty_score double precision not null,
  -- The raw signals the score came from — retained verbatim so post-launch
  -- recalibration is a data question, never a migration to recover lost inputs.
  difficulty_signals jsonb not null,
  generator_version integer not null,
  -- The canonical hash over (size, region_map, solution). Unique-constrained so a
  -- player is never served the same board twice.
  canonical_hash text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.puzzle_solutions is
  'The server-only half of a puzzle. RLS on with zero policies: a structural wall, never reachable by anon or authenticated.';

alter table public.puzzle_solutions enable row level security;

-- ---------------------------------------------------------------------------
-- puzzle_schedule — which puzzle is the daily on which date. PK date, unique
-- puzzle_id (a puzzle is scheduled at most once). Readable iff date <=
-- dublin_today().
--
-- The `date <= dublin_today()` predicate does two jobs. It closes an attack — a
-- schedule visible days ahead would let someone pre-solve tomorrow's board and
-- post a four-second time the instant Dublin rolls over. And it delivers the full
-- archive for free: every past daily stays permanently readable, guests included.
-- ---------------------------------------------------------------------------

create table public.puzzle_schedule (
  date date primary key,
  puzzle_id uuid not null unique references public.puzzles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.puzzle_schedule is
  'Which puzzle is the daily on which date. A row is visible only once its date is today or past (Dublin).';

alter table public.puzzle_schedule enable row level security;

-- ---------------------------------------------------------------------------
-- Grants. anon and authenticated may SELECT the two public tables (RLS then
-- decides which rows); service_role gets full access to all three (it also
-- bypasses RLS). puzzle_solutions is never granted to the Data API roles — the
-- REVOKE is belt-and-braces behind the RLS wall.
-- ---------------------------------------------------------------------------

grant select on public.puzzles to anon, authenticated;
grant select on public.puzzle_schedule to anon, authenticated;

revoke all on public.puzzle_solutions from anon, authenticated;

grant all on public.puzzles to service_role;
grant all on public.puzzle_solutions to service_role;
grant all on public.puzzle_schedule to service_role;

-- ---------------------------------------------------------------------------
-- Policies. Only SELECT is exposed to the Data API roles; all writes go through
-- service_role, which bypasses RLS. puzzle_solutions gets no policy at all.
-- ---------------------------------------------------------------------------

-- A schedule row is visible once its date has arrived in Dublin.
create policy "Scheduled dailies are readable once their date has arrived"
  on public.puzzle_schedule
  for select
  to anon, authenticated
  using (date <= public.dublin_today());

-- A puzzle is visible iff it has a schedule row whose date has arrived. The
-- subquery runs under the caller's RLS, so it can only match already-visible
-- schedule rows — the two policies compose into "readable iff scheduled for today
-- or a past date".
create policy "Puzzles are readable once scheduled for today or a past date"
  on public.puzzles
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.puzzle_schedule s
      where s.puzzle_id = puzzles.id
        and s.date <= public.dublin_today()
    )
  );
