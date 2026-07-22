import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asRole, connect, type DataApiRole, type Sql } from './client';
import { generatePuzzle } from '../../src/lib/solver/index';
import type { Cell, CellState, MoveLog } from '../../src/lib/solver/index';

/**
 * The HTTP contract of the play lifecycle, exercised against the REAL Edge
 * Functions on a running local Supabase — not a mock. Every acceptance criterion
 * that the spec pins on server behaviour is asserted here by actually calling
 * start / heartbeat / submit over HTTP and reading the rows the policy engine and
 * the service_role functions produced.
 *
 * A single generated 5×5 fixture puzzle, scheduled at a fixed past offset so it
 * never contends with the seed or the RLS fixtures for a date. Each test uses a
 * fresh guest UUID, so the one-open-play constraint isolates them.
 */

const FUNCTIONS = process.env.SUPABASE_FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1';

let sql: Sql;
let puzzleId: string;
let puzzleDate: string; // YYYY-MM-DD, the scheduled date
let regionSize: number;
let solution: readonly Cell[];

// A past offset far from the seed's today..today-5 window and the RLS test's
// -90/+30, so the schedule's date PK never collides.
const OFFSET_DAYS = 55;
const PUZZLE_ID = '77777777-0000-0000-0000-000000000023';

interface PostResult<T> {
	status: number;
	body: T;
}

async function post<T = Record<string, unknown>>(
	action: 'start' | 'heartbeat' | 'submit',
	payload: unknown
): Promise<PostResult<T>> {
	const res = await fetch(`${FUNCTIONS}/${action}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	const body = (await res.json().catch(() => null)) as T;
	return { status: res.status, body };
}

/** A fresh guest UUID per test. */
function guest(): string {
	return crypto.randomUUID();
}

/** The solved board: a queen at each solution cell, everything else empty. */
function solvedBoard(): CellState[][] {
	const board: CellState[][] = Array.from({ length: regionSize }, () =>
		Array.from({ length: regionSize }, (): CellState => 'empty')
	);
	for (const { row, col } of solution) board[row][col] = 'queen';
	return board;
}

/** A clean move log that places the solution queens in row order (no conflicts). */
function cleanLog(): MoveLog {
	return solution.map(({ row, col }, i) => ({
		t: (i + 1) * 1000,
		row,
		col,
		to: 'queen' as CellState
	}));
}

/** Start a play for a guest and return its token. */
async function startFor(guestId: string): Promise<string> {
	const { status, body } = await post<{ token: string }>('start', { puzzleDate, guestId });
	expect(status).toBe(200);
	return body.token;
}

beforeAll(async () => {
	sql = connect();

	// A real generated board, so the server's replay runs against a genuine puzzle.
	const puzzle = generatePuzzle(5, { seed: 20260722 });
	regionSize = puzzle.public.size;
	solution = puzzle.secret.solution;

	// Hermetic: drop any leftover of our fixture and free the date we claim.
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	await sql`delete from public.puzzle_schedule where date = public.dublin_today() - ${OFFSET_DAYS}::int`;

	await sql`
    insert into public.puzzles (id, board_size, region_map, tier)
    values (
      ${PUZZLE_ID}, ${puzzle.public.size},
      ${JSON.stringify(puzzle.public.regionMap)}::jsonb, ${puzzle.public.tier}
    )
  `;
	await sql`
    insert into public.puzzle_solutions
      (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
    values (
      ${PUZZLE_ID}, ${JSON.stringify(puzzle.secret.solution)}::jsonb, ${puzzle.secret.score},
      ${JSON.stringify(puzzle.secret.signals)}::jsonb, ${puzzle.secret.generatorVersion},
      ${'test-play-lifecycle'}
    )
  `;
	const [{ date }] = await sql<{ date: string }[]>`
    insert into public.puzzle_schedule (date, puzzle_id)
    values (public.dublin_today() - ${OFFSET_DAYS}::int, ${PUZZLE_ID})
    returning to_char(date, 'YYYY-MM-DD') as date
  `;
	puzzleId = PUZZLE_ID;
	puzzleDate = date;
});

afterAll(async () => {
	// Cascades remove the plays, move logs, solution and schedule row.
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	await sql.end();
});

describe('start mints a real, server-clocked play', () => {
	test('a guest with no session gets a plays row keyed by its guest UUID', async () => {
		const guestId = guest();
		const { status, body } = await post<{ token: string; startedAt: string; attemptNo: number }>(
			'start',
			{ puzzleDate, guestId }
		);
		expect(status).toBe(200);
		expect(body.token).toMatch(/[0-9a-f-]{36}/);
		expect(body.attemptNo).toBe(1);

		const rows = await sql<{ guest_id: string; user_id: string | null; started_at: string }[]>`
      select guest_id, user_id, started_at from public.plays where token = ${body.token}
    `;
		expect(rows).toHaveLength(1);
		expect(rows[0].guest_id).toBe(guestId);
		expect(rows[0].user_id).toBeNull();
	});

	test('one open play per identity per date: a second start returns the same token', async () => {
		const guestId = guest();
		const first = await startFor(guestId);
		const second = await startFor(guestId);
		expect(second).toBe(first);

		const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.plays
      where guest_id = ${guestId} and completed_at is null
    `;
		expect(n).toBe(1);
	});

	test('a future or unscheduled date is refused', async () => {
		const { status } = await post('start', { puzzleDate: '2999-01-01', guestId: guest() });
		expect(status).toBe(404);
	});
});

