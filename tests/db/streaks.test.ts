import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, type Sql } from './client';
import { generatePuzzle } from '../../src/lib/solver/index';

/**
 * Streaks (issue #26), exercised against the REAL functions on a running local
 * Supabase — the at-risk read helper, the incremental bump, the authoritative
 * recompute, the complete_play wiring and the merge survival — not a mock.
 *
 * The crux the spec pins on the database and this file asserts:
 *   - solving today increments; a replay and an archived-daily solve do not;
 *   - the read helper holds the streak while last_streak_date >= dublin_today() - 1
 *     and returns 0 afterwards, with no write in between;
 *   - longest survives a reset;
 *   - recompute rebuilds all three fields from `plays` alone and AGREES with the
 *     incrementally-maintained cache;
 *   - a guest's streak survives the merge into an account.
 *
 * A single generated fixture puzzle, at a far offset so its schedule date never
 * collides with the seed or the other db fixtures. Users are minted per test (the
 * new-user trigger seeds their profile) and cleaned up by cascade.
 */

let sql: Sql;

const PUZZLE_ID = '77777777-0000-0000-0000-000000000026';
const INSTANCE = '00000000-0000-0000-0000-000000000000';

/** Insert a minimal auth user; the trigger seeds its profile (current_streak 0). */
async function createUser(email: string): Promise<string> {
	const id = crypto.randomUUID();
	await sql`
    insert into auth.users
      (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      ${INSTANCE}, ${id}, 'authenticated', 'authenticated', ${email},
      ${sql.json({})}, ${sql.json({ name: 'Streaker' })}, now(), now()
    )
  `;
	return id;
}

/** The cached streak columns, straight from the profile row. */
async function streakOf(userId: string) {
	const rows = await sql<
		{ current_streak: number; longest_streak: number; last_streak_date: string | null }[]
	>`
    select current_streak, longest_streak,
           to_char(last_streak_date, 'YYYY-MM-DD') as last_streak_date
    from public.profiles where id = ${userId}
  `;
	return rows[0];
}

/** The time-aware read the friends board uses, evaluated against dublin_today(). */
async function effectiveOf(userId: string): Promise<number> {
	const [{ eff }] = await sql<{ eff: number }[]>`
    select public.effective_current_streak(current_streak, last_streak_date) as eff
    from public.profiles where id = ${userId}
  `;
	return eff;
}

/**
 * Insert a completed play `daysAgo` before today's Dublin date, IN its own window
 * (puzzle_date = dublin_date(started_at)) unless `archive` makes them disagree. `days`
 * is measured from dublin_today() so a run of consecutive days is easy to build.
 */
async function insertSolve(opts: {
	userId?: string;
	guestId?: string;
	daysAgo: number;
	attemptNo: number;
	replay?: boolean;
	/** started_at is today but puzzle_date is `daysAgo` back — an archived-daily solve. */
	archive?: boolean;
}): Promise<void> {
	const puzzleDate = sql`public.dublin_today() - ${opts.daysAgo}::int`;
	const startedAt = opts.archive
		? sql`now()`
		: sql`(public.dublin_today() - ${opts.daysAgo}::int)::timestamptz + interval '12 hours'`;
	await sql`
    insert into public.plays
      (user_id, guest_id, puzzle_id, puzzle_date, attempt_no, started_at, completed_at, replay)
    values (
      ${opts.userId ?? null}, ${opts.guestId ?? null}, ${PUZZLE_ID}, ${puzzleDate},
      ${opts.attemptNo}, ${startedAt}, ${startedAt}, ${opts.replay ?? false}
    )
  `;
}

/** Insert an OPEN play (no completed_at) and return its token, to drive complete_play. */
async function insertOpenPlay(opts: {
	userId: string;
	daysAgo: number;
	attemptNo: number;
}): Promise<string> {
	const puzzleDate = sql`public.dublin_today() - ${opts.daysAgo}::int`;
	const rows = await sql<{ token: string }[]>`
    insert into public.plays
      (user_id, puzzle_id, puzzle_date, attempt_no, started_at)
    values (${opts.userId}, ${PUZZLE_ID}, ${puzzleDate}, ${opts.attemptNo}, now())
    returning token
  `;
	return rows[0].token;
}

/** Close an open play through the real complete_play, as the submit function does. */
async function completePlay(token: string, replay: boolean): Promise<void> {
	await sql`
    select public.complete_play(
      ${token}::uuid, ${1000}::bigint, ${0}::int, ${false}, ${false}, ${replay},
      ${sql.json([])}, ${1}::smallint
    )
  `;
}

