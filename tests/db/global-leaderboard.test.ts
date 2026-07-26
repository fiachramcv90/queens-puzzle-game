import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asRole, connect, type Sql, type TxSql } from './client';
import { generatePuzzle } from '../../src/lib/solver/index';

/**
 * `global_leaderboard()` (issue #29), exercised against the REAL function and REAL RLS on
 * a running local Supabase — the only faithful test of a SECURITY DEFINER read path,
 * because the whole point is what a DIFFERENT caller can see.
 *
 * Four things are asserted here and nowhere else:
 *
 *   - the board ranks by solve time, tie-broken by fewest mistakes then earliest
 *     submission, and the rank is the position on the WHOLE board rather than within a
 *     page (so paging continues rather than restarting);
 *   - every disqualified play — replay, assisted, stale, unverified, archive — is absent,
 *     because the function reads `ranked_plays` and never re-states the filter;
 *   - the projection leaks nothing: only rank, display name, solve time, mistakes and
 *     `is_you`, and no caller can reach `plays` directly to get the rest;
 *   - a play started before rollover and submitted after it ranks for the day it BEGAN.
 *
 * A single generated fixture puzzle at its own far offset so its schedule date never
 * collides with the seed or the other db fixtures. Plays are inserted directly as the
 * superuser (bypassing RLS) to build each scenario precisely.
 */

let sql: Sql;

const PUZZLE_ID = '77777777-0000-0000-0000-000000000029';
const INSTANCE = '00000000-0000-0000-0000-000000000000';
const OFFSET_DAYS = 61;

/** One row of the board, exactly as the function returns it. */
interface BoardRow {
	rank: string;
	display_name: string;
	elapsed_ms: string;
	mistakes: number | null;
	is_you: boolean;
}

/** Insert a minimal auth user with a display name; the trigger seeds its profile. */
async function createUser(displayName: string): Promise<string> {
	const id = crypto.randomUUID();
	await sql`
    insert into auth.users
      (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      ${INSTANCE}, ${id}, 'authenticated', 'authenticated', ${`${displayName}-${id}@example.com`},
      ${sql.json({})}, ${sql.json({ name: displayName })}, now(), now()
    )
  `;
	await sql`update public.profiles set display_name = ${displayName} where id = ${id}`;
	return id;
}

/**
 * Insert a COMPLETED play for the fixture daily. In-window by default: `started_at` sits
 * inside the daily's own Dublin date, which is what makes it ranked-eligible.
 *
 * `startMin`/`completeMin` are minutes from the START of the daily's Dublin date, so a
 * play can be given a completion past rollover (>= 1440) without leaving its window —
 * which is exactly the accepted rollover edge.
 *
 * The instants are built as DUBLIN wall-clock times (`at time zone 'Europe/Dublin'`),
 * not by casting the date in the server's zone. On a UTC server the naive cast puts
 * 23:58 "on the daily" at 00:58 Dublin the next day during summer time, which would
 * silently move the fixture out of the daily's own window and make the rollover case
 * assert the opposite of what it means to.
 */
async function insertPlay(opts: {
	userId?: string;
	guestId?: string;
	elapsedMs: number;
	mistakes?: number | null;
	startMin?: number;
	completeMin?: number;
	archive?: boolean;
	replay?: boolean;
	assisted?: boolean;
	stale?: boolean;
	unverified?: boolean;
	attemptNo?: number;
}): Promise<string> {
	const startMin = opts.startMin ?? 720;
	const completeMin = opts.completeMin ?? startMin;
	const startedAt = opts.archive
		? sql`now()`
		: sql`(((public.dublin_today() - ${OFFSET_DAYS}::int)::timestamp + make_interval(mins => ${startMin})) at time zone 'Europe/Dublin')`;
	const completedAt = opts.archive
		? sql`now()`
		: sql`(((public.dublin_today() - ${OFFSET_DAYS}::int)::timestamp + make_interval(mins => ${completeMin})) at time zone 'Europe/Dublin')`;
	const mistakes = opts.mistakes === undefined ? 0 : opts.mistakes;

	const rows = await sql<{ id: string }[]>`
    insert into public.plays
      (user_id, guest_id, puzzle_id, puzzle_date, attempt_no, started_at, completed_at,
       elapsed_ms, mistakes, replay, assisted, stale, unverified)
    values (
      ${opts.userId ?? null}, ${opts.guestId ?? null}, ${PUZZLE_ID},
      ${sql`public.dublin_today() - ${OFFSET_DAYS}::int`}, ${opts.attemptNo ?? 1},
      ${startedAt}, ${completedAt},
      ${opts.elapsedMs}, ${mistakes}, ${opts.replay ?? false}, ${opts.assisted ?? false},
      ${opts.stale ?? false}, ${opts.unverified ?? false}
    )
    returning id
  `;
	return rows[0].id;
}

