-- Hints and assisted eligibility (#28).
--
-- Three hints, all opt-in, all flipping the play to `assisted`. The hard constraint
-- from the spec is the whole reason this is a migration and not a client feature:
--
--   `assisted` is SERVER-SET when a hint is taken, never client-confessed.
--
-- A client-reported flag would make the reveal oracle free and the entire
-- ranked/assisted split decorative — you would simply not confess. So every hint,
-- including the two that compute on the client, goes through `mark_play_assisted`
-- here, and nothing in the submit payload can clear the flag afterwards.
--
-- Two functions, because a reveal needs the solution and the other two hints do not:
--
--   * mark_play_assisted  — the flag, for any hint. The client-side hints call only
--                           this one; no board leaves the browser for them.
--   * load_play_for_reveal — hands the Edge Function the hidden solution so it can
--                           pick the next correct cell. Server-side because the
--                           solution stays server-only, because it then works from
--                           ANY board state including a corrupted one, and because
--                           it doubles as a validation seam.
--
-- Both are security definer over `puzzle_solutions`, which has zero policies and is
-- unreachable by anon and authenticated. These two functions and the replay path in
-- `submit` remain the only things that ever join across that wall.

-- ---------------------------------------------------------------------------
-- mark_play_assisted — flag the play and count the hint.
--
-- Idempotent on `assisted` (already-true stays true) but NOT on `hints_used`, which
-- counts every hint taken: the friends board shows the count, so it has to keep
-- rising after the flag has already flipped. Hints are unlimited once assisted —
-- there is no rationing on a play that is already out of the ranking — so this
-- never refuses on the count.
--
-- A completed play is refused: a hint taken after submission could only be an
-- attempt to rewrite a finished result.
-- ---------------------------------------------------------------------------

create function public.mark_play_assisted(p_token uuid)
returns table (
  status text,
  assisted boolean,
  hints_used integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_play public.plays;
begin
  select * into v_play from public.plays where token = p_token for update;
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

  update public.plays
  set assisted = true,
      hints_used = public.plays.hints_used + 1
  where id = v_play.id
  returning * into v_play;

  status := 'ok';
  assisted := v_play.assisted;
  hints_used := v_play.hints_used;
  return next;
end;
$$;

comment on function public.mark_play_assisted(uuid) is
  'Flags a play assisted and counts one hint. Server-set: the client can ask for a hint but can never claim it did not take one.';

-- ---------------------------------------------------------------------------
-- load_play_for_reveal — the solution, for the reveal endpoint only.
--
-- Mirrors load_play_for_submit's shape: a `status` discriminator rather than an
-- exception, so the Edge Function can map each refusal to its own response without
-- parsing error strings.
--
-- It does NOT set `assisted` — marking is a separate call the Edge Function makes
-- once it has actually produced a cell. A load that fails to find one must not cost
-- the player their ranking.
-- ---------------------------------------------------------------------------

create function public.load_play_for_reveal(p_token uuid)
returns table (
  status text,
  play_id uuid,
  board_size smallint,
  region_map jsonb,
  solution jsonb
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

  status := 'ok';
  play_id := v_play.id;
  select p.board_size, p.region_map into board_size, region_map
  from public.puzzles p where p.id = v_play.puzzle_id;
  select s.solution into solution
  from public.puzzle_solutions s where s.puzzle_id = v_play.puzzle_id;
  return next;
end;
$$;

comment on function public.load_play_for_reveal(uuid) is
  'Hands the reveal endpoint the hidden solution for an open play. Security definer over puzzle_solutions, which has zero policies.';

-- Same posture as every other lifecycle function: reachable only by service_role,
-- so the sole caller is an Edge Function. `public` must never hold execute on a
-- function that reads a solution.
revoke all on function public.mark_play_assisted(uuid) from public;
revoke all on function public.load_play_for_reveal(uuid) from public;

grant execute on function public.mark_play_assisted(uuid) to service_role;
grant execute on function public.load_play_for_reveal(uuid) to service_role;
