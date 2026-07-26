import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, type Sql } from './client';
import { generatePuzzle } from '../../src/lib/solver/index';

/**
 * The hint functions (issue #28), against the REAL functions and RLS on a running
 * local Supabase.
 *
 * The thing worth testing here is not "does it set a boolean" — it is the spec's
 * hard constraint, which is a SECURITY property and therefore only meaningful
 * against the policy engine:
 *
 *   `assisted` is server-set when a hint is taken, never client-confessed.
 *
 * So the assertions below are mostly about who can reach what: that `anon` and
 * `authenticated` cannot call either function, that neither can read a solution by
 * any other route, and that once the flag is set nothing a client sends can clear
 * it. If those hold, the ranked/assisted split is real; if any one fails, it is
 * decorative.
 */

let sql: Sql;

const PUZZLE_ID = '77777777-0000-0000-0000-000000000028';
const OFFSET_DAYS = 61;

/**
 * Open an uncompleted play and return its token.
 *
 * A FRESH GUEST per call, deliberately. `plays_one_open_per_guest` allows exactly one
 * open play per identity per date — the constraint that makes `start` idempotent for
 * a reloading player — so a shared fixture guest would collide on the second call.
 * Each test here wants its own independent play, which means its own identity.
 */
async function openPlay(): Promise<string> {
	const rows = await sql<{ token: string }[]>`
    insert into public.plays
      (guest_id, puzzle_id, puzzle_date, attempt_no, started_at)
    values (
      ${crypto.randomUUID()}, ${PUZZLE_ID}, public.dublin_today() - ${OFFSET_DAYS}::int, 1,
      now()
    )
    returning token
  `;
	return rows[0].token;
}

async function playByToken(token: string) {
	const rows = await sql<{ assisted: boolean; hints_used: number }[]>`
    select assisted, hints_used from public.plays where token = ${token}
  `;
	return rows[0];
}

/** Run `fn` as a Data API role with no elevated rights, then roll back. */
async function asRole<T>(role: 'anon' | 'authenticated', fn: (tx: Sql) => Promise<T>): Promise<T> {
	let result!: T;
	class Rollback extends Error {}
	await sql
		.begin(async (tx) => {
			await tx.unsafe(`set local role ${role}`);
			result = await fn(tx as unknown as Sql);
			throw new Rollback();
		})
		.catch((error) => {
			if (!(error instanceof Rollback)) throw error;
		});
	return result;
}

beforeAll(async () => {
	sql = connect();
	const puzzle = generatePuzzle(5, { seed: 20260728 });
	await sql`
    insert into public.puzzles (id, board_size, region_map, tier)
    values (${PUZZLE_ID}, ${puzzle.public.size}, ${JSON.stringify(puzzle.public.regionMap)}::jsonb, ${puzzle.public.tier})
    on conflict (id) do nothing
  `;
	await sql`
    insert into public.puzzle_solutions
      (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
    values (${PUZZLE_ID}, ${JSON.stringify(puzzle.secret.solution)}::jsonb, 1.0, ${sql.json({})}, 1, ${'test-hints-28'})
    on conflict (puzzle_id) do nothing
  `;
	await sql`
    insert into public.puzzle_schedule (date, puzzle_id)
    values (public.dublin_today() - ${OFFSET_DAYS}::int, ${PUZZLE_ID})
    on conflict (date) do nothing
  `;
});

afterAll(async () => {
	await sql`delete from public.plays where puzzle_id = ${PUZZLE_ID}`;
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	await sql.end();
});

describe('mark_play_assisted', () => {
	test('flags the play and counts the hint', async () => {
		const token = await openPlay();
		const [result] = await sql<{ status: string; assisted: boolean; hints_used: number }[]>`
      select * from public.mark_play_assisted(${token})
    `;
		expect(result.status).toBe('ok');
		expect(result.assisted).toBe(true);
		expect(result.hints_used).toBe(1);
		expect(await playByToken(token)).toEqual({ assisted: true, hints_used: 1 });
	});

	// Hints are unlimited once assisted, and the friends board shows the count — so
	// the counter must keep rising after the flag has already flipped.
	test('keeps counting hints after the flag is already set', async () => {
		const token = await openPlay();
		await sql`select * from public.mark_play_assisted(${token})`;
		await sql`select * from public.mark_play_assisted(${token})`;
		const [result] = await sql<{ hints_used: number; assisted: boolean }[]>`
      select * from public.mark_play_assisted(${token})
    `;
		expect(result.assisted).toBe(true);
		expect(result.hints_used).toBe(3);
	});

	test('refuses an unknown token', async () => {
		const [result] = await sql<{ status: string }[]>`
      select * from public.mark_play_assisted(${crypto.randomUUID()})
    `;
		expect(result.status).toBe('unknown');
	});

	test('refuses a play that is already submitted', async () => {
		const token = await openPlay();
		await sql`update public.plays set completed_at = now(), elapsed_ms = 1000 where token = ${token}`;
		const [result] = await sql<{ status: string }[]>`
      select * from public.mark_play_assisted(${token})
    `;
		expect(result.status).toBe('already-submitted');
	});
});