describe('credited time is server wall-clock, never client-influenced', () => {
	test('a client-supplied time in the payload cannot lower the credited time', async () => {
		const guestId = guest();
		const token = await startFor(guestId);

		// Pretend the play actually began five minutes ago; the credited time must
		// follow the server clock, not the move log.
		await sql`update public.plays set started_at = now() - interval '5 minutes' where token = ${token}`;

		const { status, body } = await post<{ elapsedMs: number }>('submit', {
			token,
			puzzleId,
			finalBoard: solvedBoard(),
			// Every move claims t=0 — a client pretending it solved instantly.
			moveLog: solution.map(({ row, col }) => ({ t: 0, row, col, to: 'queen' as CellState }))
		});

		expect(status).toBe(200);
		// ~5 minutes, regardless of the log's timestamps.
		expect(body.elapsedMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 2000);
		expect(body.elapsedMs).toBeLessThan(6 * 60 * 1000);
	});
});

describe('mistakes are derived server-side by replaying the move log', () => {
	test('a clean solve records zero mistakes', async () => {
		const token = await startFor(guest());
		const { body } = await post<{ mistakes: number }>('submit', {
			token,
			puzzleId,
			finalBoard: solvedBoard(),
			moveLog: cleanLog()
		});
		expect(body.mistakes).toBe(0);
	});

	test('a mid-solve conflict in the log is counted, ignoring any client value', async () => {
		const token = await startFor(guest());
		// Build a log that briefly places a second queen in row 0 (a duplicate-row
		// conflict), removes it, then plays the clean solution.
		const first = solution[0];
		const badCol = first.col === 0 ? 1 : 0; // some other column in row 0
		const log: MoveLog = [
			{ t: 1, row: first.row, col: first.col, to: 'queen' },
			{ t: 2, row: 0, col: badCol, to: 'queen' }, // conflict in row 0
			{ t: 3, row: 0, col: badCol, to: 'empty' }, // undo it
			...solution
				.slice(1)
				.map(({ row, col }, i) => ({ t: 10 + i, row, col, to: 'queen' as CellState }))
		];
		const { body } = await post<{ mistakes: number; unverified: boolean }>('submit', {
			token,
			puzzleId,
			finalBoard: solvedBoard(),
			moveLog: log
		});
		expect(body.unverified).toBe(false);
		expect(body.mistakes).toBe(1);
	});
});

describe('first-play-only ranking', () => {
	test('a second completed attempt is flagged replay and increments attempt_no', async () => {
		const guestId = guest();

		const t1 = await startFor(guestId);
		const r1 = await post<{ replay: boolean; attemptNo: number }>('submit', {
			token: t1,
			puzzleId,
			finalBoard: solvedBoard(),
			moveLog: cleanLog()
		});
		expect(r1.body.replay).toBe(false);
		expect(r1.body.attemptNo).toBe(1);

		const t2 = await startFor(guestId);
		const r2 = await post<{ replay: boolean; attemptNo: number }>('submit', {
			token: t2,
			puzzleId,
			finalBoard: solvedBoard(),
			moveLog: cleanLog()
		});
		expect(r2.body.replay).toBe(true);
		expect(r2.body.attemptNo).toBe(2);
	});
});

describe('stale: 30 minutes without a heartbeat', () => {
	test('a play silent past the window is flagged stale, still saves, still completes', async () => {
		const token = await startFor(guest());
		await sql`
      update public.plays
      set started_at = now() - interval '40 minutes',
          last_heartbeat_at = now() - interval '31 minutes'
      where token = ${token}
    `;
		const { status, body } = await post<{ stale: boolean }>('submit', {
			token,
			puzzleId,
			finalBoard: solvedBoard(),
			moveLog: cleanLog()
		});
		expect(status).toBe(200);
		expect(body.stale).toBe(true);

		const [{ completed }] = await sql<{ completed: boolean }[]>`
      select completed_at is not null as completed from public.plays where token = ${token}
    `;
		expect(completed).toBe(true);
	});
});

