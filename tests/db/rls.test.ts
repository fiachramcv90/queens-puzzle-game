import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asRole, connect, type DataApiRole, type Sql } from './client';

/**
 * Schedule visibility and the solution wall, asserted against the REAL policies on
 * a local Supabase — not a mock. Each guarantee here is a security boundary the
 * product rests on, so it is checked by the policy engine itself enforcing.
 *
 * Fixtures: four puzzles — one scheduled in the past, one today, one in the future,
 * one never scheduled — each with a solution row. Inserted as the superuser in
 * `beforeAll` and removed in `afterAll`; the `test-` hash prefix keeps them
 * identifiable and cleanup targeted.
 */

let sql: Sql;

const PAST = '11111111-1111-1111-1111-111111111111';
const TODAY = '22222222-2222-2222-2222-222222222222';
const FUTURE = '33333333-3333-3333-3333-333333333333';
const UNSCHEDULED = '44444444-4444-4444-4444-444444444444';

const ALL_IDS = [PAST, TODAY, FUTURE, UNSCHEDULED];
const DATA_API_ROLES: DataApiRole[] = ['anon', 'authenticated'];

// Day offsets from today's Dublin daily. Today (0) is the boundary the `<=`
// predicate turns on; the past/future offsets are deliberately far from the
// seed script's today..today-5 range so the two never contend for a date (the
// schedule's PK is the date). Today's date is claimed hermetically below.
const PAST_OFFSET = -90;
const FUTURE_OFFSET = 30;
const CLAIMED_OFFSETS = [PAST_OFFSET, 0, FUTURE_OFFSET];

const REGION_MAP = JSON.stringify([
	[0, 1],
	[0, 1]
]);
const SOLUTION = JSON.stringify([
	{ row: 0, col: 0 },
	{ row: 1, col: 1 }
]);
const SIGNALS = JSON.stringify({ forcedDeductionDepth: 0, size: 2 });

async function insertFixture(id: string, hash: string): Promise<void> {
	await sql`
    insert into public.puzzles (id, board_size, region_map, tier)
    values (${id}, 2, ${REGION_MAP}::jsonb, 'Easy')
  `;
	await sql`
    insert into public.puzzle_solutions
      (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
    values (${id}, ${SOLUTION}::jsonb, 1.0, ${SIGNALS}::jsonb, 1, ${hash})
  `;
}

/** Schedule `id` `offsetDays` from today's Dublin daily (negative = past, positive = future). */
async function schedule(id: string, offsetDays: number): Promise<void> {
	await sql`
    insert into public.puzzle_schedule (date, puzzle_id)
    values (public.dublin_today() + ${offsetDays}::int, ${id})
  `;
}

beforeAll(async () => {
	sql = connect();
	// Make the run hermetic: drop our own fixtures from an interrupted run, and
	// free the exact dates we claim so pre-existing data (e.g. from `npm run seed`)
	// can't collide with the schedule's date PK.
	await sql`delete from public.puzzles where id = any(${ALL_IDS})`;
	await sql`
    delete from public.puzzle_schedule
    where date in (
      select public.dublin_today() + o::int from unnest(${CLAIMED_OFFSETS}::int[]) as o
    )
  `;

	await insertFixture(PAST, 'test-past');
	await insertFixture(TODAY, 'test-today');
	await insertFixture(FUTURE, 'test-future');
	await insertFixture(UNSCHEDULED, 'test-unscheduled');

	await schedule(PAST, PAST_OFFSET);
	await schedule(TODAY, 0);
	await schedule(FUTURE, FUTURE_OFFSET);
	// UNSCHEDULED gets no schedule row on purpose.
});

afterAll(async () => {
	await sql`delete from public.puzzles where id = any(${ALL_IDS})`;
	await sql.end();
});

async function visiblePuzzleIds(role: DataApiRole): Promise<string[]> {
	return asRole(sql, role, async (tx) => {
		const rows = await tx<{ id: string }[]>`
      select id from public.puzzles where id = any(${ALL_IDS})
    `;
		return rows.map((r) => r.id);
	});
}

async function visibleScheduleIds(role: DataApiRole): Promise<string[]> {
	return asRole(sql, role, async (tx) => {
		const rows = await tx<{ puzzle_id: string }[]>`
      select puzzle_id from public.puzzle_schedule where puzzle_id = any(${ALL_IDS})
    `;
		return rows.map((r) => r.puzzle_id);
	});
}

describe.each(DATA_API_ROLES)('schedule visibility as %s', (role) => {
	test('a schedule row for a future date is invisible', async () => {
		const ids = await visibleScheduleIds(role);
		expect(ids).not.toContain(FUTURE);
	});

	test('schedule rows for today and past dates are visible', async () => {
		const ids = await visibleScheduleIds(role);
		expect(ids).toEqual(expect.arrayContaining([PAST, TODAY]));
	});

	test('a puzzle scheduled for a future date is invisible, even by its known id', async () => {
		const ids = await visiblePuzzleIds(role);
		expect(ids).not.toContain(FUTURE);
	});

	test('a puzzle with no schedule row is invisible, even by its known id', async () => {
		const ids = await visiblePuzzleIds(role);
		expect(ids).not.toContain(UNSCHEDULED);
	});

	test('puzzles scheduled for today and a past date are visible', async () => {
		const ids = await visiblePuzzleIds(role);
		expect(ids).toEqual(expect.arrayContaining([PAST, TODAY]));
	});
});