/** Read the fixture daily's board as `anon` — a guest reading a public board. */
async function board(opts: { limit?: number; offset?: number } = {}): Promise<BoardRow[]> {
	return asRole(sql, 'anon', async (tx) => readBoard(tx, opts));
}

async function readBoard(
	tx: TxSql,
	opts: { limit?: number; offset?: number } = {}
): Promise<BoardRow[]> {
	return tx<BoardRow[]>`
    select * from public.global_leaderboard(
      public.dublin_today() - ${OFFSET_DAYS}::int,
      ${opts.limit ?? 25},
      ${opts.offset ?? 0}
    )
  `;
}

beforeAll(async () => {
	sql = connect();
	const puzzle = generatePuzzle(5, { seed: 20260729 });
	await sql`
    insert into public.puzzles (id, board_size, region_map, tier)
    values (${PUZZLE_ID}, ${puzzle.public.size}, ${JSON.stringify(puzzle.public.regionMap)}::jsonb, ${puzzle.public.tier})
    on conflict (id) do nothing
  `;
	await sql`
    insert into public.puzzle_solutions
      (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
    values (${PUZZLE_ID}, ${JSON.stringify(puzzle.secret.solution)}::jsonb, 1.0, ${sql.json({})}, 1, ${'test-leaderboard-29'})
    on conflict (puzzle_id) do nothing
  `;
	await sql`
    insert into public.puzzle_schedule (date, puzzle_id)
    values (public.dublin_today() - ${OFFSET_DAYS}::int, ${PUZZLE_ID})
    on conflict (date) do nothing
  `;
});

afterAll(async () => {
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	await sql.end();
});

