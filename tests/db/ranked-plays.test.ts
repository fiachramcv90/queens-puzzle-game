import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, type Sql, type TxSql } from './client';
import { generatePuzzle } from '../../src/lib/solver/index';

/**
 * The `ranked_plays` view (issue #27), exercised against the REAL view and RLS on a
 * running local Supabase — not a mock. The view is the single home of the ranked-play
 * filter, and this file asserts the two things the archive slice pins on it:
 *
 *   - an archive play (played outside its daily's window) NEVER appears in
 *     ranked_plays, so that day's leaderboard stays frozen; and
 *   - each server-set integrity event (replay / assisted / stale / unverified) drops a
 *     play from the view, while a clean in-window first solve stays in it.
 *
 * It also checks the view respects select-own RLS (security_invoker), so it can never
 * become a cross-user read path.
 *
 * A single generated fixture puzzle at a far offset so its schedule date never collides
 * with the seed or the other db fixtures. Plays are inserted directly as the superuser
 * (bypassing RLS) to build each scenario precisely.
 */

let sql: Sql;

const PUZZLE_ID = '77777777-0000-0000-0000-000000000027';
const INSTANCE = '00000000-0000-0000-0000-000000000000';
const OFFSET_DAYS = 60;

class Rollback extends Error {}

/** Insert a minimal auth user; the trigger seeds its profile. */
async function createUser(email: string): Promise<string> {
	const id = crypto.randomUUID();
	await sql`
    insert into auth.users
      (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      ${INSTANCE}, ${id}, 'authenticated', 'authenticated', ${email},
      ${sql.json({})}, ${sql.json({ name: 'Ranker' })}, now(), now()
    )
  `;
	return id;
}

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

/**
 * Insert a COMPLETED play. In-window by default (started_at on the puzzle's own date);
 * `archive` makes started_at today so it disagrees with the past puzzle_date.
 */
async function insertCompleted(opts: {
	userId: string;
	attemptNo: number;
	archive?: boolean;
	replay?: boolean;
	assisted?: boolean;
	stale?: boolean;
	unverified?: boolean;
}): Promise<string> {
	const puzzleDate = sql`public.dublin_today() - ${OFFSET_DAYS}::int`;
	const startedAt = opts.archive
		? sql`now()`
		: sql`(public.dublin_today() - ${OFFSET_DAYS}::int)::timestamptz + interval '12 hours'`;
	const rows = await sql<{ id: string }[]>`
    insert into public.plays
      (user_id, puzzle_id, puzzle_date, attempt_no, started_at, completed_at,
       elapsed_ms, mistakes, replay, assisted, stale, unverified)
    values (
      ${opts.userId}, ${PUZZLE_ID}, ${puzzleDate}, ${opts.attemptNo}, ${startedAt}, ${startedAt},
      ${90000}, ${0}, ${opts.replay ?? false}, ${opts.assisted ?? false},
      ${opts.stale ?? false}, ${opts.unverified ?? false}
    )
    returning id
  `;
	return rows[0].id;
}

/** The ranked_plays ids for a user, read as the superuser (bypasses RLS). */
async function rankedIdsOf(userId: string): Promise<string[]> {
	const rows = await sql<{ id: string }[]>`
    select id from public.ranked_plays where user_id = ${userId}
  `;
	return rows.map((r) => r.id);
}

beforeAll(async () => {
	sql = connect();
	const puzzle = generatePuzzle(5, { seed: 20260727 });
	await sql`
    insert into public.puzzles (id, board_size, region_map, tier)
    values (${PUZZLE_ID}, ${puzzle.public.size}, ${JSON.stringify(puzzle.public.regionMap)}::jsonb, ${puzzle.public.tier})
    on conflict (id) do nothing
  `;
	await sql`
    insert into public.puzzle_solutions
      (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
    values (${PUZZLE_ID}, ${JSON.stringify(puzzle.secret.solution)}::jsonb, 1.0, ${sql.json({})}, 1, ${'test-ranked-27'})
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

describe('ranked_plays view', () => {
	test('a clean in-window first solve is ranked', async () => {
		const user = await createUser(`ranked-clean-${crypto.randomUUID()}@example.com`);
		const id = await insertCompleted({ userId: user, attemptNo: 1 });
		expect(await rankedIdsOf(user)).toContain(id);
	});

	test('an archive play never appears in ranked_plays — the frozen board', async () => {
		const user = await createUser(`ranked-archive-${crypto.randomUUID()}@example.com`);
		// A brand-new player's FIRST, clean, non-replay solve of a past daily — the only
		// thing keeping it off the board is that it was played outside the daily's window.
		const id = await insertCompleted({ userId: user, attemptNo: 1, archive: true });
		expect(await rankedIdsOf(user)).not.toContain(id);
	});

	test('replay, assisted, stale and unverified plays are each excluded', async () => {
		const user = await createUser(`ranked-flags-${crypto.randomUUID()}@example.com`);
		const clean = await insertCompleted({ userId: user, attemptNo: 1 });
		const replay = await insertCompleted({ userId: user, attemptNo: 2, replay: true });
		const assisted = await insertCompleted({ userId: user, attemptNo: 3, assisted: true });
		const stale = await insertCompleted({ userId: user, attemptNo: 4, stale: true });
		const unverified = await insertCompleted({ userId: user, attemptNo: 5, unverified: true });
		const ranked = await rankedIdsOf(user);
		expect(ranked).toContain(clean);
		expect(ranked).not.toContain(replay);
		expect(ranked).not.toContain(assisted);
		expect(ranked).not.toContain(stale);
		expect(ranked).not.toContain(unverified);
	});

	/**
	 * The rule the view keys on is the `replay` EVENT, not the attempt number (#51).
	 * They come apart in the guest merge: `merge_guest_plays` renumbers attempt_no as
	 * max(account's) + rn, so a guest's clean solve folded onto an account that had
	 * merely OPENED that daily is a first completed play carrying attempt_no = 2. It
	 * ranks — and it bumps the streak, since complete_play gates on the same flag.
	 */
	test('a first completed play ranks even at attempt_no 2', async () => {
		const user = await createUser(`ranked-merged-${crypto.randomUUID()}@example.com`);
		const id = await insertCompleted({ userId: user, attemptNo: 2, replay: false });
		expect(await rankedIdsOf(user)).toContain(id);
	});

	test('the view is select-own: a player sees only their own ranked rows', async () => {
		const mine = await createUser(`ranked-mine-${crypto.randomUUID()}@example.com`);
		const theirs = await createUser(`ranked-theirs-${crypto.randomUUID()}@example.com`);
		const myId = await insertCompleted({ userId: mine, attemptNo: 1 });
		const theirId = await insertCompleted({ userId: theirs, attemptNo: 1 });

		const visible = await asUser(mine, async (tx) => {
			const rows = await tx<{ id: string }[]>`select id from public.ranked_plays`;
			return rows.map((r) => r.id);
		});
		expect(visible).toContain(myId);
		expect(visible).not.toContain(theirId);
	});
});