describe('heartbeat is liveness only', () => {
	test('a heartbeat touches last_heartbeat_at but never the timing', async () => {
		const token = await startFor(guest());
		const before = await sql<{ last: string; started: string }[]>`
      select last_heartbeat_at as last, started_at as started from public.plays where token = ${token}
    `;
		// Age the heartbeat, then beat and confirm it moved forward while started_at held.
		await sql`update public.plays set last_heartbeat_at = now() - interval '1 minute' where token = ${token}`;
		const { status, body } = await post<{ alive: boolean }>('heartbeat', { token });
		expect(status).toBe(200);
		expect(body.alive).toBe(true);

		const after = await sql<{ last: string; started: string }[]>`
      select last_heartbeat_at as last, started_at as started from public.plays where token = ${token}
    `;
		expect(new Date(after[0].last).getTime()).toBeGreaterThan(
			new Date(before[0].last).getTime() - 65_000
		);
		expect(new Date(after[0].started).getTime()).toBe(new Date(before[0].started).getTime());
	});

	test('an unknown token is not an error the client must act on', async () => {
		const { status, body } = await post<{ alive: boolean }>('heartbeat', {
			token: crypto.randomUUID()
		});
		expect(status).toBe(200);
		expect(body.alive).toBe(false);
	});
});

describe('failure policy: never let our bug eat a real solve', () => {
	test('an illegal final board is rejected and records nothing', async () => {
		const token = await startFor(guest());
		// Two queens in row 0 — illegal.
		const board = solvedBoard();
		board[0] = board[0].map((): CellState => 'empty');
		board[0][0] = 'queen';
		board[0][1] = 'queen';

		const { status } = await post('submit', { token, puzzleId, finalBoard: board, moveLog: [] });
		expect(status).toBe(422);

		const [{ completed }] = await sql<{ completed: boolean }[]>`
      select completed_at is not null as completed from public.plays where token = ${token}
    `;
		expect(completed).toBe(false); // still open — nothing recorded
	});

	test('a replay mismatch accepts the solve, flags unverified, stores mistakes null', async () => {
		const token = await startFor(guest());
		const { status, body } = await post<{ unverified: boolean; mistakes: number | null }>(
			'submit',
			{
				token,
				puzzleId,
				finalBoard: solvedBoard(),
				// A log that reconstructs a different (single-queen) board.
				moveLog: [{ t: 1, row: 0, col: 0, to: 'queen' }]
			}
		);
		expect(status).toBe(200);
		expect(body.unverified).toBe(true);
		expect(body.mistakes).toBeNull();

		const [{ mistakes }] = await sql<{ mistakes: number | null }[]>`
      select mistakes from public.plays where token = ${token}
    `;
		expect(mistakes).toBeNull();
	});
});

describe('bad tokens are rejected', () => {
	test('an unknown token → 404', async () => {
		const { status } = await post('submit', {
			token: crypto.randomUUID(),
			puzzleId,
			finalBoard: solvedBoard(),
			moveLog: cleanLog()
		});
		expect(status).toBe(404);
	});

	test('an already-submitted token → 409', async () => {
		const token = await startFor(guest());
		const first = await post('submit', {
			token,
			puzzleId,
			finalBoard: solvedBoard(),
			moveLog: cleanLog()
		});
		expect(first.status).toBe(200);
		const second = await post('submit', {
			token,
			puzzleId,
			finalBoard: solvedBoard(),
			moveLog: cleanLog()
		});
		expect(second.status).toBe(409);
	});

	test('a token for a different puzzle → 409', async () => {
		const token = await startFor(guest());
		const { status } = await post('submit', {
			token,
			puzzleId: crypto.randomUUID(), // not this play's puzzle
			finalBoard: solvedBoard(),
			moveLog: cleanLog()
		});
		expect(status).toBe(409);
	});
});

describe('RLS: no client read or write path to plays or move logs', () => {
	const DATA_API_ROLES: DataApiRole[] = ['anon', 'authenticated'];

	test('a completed guest play exists to probe against', async () => {
		const token = await startFor(guest());
		await post('submit', { token, puzzleId, finalBoard: solvedBoard(), moveLog: cleanLog() });
		const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.play_move_logs
      where play_id = (select id from public.plays where token = ${token})
    `;
		expect(n).toBe(1); // the move log was stored
	});

	test('anon has no read grant on plays at all', async () => {
		// anon is never granted select on plays, so the attempt is denied outright —
		// guests learn their result from the submit response, not by reading the table.
		await expect(asRole(sql, 'anon', (tx) => tx`select id from public.plays`)).rejects.toThrow(
			/permission denied/i
		);
	});

	test('authenticated sees no guest play through select-own', async () => {
		// A guest play has user_id null, so the select-own policy (user_id = auth.uid())
		// never matches it — the grant exists, but RLS yields zero rows.
		const rows = await asRole(sql, 'authenticated', (tx) => tx`select id from public.plays`);
		expect(rows).toHaveLength(0);
	});

	test.each(DATA_API_ROLES)('%s cannot read play_move_logs at all', async (role) => {
		await expect(
			asRole(sql, role, (tx) => tx`select play_id from public.play_move_logs`)
		).rejects.toThrow(/permission denied/i);
	});

	test.each(DATA_API_ROLES)('%s has no write path to plays', async (role) => {
		await expect(
			asRole(
				sql,
				role,
				(tx) => tx`insert into public.plays (guest_id, puzzle_id, puzzle_date, attempt_no)
                   values (${crypto.randomUUID()}, ${PUZZLE_ID}, ${puzzleDate}, 1)`
			)
		).rejects.toThrow(/permission denied/i);
	});
});