describe('the full archive is public — a guest (anon) sees every past daily', () => {
	test('anon reads the past and today puzzles with no auth', async () => {
		const ids = await visiblePuzzleIds('anon');
		expect(ids).toEqual(expect.arrayContaining([PAST, TODAY]));
		expect(ids).not.toContain(FUTURE);
	});
});

describe.each(DATA_API_ROLES)('puzzle_solutions is walled from %s', (role) => {
	test('a direct select by known puzzle_id returns nothing', async () => {
		await expect(
			asRole(
				sql,
				role,
				(tx) => tx`select * from public.puzzle_solutions where puzzle_id = ${TODAY}`
			)
		).rejects.toThrow(/permission denied/i);
	});

	test('a join that reaches through puzzles returns nothing', async () => {
		await expect(
			asRole(
				sql,
				role,
				(tx) => tx`
          select s.solution
          from public.puzzles p
          join public.puzzle_solutions s on s.puzzle_id = p.id
          where p.id = ${TODAY}
        `
			)
		).rejects.toThrow(/permission denied/i);
	});
});

describe('the solution wall is RLS, not a revocable grant', () => {
	test('even WITH a select grant, RLS returns zero solution rows to authenticated', async () => {
		// The spec chose an RLS wall over column GRANTs precisely because a grant can
		// be silently restored by a later migration. Prove the wall holds anyway: grant
		// the privilege, become authenticated, and confirm RLS still yields nothing.
		const rows = await sql
			.begin(async (tx) => {
				await tx.unsafe('grant select on public.puzzle_solutions to authenticated');
				await tx.unsafe('set local role authenticated');
				const result = await tx`select * from public.puzzle_solutions`;
				throw new RollbackProbe(result.length);
			})
			.catch((error) => {
				if (error instanceof RollbackProbe) return error.count;
				throw error;
			});
		expect(rows).toBe(0);
	});
});

describe('service_role has full access (it bypasses RLS)', () => {
	test('reads all three tables including future and unscheduled rows', async () => {
		const counts = await asRole(sql, 'service_role', async (tx) => {
			const [{ p }] = await tx<{ p: number }[]>`
        select count(*)::int as p from public.puzzles where id = any(${ALL_IDS})
      `;
			const [{ s }] = await tx<{ s: number }[]>`
        select count(*)::int as s from public.puzzle_solutions where puzzle_id = any(${ALL_IDS})
      `;
			const [{ sc }] = await tx<{ sc: number }[]>`
        select count(*)::int as sc from public.puzzle_schedule where puzzle_id = any(${ALL_IDS})
      `;
			return { p, s, sc };
		});
		expect(counts.p).toBe(4); // all four puzzles, future and unscheduled included
		expect(counts.s).toBe(4); // all four solutions
		expect(counts.sc).toBe(3); // past, today, future
	});

	test('can write all three tables', async () => {
		const id = '55555555-5555-5555-5555-555555555555';
		const wrote = await asRole(sql, 'service_role', async (tx) => {
			await tx`insert into public.puzzles (id, board_size, region_map, tier)
               values (${id}, 2, ${REGION_MAP}::jsonb, 'Medium')`;
			await tx`insert into public.puzzle_solutions
                 (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
               values (${id}, ${SOLUTION}::jsonb, 2.0, ${SIGNALS}::jsonb, 1, 'test-service-write')`;
			await tx`insert into public.puzzle_schedule (date, puzzle_id)
               values (public.dublin_today() - 10, ${id})`;
			const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.puzzle_schedule where puzzle_id = ${id}
      `;
			return n; // read-back happens before the probe rolls the insert away
		});
		expect(wrote).toBe(1);
	});
});

describe('the canonical hash is unique-constrained', () => {
	test('inserting a duplicate board hash fails', async () => {
		// TODAY already holds hash 'test-today'; a second solution reusing it must fail.
		const dupId = '66666666-6666-6666-6666-666666666666';
		await expect(
			asRole(sql, 'service_role', async (tx) => {
				await tx`insert into public.puzzles (id, board_size, region_map, tier)
                 values (${dupId}, 2, ${REGION_MAP}::jsonb, 'Easy')`;
				await tx`insert into public.puzzle_solutions
                   (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
                 values (${dupId}, ${SOLUTION}::jsonb, 1.0, ${SIGNALS}::jsonb, 1, 'test-today')`;
			})
		).rejects.toThrow(/duplicate key value|unique/i);
	});
});

class RollbackProbe extends Error {
	constructor(readonly count: number) {
		super('rollback probe');
	}
}