describe('global_leaderboard', () => {
	test('ranks by solve time, then fewest mistakes, then earliest submission', async () => {
		const fast = await createUser('Fast');
		const tiedEarly = await createUser('TiedEarly');
		const tiedLate = await createUser('TiedLate');
		const tiedMessy = await createUser('TiedMessy');
		const slow = await createUser('Slow');

		await insertPlay({ userId: fast, elapsedMs: 60000, mistakes: 3 });
		// Same time as each other: fewest mistakes wins, then the earlier submission.
		await insertPlay({ userId: tiedMessy, elapsedMs: 90000, mistakes: 2, completeMin: 780 });
		await insertPlay({ userId: tiedLate, elapsedMs: 90000, mistakes: 0, completeMin: 840 });
		await insertPlay({ userId: tiedEarly, elapsedMs: 90000, mistakes: 0, completeMin: 780 });
		await insertPlay({ userId: slow, elapsedMs: 120000, mistakes: 0 });

		const rows = await board();
		expect(rows.map((r) => r.display_name)).toEqual([
			'Fast',
			'TiedEarly',
			'TiedLate',
			'TiedMessy',
			'Slow'
		]);
		// A faster solve outranks a cleaner one: the primary key of the ranking is time.
		expect(Number(rows[0].elapsed_ms)).toBe(60000);
		expect(rows.map((r) => Number(r.rank))).toEqual([1, 2, 3, 4, 5]);
	});

	test('every disqualified play is absent — the filter is the view, not this function', async () => {
		const clean = await createUser('CleanSolve');
		const replayer = await createUser('Replayer');
		const assisted = await createUser('AssistedSolve');
		const stale = await createUser('StaleSolve');
		const unverified = await createUser('UnverifiedSolve');
		const archivist = await createUser('Archivist');

		await insertPlay({ userId: clean, elapsedMs: 70000 });
		await insertPlay({ userId: replayer, elapsedMs: 1000, replay: true, attemptNo: 2 });
		await insertPlay({ userId: assisted, elapsedMs: 1000, assisted: true });
		await insertPlay({ userId: stale, elapsedMs: 1000, stale: true });
		await insertPlay({ userId: unverified, elapsedMs: 1000, unverified: true, mistakes: null });
		// A brand-new player's first, clean solve of a PAST daily: the board is frozen.
		await insertPlay({ userId: archivist, elapsedMs: 1000, archive: true });

		const names = (await board()).map((r) => r.display_name);
		expect(names).toContain('CleanSolve');
		expect(names).not.toContain('Replayer');
		expect(names).not.toContain('AssistedSolve');
		expect(names).not.toContain('StaleSolve');
		expect(names).not.toContain('UnverifiedSolve');
		expect(names).not.toContain('Archivist');
	});

	test('a play started before rollover and submitted after it ranks for the day it began', async () => {
		const nightOwl = await createUser('NightOwl');
		// Started 23:58 on the daily's own date, submitted 00:03 the next day.
		const id = await insertPlay({
			userId: nightOwl,
			elapsedMs: 300000,
			startMin: 23 * 60 + 58,
			completeMin: 24 * 60 + 3
		});

		const rows = await board();
		expect(rows.map((r) => r.display_name)).toContain('NightOwl');
		// It is on the day it BEGAN, not the day it was submitted.
		const [{ puzzle_date, completed_date }] = await sql<
			{ puzzle_date: string; completed_date: string }[]
		>`
      select puzzle_date::text, public.dublin_date(completed_at)::text as completed_date
      from public.plays where id = ${id}
    `;
		expect(completed_date).not.toBe(puzzle_date);
	});

	test('paginates by limit and offset, and rank is the position on the whole board', async () => {
		for (let i = 0; i < 5; i++) {
			const user = await createUser(`Pager${i}`);
			await insertPlay({ userId: user, elapsedMs: 200000 + i * 1000 });
		}

		const first = await board({ limit: 2, offset: 0 });
		const second = await board({ limit: 2, offset: 2 });
		expect(first).toHaveLength(2);
		expect(second).toHaveLength(2);
		// The page continues; it does not restart at 1.
		expect(Number(second[0].rank)).toBe(Number(first[1].rank) + 1);
		expect(second.map((r) => r.display_name)).not.toEqual(first.map((r) => r.display_name));
	});

	test('projects only the permitted columns — no anti-cheat field and no account id', async () => {
		const player = await createUser('Projected');
		await insertPlay({ userId: player, elapsedMs: 80000 });

		const [row] = await board();
		expect(Object.keys(row).sort()).toEqual([
			'display_name',
			'elapsed_ms',
			'is_you',
			'mistakes',
			'rank'
		]);
	});

	test('is_you marks the reading player own row and nobody else', async () => {
		const me = await createUser('Me');
		const them = await createUser('Them');
		await insertPlay({ userId: me, elapsedMs: 55000 });
		await insertPlay({ userId: them, elapsedMs: 56000 });

		const rows = await asUser(me, (tx) => readBoard(tx));
		const mine = rows.filter((r) => r.is_you).map((r) => r.display_name);
		expect(mine).toEqual(['Me']);
	});

	test('a guest holds a real ranked play and is named on the board', async () => {
		await insertPlay({ guestId: crypto.randomUUID(), elapsedMs: 65000 });
		const names = (await board()).map((r) => r.display_name);
		expect(names).toContain('Guest');
	});

	test('the board is readable without an account, but `plays` never is', async () => {
		const player = await createUser('Public');
		await insertPlay({ userId: player, elapsedMs: 75000 });

		// anon reads the board through the function...
		expect((await board()).length).toBeGreaterThan(0);
		// ...and cannot touch the table it is built on. `plays` has no grant to the Data
		// API roles at all, so this is refused before RLS is even consulted.
		await expect(asRole(sql, 'anon', (tx) => tx`select id from public.plays`)).rejects.toThrow(
			/permission denied/i
		);
	});
});

class Rollback extends Error {}

/** Run `fn` as the authenticated Data API role WITH a jwt `sub` of `userId`, then roll back. */
async function asUser<T>(userId: string, fn: (tx: TxSql) => Promise<T>): Promise<T> {
	let result!: T;
	await sql
		.begin(async (tx) => {
			await tx.unsafe(
				`set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`
			);
			await tx.unsafe('set local role authenticated');
			result = await fn(tx);
			throw new Rollback();
		})
		.catch((error) => {
			if (!(error instanceof Rollback)) throw error;
		});
	return result;
}