beforeAll(async () => {
	sql = connect();
	const puzzle = generatePuzzle(5, { seed: 20260726 });
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	await sql`
    insert into public.puzzles (id, board_size, region_map, tier)
    values (${PUZZLE_ID}, ${puzzle.public.size}, ${JSON.stringify(puzzle.public.regionMap)}::jsonb, ${puzzle.public.tier})
  `;
});

afterAll(async () => {
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	await sql.end();
});

describe('bump_streak — the incremental write', () => {
	test('chains consecutive days, then a gap resets while longest survives', async () => {
		const user = await createUser('bump@example.com');
		try {
			await sql`select public.bump_streak(${user}, public.dublin_today() - 2)`;
			expect(await streakOf(user)).toMatchObject({ current_streak: 1, longest_streak: 1 });

			await sql`select public.bump_streak(${user}, public.dublin_today() - 1)`;
			expect(await streakOf(user)).toMatchObject({ current_streak: 2, longest_streak: 2 });

			await sql`select public.bump_streak(${user}, public.dublin_today())`;
			expect(await streakOf(user)).toMatchObject({ current_streak: 3, longest_streak: 3 });

			// A later solve with a day skipped resets the run to 1; longest keeps the 3.
			await sql`select public.bump_streak(${user}, public.dublin_today() + 2)`;
			expect(await streakOf(user)).toMatchObject({ current_streak: 1, longest_streak: 3 });
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});

	test('re-counting the same day is an idempotent no-op', async () => {
		const user = await createUser('bump-idem@example.com');
		try {
			await sql`select public.bump_streak(${user}, public.dublin_today())`;
			await sql`select public.bump_streak(${user}, public.dublin_today())`;
			expect(await streakOf(user)).toMatchObject({ current_streak: 1, longest_streak: 1 });
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});

	test('a missing profile (a guest) is a silent no-op', async () => {
		const guest = crypto.randomUUID();
		// No profile row exists for this id; the call must not raise.
		await expect(
			sql`select public.bump_streak(${guest}, public.dublin_today())`
		).resolves.toBeDefined();
	});
});

describe('effective_current_streak — the time-aware at-risk read', () => {
	test('holds the streak while last_streak_date >= today - 1, and 0 afterwards, with no write between', async () => {
		const user = await createUser('read@example.com');
		try {
			// Solved yesterday, pending today: held at-risk, still reads full.
			await sql`select public.bump_streak(${user}, public.dublin_today() - 1)`;
			expect(await effectiveOf(user)).toBe(1);

			// Simulate a day elapsing with no solve by aging last_streak_date one more day.
			// NOTHING else changes — the reset is the read helper's, not a write's.
			await sql`update public.profiles set last_streak_date = public.dublin_today() - 2 where id = ${user}`;
			expect((await streakOf(user)).current_streak).toBe(1); // the stored cache is untouched
			expect(await effectiveOf(user)).toBe(0); // but the read is 0
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});

	test('a solve today reads the full streak', async () => {
		const user = await createUser('read-today@example.com');
		try {
			await sql`select public.bump_streak(${user}, public.dublin_today() - 1)`;
			await sql`select public.bump_streak(${user}, public.dublin_today())`;
			expect(await effectiveOf(user)).toBe(2);
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});
});

describe('complete_play — the streak wiring on a recorded solve', () => {
	test("solving today's daily increments the streak", async () => {
		const user = await createUser('complete@example.com');
		try {
			const token = await insertOpenPlay({ userId: user, daysAgo: 0, attemptNo: 1 });
			await completePlay(token, false);
			expect(await streakOf(user)).toMatchObject({
				current_streak: 1,
				longest_streak: 1,
				last_streak_date: await todayStr()
			});
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});

	test('a replay does not extend the streak', async () => {
		const user = await createUser('replay@example.com');
		try {
			const token = await insertOpenPlay({ userId: user, daysAgo: 0, attemptNo: 1 });
			await completePlay(token, true); // replay = true
			expect(await streakOf(user)).toMatchObject({ current_streak: 0, longest_streak: 0 });
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});

	test('solving an archived daily is recorded but never extends the streak', async () => {
		const user = await createUser('archive@example.com');
		try {
			// Open play whose puzzle_date is 5 days back but started_at is now: the two
			// dates disagree, so it is streak-neutral.
			const token = await insertOpenPlay({ userId: user, daysAgo: 5, attemptNo: 1 });
			await completePlay(token, false);
			// The play IS recorded (completed), but the streak did not move.
			const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.plays
        where user_id = ${user} and completed_at is not null
      `;
			expect(n).toBe(1);
			expect(await streakOf(user)).toMatchObject({ current_streak: 0, longest_streak: 0 });
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});
});

describe('recompute_streaks — the authoritative rebuild from plays alone', () => {
	test('rebuilds a run and agrees with the incremental cache; longest survives a reset', async () => {
		const user = await createUser('recompute@example.com');
		try {
			// A 3-day run (days 6,5,4 ago), a gap, then a 2-day run ending yesterday (1,2 ago).
			await insertSolve({ userId: user, daysAgo: 6, attemptNo: 1 });
			await insertSolve({ userId: user, daysAgo: 5, attemptNo: 1 });
			await insertSolve({ userId: user, daysAgo: 4, attemptNo: 1 });
			await insertSolve({ userId: user, daysAgo: 2, attemptNo: 1 });
			await insertSolve({ userId: user, daysAgo: 1, attemptNo: 1 });

			await sql`select public.recompute_streaks(${user})`;
			const rebuilt = await streakOf(user);
			expect(rebuilt.current_streak).toBe(2); // the run ending yesterday
			expect(rebuilt.longest_streak).toBe(3); // the earlier run survives the reset
			expect(rebuilt.last_streak_date).toBe(await daysAgoStr(1));

			// Agreement: replaying the same eligible days incrementally lands on the same
			// current and longest.
			const other = await createUser('recompute-agree@example.com');
			try {
				for (const d of [6, 5, 4, 2, 1]) {
					await sql`select public.bump_streak(${other}, public.dublin_today() - ${d}::int)`;
				}
				const incremental = await streakOf(other);
				expect(incremental.current_streak).toBe(rebuilt.current_streak);
				expect(incremental.longest_streak).toBe(rebuilt.longest_streak);
				expect(incremental.last_streak_date).toBe(rebuilt.last_streak_date);
			} finally {
				await sql`delete from auth.users where id = ${other}`;
			}
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});

	test('an archived-daily solve is streak-neutral in the rebuild (no backfill)', async () => {
		const user = await createUser('recompute-archive@example.com');
		try {
			// A genuine solve 2 days ago, plus an archived solve for day 1 played today
			// (started_at now, puzzle_date yesterday). The archive must NOT repair the gap
			// to today, and must not count as its own day.
			await insertSolve({ userId: user, daysAgo: 2, attemptNo: 1 });
			await insertSolve({ userId: user, daysAgo: 1, attemptNo: 1, archive: true });
			await sql`select public.recompute_streaks(${user})`;
			expect(await streakOf(user)).toMatchObject({
				current_streak: 1,
				longest_streak: 1,
				last_streak_date: await daysAgoStr(2)
			});
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});

	test('no eligible solves rebuilds to a clean zero', async () => {
		const user = await createUser('recompute-empty@example.com');
		try {
			await sql`update public.profiles set current_streak = 9, longest_streak = 9, last_streak_date = public.dublin_today() where id = ${user}`;
			await sql`select public.recompute_streaks(${user})`;
			expect(await streakOf(user)).toMatchObject({
				current_streak: 0,
				longest_streak: 0,
				last_streak_date: null
			});
		} finally {
			await sql`delete from auth.users where id = ${user}`;
		}
	});
});

describe('the merge rebuilds the streak so a guest keeps it', () => {
	test('a guest who solved consecutive days keeps the streak after signing in', async () => {
		const user = await createUser('merge-streak@example.com');
		const guest = crypto.randomUUID();
		try {
			// The guest solved three days running, all as guest rows keyed by the guest id.
			await insertSolve({ guestId: guest, daysAgo: 2, attemptNo: 1 });
			await insertSolve({ guestId: guest, daysAgo: 1, attemptNo: 1 });
			await insertSolve({ guestId: guest, daysAgo: 0, attemptNo: 1 });

			// Before the merge the account has no streak.
			expect(await streakOf(user)).toMatchObject({ current_streak: 0, longest_streak: 0 });

			await sql`select public.merge_guest_plays(${user}, ${guest})`;

			// After the merge the re-keyed history has rebuilt the streak onto the account.
			expect(await streakOf(user)).toMatchObject({
				current_streak: 3,
				longest_streak: 3,
				last_streak_date: await todayStr()
			});
		} finally {
			await sql`delete from auth.users where id = ${user}`;
			await sql`delete from public.plays where guest_id = ${guest}`;
		}
	});
});

/** dublin_today() as a YYYY-MM-DD string, for asserting last_streak_date. */
async function todayStr(): Promise<string> {
	return daysAgoStr(0);
}

async function daysAgoStr(days: number): Promise<string> {
	const [{ d }] = await sql<{ d: string }[]>`
    select to_char(public.dublin_today() - ${days}::int, 'YYYY-MM-DD') as d
  `;
	return d;
}