describe('load_play_for_reveal', () => {
	test('returns the hidden solution for an open play', async () => {
		const token = await openPlay();
		const [result] = await sql<{ status: string; solution: unknown; board_size: number }[]>`
      select * from public.load_play_for_reveal(${token})
    `;
		expect(result.status).toBe('ok');
		expect(result.board_size).toBe(5);
		expect(Array.isArray(result.solution)).toBe(true);
		expect(result.solution).toHaveLength(5);
	});

	// It deliberately does NOT charge: a load that produced no cell must not cost the
	// player their ranking.
	test('does not set assisted on its own', async () => {
		const token = await openPlay();
		await sql`select * from public.load_play_for_reveal(${token})`;
		expect(await playByToken(token)).toEqual({ assisted: false, hints_used: 0 });
	});

	test('refuses an unknown or already-submitted token', async () => {
		const [unknown] = await sql<{ status: string }[]>`
      select * from public.load_play_for_reveal(${crypto.randomUUID()})
    `;
		expect(unknown.status).toBe('unknown');

		const token = await openPlay();
		await sql`update public.plays set completed_at = now(), elapsed_ms = 1000 where token = ${token}`;
		const [done] = await sql<{ status: string }[]>`
      select * from public.load_play_for_reveal(${token})
    `;
		expect(done.status).toBe('already-submitted');
	});
});

/**
 * The security posture. These are the assertions that make the split real: if a
 * client can call either function, it can flag itself (or, far worse, read the
 * solution) without going through an Edge Function.
 */
describe('hint functions are unreachable by clients', () => {
	test('anon and authenticated cannot execute mark_play_assisted', async () => {
		const token = await openPlay();
		for (const role of ['anon', 'authenticated'] as const) {
			await expect(
				asRole(role, (tx) => tx`select * from public.mark_play_assisted(${token})`)
			).rejects.toThrow(/permission denied/i);
		}
	});

	test('anon and authenticated cannot execute load_play_for_reveal', async () => {
		const token = await openPlay();
		for (const role of ['anon', 'authenticated'] as const) {
			await expect(
				asRole(role, (tx) => tx`select * from public.load_play_for_reveal(${token})`)
			).rejects.toThrow(/permission denied/i);
		}
	});

	// The structural wall the reveal oracle rests on: even knowing a puzzle id, the
	// solution is not selectable.
	//
	// The refusal is a PRIVILEGE error, not an empty result — `puzzle_solutions` has
	// zero policies AND no grant to either client role, so Postgres rejects the read
	// before RLS is ever consulted. That is the stronger of the two failures, and the
	// one worth pinning: a future migration that added a grant would turn this into
	// "returns nothing because a policy said so", which is one accidental permissive
	// policy away from returning everything.
	test('anon and authenticated cannot read puzzle_solutions directly', async () => {
		for (const role of ['anon', 'authenticated'] as const) {
			await expect(
				asRole(
					role,
					(tx) => tx`select solution from public.puzzle_solutions where puzzle_id = ${PUZZLE_ID}`
				)
			).rejects.toThrow(/permission denied/i);
		}
	});

	// A client has no write path to `plays` at all, so it cannot un-assist itself.
	// `plays` grants SELECT to authenticated and nothing else, so the update is
	// refused on privilege — asserted explicitly, and then re-checked on the row, so
	// the test fails loudly if a future grant ever made the write merely a no-op.
	test('a client cannot clear assisted once it is set', async () => {
		const token = await openPlay();
		await sql`select * from public.mark_play_assisted(${token})`;

		await expect(
			asRole(
				'authenticated',
				(tx) => tx`update public.plays set assisted = false where token = ${token}`
			)
		).rejects.toThrow(/permission denied/i);

		expect((await playByToken(token)).assisted).toBe(true);
	});
});
