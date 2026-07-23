import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, type Sql } from './client';
import { rateLimits } from '../../src/lib/config';
import { generatePuzzle } from '../../src/lib/solver/index';

/**
 * The durable, per-identity rate limit that supersedes the proxy-only IP window.
 *
 * Two things are proved here against the REAL running stack:
 *  - `check_play_rate_limit` counts a fixed window correctly — allow up to the
 *    limit, then block; independent budgets per identity and per action; a rolled-
 *    over window resets and trims its stale row.
 *  - a flood aimed DIRECTLY at the `start` Edge Function — the path the SvelteKit
 *    proxy hook never sees — is actually throttled with a 429. This is the gap the
 *    old IP limiter could not close, so the test calls the function URL directly on
 *    purpose.
 *
 * A tiny scheduled fixture puzzle so the allowed `start` calls return 200 rather
 * than 404. Each assertion uses a fresh guest UUID, so identities never collide.
 */

const FUNCTIONS = process.env.SUPABASE_FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1';

// A past offset clear of the seed window and the other db fixtures (#23 uses 55,
// the RLS test -90/+30), so the schedule's date PK never collides.
const OFFSET_DAYS = 56;
const PUZZLE_ID = '77777777-0000-0000-0000-000000000024';
const HOUR_MS = 60 * 60 * 1000;

let sql: Sql;
let puzzleDate: string; // YYYY-MM-DD, the scheduled date

/** A fresh guest UUID per assertion. */
function guest(): string {
	return crypto.randomUUID();
}

/** POST directly to the `start` Edge Function, skipping the proxy entirely. */
async function startDirect(
	payload: unknown
): Promise<{ status: number; retryAfter: string | null }> {
	const res = await fetch(`${FUNCTIONS}/start`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	return { status: res.status, retryAfter: res.headers.get('retry-after') };
}

/** One call to the checker, returning the row it produced. */
async function check(
	action: string,
	identity: string,
	limit: number,
	windowMs: number
): Promise<{ allowed: boolean; retry_after_ms: number }> {
	const [row] = await sql<{ allowed: boolean; retry_after_ms: number }[]>`
    select allowed, retry_after_ms
    from public.check_play_rate_limit(${action}, ${identity}::uuid, ${limit}, ${windowMs})
  `;
	return row;
}

beforeAll(async () => {
	sql = connect();

	const puzzle = generatePuzzle(5, { seed: 20260724 });

	// Hermetic: drop any leftover fixture and free the date we claim.
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	await sql`delete from public.puzzle_schedule where date = public.dublin_today() - ${OFFSET_DAYS}::int`;

	await sql`
    insert into public.puzzles (id, board_size, region_map, tier)
    values (
      ${PUZZLE_ID}, ${puzzle.public.size},
      ${JSON.stringify(puzzle.public.regionMap)}::jsonb, ${puzzle.public.tier}
    )
  `;
	const [{ date }] = await sql<{ date: string }[]>`
    insert into public.puzzle_schedule (date, puzzle_id)
    values (public.dublin_today() - ${OFFSET_DAYS}::int, ${PUZZLE_ID})
    returning to_char(date, 'YYYY-MM-DD') as date
  `;
	puzzleDate = date;
});

afterAll(async () => {
	// Cascades remove the fixture's plays; counters are keyed by random guest UUIDs
	// and self-trim, so nothing else needs cleaning.
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	await sql.end();
});

describe('check_play_rate_limit — the durable per-identity window', () => {
	test('allows up to the limit, then blocks with a positive retry', async () => {
		const id = guest();
		const limit = 3;
		for (let i = 0; i < limit; i++) {
			expect((await check('start', id, limit, HOUR_MS)).allowed).toBe(true);
		}
		const blocked = await check('start', id, limit, HOUR_MS);
		expect(blocked.allowed).toBe(false);
		expect(Number(blocked.retry_after_ms)).toBeGreaterThan(0);
	});

	test('a different identity has its own budget', async () => {
		const limit = 2;
		const a = guest();
		const b = guest();
		for (let i = 0; i < limit; i++) await check('start', a, limit, HOUR_MS);
		expect((await check('start', a, limit, HOUR_MS)).allowed).toBe(false);
		expect((await check('start', b, limit, HOUR_MS)).allowed).toBe(true);
	});

	test('start and submit are independent budgets for one identity', async () => {
		const id = guest();
		await check('start', id, 1, HOUR_MS);
		expect((await check('start', id, 1, HOUR_MS)).allowed).toBe(false);
		// submit's budget for the same identity is untouched.
		expect((await check('submit', id, 1, HOUR_MS)).allowed).toBe(true);
	});

	test('a rolled-over window resets the count and trims the stale row', async () => {
		const id = guest();
		await check('start', id, 1, HOUR_MS);
		expect((await check('start', id, 1, HOUR_MS)).allowed).toBe(false);

		// Age the stored window past its end; the next call computes a new current
		// window, trims the stale row, and starts fresh.
		await sql`
      update public.play_rate_limits
      set window_start = window_start - interval '2 hours'
      where identity = ${id}::uuid and action = 'start'
    `;
		expect((await check('start', id, 1, HOUR_MS)).allowed).toBe(true);

		const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.play_rate_limits
      where identity = ${id}::uuid and action = 'start'
    `;
		expect(n).toBe(1);
	});
});

describe('a direct-to-function flood is throttled per identity', () => {
	test('start over the cap on one identity returns 429; a fresh identity still starts', async () => {
		const limit = rateLimits.start.limit;
		const guestId = guest();

		// Idempotent start returns the same open play each time, but every request
		// is charged — so exactly `limit` succeed against the direct path.
		for (let i = 0; i < limit; i++) {
			expect((await startDirect({ puzzleDate, guestId })).status).toBe(200);
		}

		const over = await startDirect({ puzzleDate, guestId });
		expect(over.status).toBe(429);
		expect(Number(over.retryAfter)).toBeGreaterThan(0);

		// The cap is per identity: a different guest is unaffected.
		expect((await startDirect({ puzzleDate, guestId: guest() })).status).toBe(200);
	}, 20_000);
});
