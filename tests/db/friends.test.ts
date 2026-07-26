import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, type Sql, type TxSql } from './client';

/**
 * Friends (#30) and the friends board (#31), against the REAL functions and RLS on a
 * running local Supabase.
 *
 * Almost everything here is a security assertion, because almost every rule in the
 * friends design is one:
 *
 *   - no directory: a code resolves to exactly one person or to nothing, and a
 *     blocked user resolves to nothing at all;
 *   - consent: only the NON-requester may accept, which is a condition on the row's
 *     contents relative to the caller and therefore cannot be an RLS policy;
 *   - symmetry: unfriend is one DELETE, so there is no half-state to test for;
 *   - the two boards: the friends board INCLUDES assisted plays and the global board
 *     excludes them, over the same base table.
 */

const INSTANCE = '00000000-0000-0000-0000-000000000000';

let sql: Sql;

class Rollback extends Error {}

async function createUser(name: string): Promise<string> {
	const id = crypto.randomUUID();
	await sql`
    insert into auth.users
      (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      ${INSTANCE}, ${id}, 'authenticated', 'authenticated', ${`${name}-${id}@example.com`},
      ${sql.json({})}, ${sql.json({ name })}, now(), now()
    )
  `;
	return id;
}

/**
 * Run `fn` as the authenticated role with a jwt `sub` of `userId`. NOT rolled back:
 * these tests build state across several calls (request → accept → read), so each
 * step has to persist. Fixture users are cleaned up in afterAll.
 */
async function as<T>(userId: string, fn: (tx: TxSql) => Promise<T>): Promise<T> {
	let result!: T;
	await sql.begin(async (tx) => {
		await tx.unsafe(
			`set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`
		);
		await tx.unsafe('set local role authenticated');
		result = await fn(tx);
	});
	return result;
}

/** As above, but rolled back — for assertions that must not leave state behind. */
async function asRolledBack<T>(userId: string, fn: (tx: TxSql) => Promise<T>): Promise<T> {
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

async function codeOf(userId: string): Promise<string> {
	return as(userId, async (tx) => {
		const rows = await tx<{ ensure_friend_code: string }[]>`select public.ensure_friend_code()`;
		return rows[0].ensure_friend_code;
	});
}

/** Make `a` and `b` accepted friends. */
async function befriend(a: string, b: string): Promise<void> {
	const bCode = await codeOf(b);
	await as(a, (tx) => tx`select public.request_friendship(${bCode})`);
	await as(b, (tx) => tx`select public.respond_to_request(${a}, true)`);
}

const created: string[] = [];
async function user(name: string): Promise<string> {
	const id = await createUser(name);
	created.push(id);
	return id;
}

beforeAll(() => {
	sql = connect();
});

afterAll(async () => {
	if (created.length > 0) {
		await sql`delete from auth.users where id = any(${created}::uuid[])`;
	}
	await sql.end();
});

describe('friend codes', () => {
	test('are minted once and are stable across calls', async () => {
		const u = await user('coder');
		const first = await codeOf(u);
		const second = await codeOf(u);
		expect(first).toMatch(/^QNS-[A-Z0-9]{4}$/);
		expect(second).toBe(first);
	});

	test('regenerating retires the old code', async () => {
		const owner = await user('regen');
		const other = await user('seeker');
		const old = await codeOf(owner);

		const fresh = await as(owner, async (tx) => {
			const rows = await tx<{ regenerate_friend_code: string }[]>`
        select public.regenerate_friend_code()
      `;
			return rows[0].regenerate_friend_code;
		});
		expect(fresh).not.toBe(old);

		// The old code — and therefore every invite link embedding it — resolves to
		// nobody. That is the entire invalidation mechanism.
		const resolvedOld = await as(
			other,
			(tx) => tx`select * from public.resolve_friend_code(${old})`
		);
		expect(resolvedOld).toHaveLength(0);
	});

	test('resolve is exact-match only and never enumerates', async () => {
		const owner = await user('target');
		const seeker = await user('seeker2');
		const code = await codeOf(owner);

		const hit = await as(seeker, (tx) => tx`select * from public.resolve_friend_code(${code})`);
		expect(hit).toHaveLength(1);

		// A prefix is not a match, so a code cannot be walked into a listing.
		const prefix = await as(
			seeker,
			(tx) => tx`select * from public.resolve_friend_code(${code.slice(0, 6)})`
		);
		expect(prefix).toHaveLength(0);
	});

	test('a player cannot resolve their own code into a request', async () => {
		const u = await user('selfie');
		const code = await codeOf(u);
		const resolved = await as(u, (tx) => tx`select * from public.resolve_friend_code(${code})`);
		expect(resolved).toHaveLength(0);

		const outcome = await as(u, async (tx) => {
			const rows = await tx<{ request_friendship: string }[]>`
        select public.request_friendship(${code})
      `;
			return rows[0].request_friendship;
		});
		expect(outcome).toBe('self');
	});
});

describe('requests and consent', () => {
	test('a request lands pending, not accepted', async () => {
		const a = await user('asker');
		const b = await user('askee');
		const bCode = await codeOf(b);

		const outcome = await as(a, async (tx) => {
			const rows = await tx<{ request_friendship: string }[]>`
        select public.request_friendship(${bCode})
      `;
			return rows[0].request_friendship;
		});
		expect(outcome).toBe('requested');

		const [row] = await sql<{ status: string; requester_id: string }[]>`
      select status, requester_id from public.friendships
      where user_low = least(${a}::uuid, ${b}::uuid) and user_high = greatest(${a}::uuid, ${b}::uuid)
    `;
		expect(row.status).toBe('pending');
		expect(row.requester_id).toBe(a);
	});

	// The rule that makes friendship consensual, and the reason accepting is a
	// function rather than an RLS-guarded update.
	test('the requester cannot accept their own request', async () => {
		const a = await user('pushy');
		const b = await user('reluctant');
		const bCode = await codeOf(b);
		await as(a, (tx) => tx`select public.request_friendship(${bCode})`);

		const outcome = await as(a, async (tx) => {
			const rows = await tx<{ respond_to_request: string }[]>`
        select public.respond_to_request(${b}, true)
      `;
			return rows[0].respond_to_request;
		});
		expect(outcome).toBe('not-yours');

		const [row] = await sql<{ status: string }[]>`
      select status from public.friendships
      where user_low = least(${a}::uuid, ${b}::uuid) and user_high = greatest(${a}::uuid, ${b}::uuid)
    `;
		expect(row.status).toBe('pending');
	});

	test('the recipient can accept, and both then see a friend', async () => {
		const a = await user('one');
		const b = await user('two');
		await befriend(a, b);

		for (const [me, them] of [
			[a, b],
			[b, a]
		]) {
			const rows = await as(
				me,
				(tx) => tx<{ user_id: string; direction: string }[]>`select * from public.my_friends()`
			);
			expect(rows).toHaveLength(1);
			expect(rows[0].user_id).toBe(them);
			expect(rows[0].direction).toBe('friend');
		}
	});

	// Declining deletes rather than storing a 'declined' state: a permanent record
	// that someone said no would be readable by the requester and would block a
	// later request both parties wanted.
	test('declining removes the row entirely', async () => {
		const a = await user('hopeful');
		const b = await user('nope');
		const bCode = await codeOf(b);
		await as(a, (tx) => tx`select public.request_friendship(${bCode})`);
		await as(b, (tx) => tx`select public.respond_to_request(${a}, false)`);

		const rows = await sql`
      select 1 from public.friendships
      where user_low = least(${a}::uuid, ${b}::uuid) and user_high = greatest(${a}::uuid, ${b}::uuid)
    `;
		expect(rows).toHaveLength(0);
	});

	// Both asked independently: they have each said yes, so there is nothing left to
	// confirm and making them hunt for the other's request would be worse for no gain.
	test('a crossing request accepts immediately', async () => {
		const a = await user('cross-a');
		const b = await user('cross-b');
		const aCode = await codeOf(a);
		const bCode = await codeOf(b);

		await as(a, (tx) => tx`select public.request_friendship(${bCode})`);
		const outcome = await as(b, async (tx) => {
			const rows = await tx<{ request_friendship: string }[]>`
        select public.request_friendship(${aCode})
      `;
			return rows[0].request_friendship;
		});
		expect(outcome).toBe('accepted');
	});

	test('unfriending is symmetric — one delete, no half state', async () => {
		const a = await user('stay');
		const b = await user('go');
		await befriend(a, b);
		await as(a, (tx) => tx`select public.unfriend(${b})`);

		for (const me of [a, b]) {
			const rows = await as(me, (tx) => tx`select * from public.my_friends()`);
			expect(rows).toHaveLength(0);
		}
	});
});

describe('blocks', () => {
	test('a blocked user cannot resolve the blocker’s code', async () => {
		const blocker = await user('blocker');
		const blocked = await user('blocked');
		const code = await codeOf(blocker);
		await as(blocker, (tx) => tx`select public.block_user(${blocked})`);

		const resolved = await as(
			blocked,
			(tx) => tx`select * from public.resolve_friend_code(${code})`
		);
		expect(resolved).toHaveLength(0);
	});

	// Reported as an unknown code, deliberately: a distinct reply would confirm both
	// that the account exists and that they blocked you.
	test('a blocked user’s request is refused as an unknown code', async () => {
		const blocker = await user('blocker2');
		const blocked = await user('blocked2');
		const code = await codeOf(blocker);
		await as(blocker, (tx) => tx`select public.block_user(${blocked})`);

		const outcome = await as(blocked, async (tx) => {
			const rows = await tx<{ request_friendship: string }[]>`
        select public.request_friendship(${code})
      `;
			return rows[0].request_friendship;
		});
		expect(outcome).toBe('unknown-code');
	});

	test('blocking an existing friend also unfriends them, on both sides', async () => {
		const a = await user('exfriend-a');
		const b = await user('exfriend-b');
		await befriend(a, b);
		await as(a, (tx) => tx`select public.block_user(${b})`);

		for (const me of [a, b]) {
			const rows = await as(me, (tx) => tx`select * from public.my_friends()`);
			expect(rows).toHaveLength(0);
		}
	});

	test('a player cannot read who has blocked them', async () => {
		const blocker = await user('quiet-blocker');
		const blocked = await user('unaware');
		await as(blocker, (tx) => tx`select public.block_user(${blocked})`);

		const seen = await asRolledBack(
			blocked,
			(tx) => tx`select * from public.blocks where blocked_id = ${blocked}`
		);
		expect(seen).toHaveLength(0);
	});
});

describe('RLS on the friends tables', () => {
	test('a stranger cannot read someone else’s friendship row', async () => {
		const a = await user('pair-a');
		const b = await user('pair-b');
		const stranger = await user('nosy');
		await befriend(a, b);

		const seen = await asRolledBack(
			stranger,
			(tx) => tx`select * from public.friendships
                 where user_low = least(${a}::uuid, ${b}::uuid)`
		);
		expect(seen).toHaveLength(0);
	});

	// There is no client write policy at all — every mutation is a definer function,
	// which is what lets the block check and the consent rule be enforced.
	test('a client cannot insert a friendship directly', async () => {
		const a = await user('forger');
		const b = await user('victim');
		await expect(
			asRolledBack(
				a,
				(tx) => tx`insert into public.friendships (user_low, user_high, requester_id, status)
                   values (least(${a}::uuid, ${b}::uuid), greatest(${a}::uuid, ${b}::uuid), ${a}, 'accepted')`
			)
		).rejects.toThrow();
	});

	test('a client cannot promote a pending request to accepted directly', async () => {
		const a = await user('sneaky');
		const b = await user('unwilling');
		const bCode = await codeOf(b);
		await as(a, (tx) => tx`select public.request_friendship(${bCode})`);

		// Refused on privilege: `friendships` grants SELECT and nothing else. Asserted
		// rather than swallowed, so this cannot quietly become a test that passes
		// because the update silently matched no rows.
		await expect(
			asRolledBack(
				a,
				(tx) => tx`update public.friendships set status = 'accepted'
                   where user_low = least(${a}::uuid, ${b}::uuid)`
			)
		).rejects.toThrow(/permission denied/i);

		const [row] = await sql<{ status: string }[]>`
      select status from public.friendships
      where user_low = least(${a}::uuid, ${b}::uuid) and user_high = greatest(${a}::uuid, ${b}::uuid)
    `;
		expect(row.status).toBe('pending');
	});

	test('the internal block helper is not callable by a client', async () => {
		const a = await user('prober');
		const b = await user('probed');
		await expect(
			asRolledBack(a, (tx) => tx`select public.is_blocked_between(${a}, ${b})`)
		).rejects.toThrow(/permission denied/i);
	});
});

/**
 * The projection difference is the whole reason #31 is a separate function rather
 * than a filter on the global board. One base table, two projections.
 */
describe('friends_leaderboard', () => {
	const PUZZLE_ID = '77777777-0000-0000-0000-000000000031';
	const OFFSET_DAYS = 62;

	async function insertSolve(opts: {
		userId: string;
		elapsedMs: number;
		assisted?: boolean;
		hintsUsed?: number;
		stale?: boolean;
		attemptNo?: number;
	}): Promise<void> {
		const startedAt = sql`(public.dublin_today() - ${OFFSET_DAYS}::int)::timestamptz + interval '9 hours'`;
		await sql`
      insert into public.plays
        (user_id, puzzle_id, puzzle_date, attempt_no, started_at, completed_at,
         elapsed_ms, mistakes, assisted, hints_used, stale, unverified)
      values (
        ${opts.userId}, ${PUZZLE_ID}, public.dublin_today() - ${OFFSET_DAYS}::int,
        ${opts.attemptNo ?? 1}, ${startedAt}, ${startedAt},
        ${opts.elapsedMs}, ${1}, ${opts.assisted ?? false}, ${opts.hintsUsed ?? 0},
        ${opts.stale ?? false}, false
      )
    `;
	}

	beforeAll(async () => {
		const { generatePuzzle } = await import('../../src/lib/solver/index');
		const puzzle = generatePuzzle(5, { seed: 20260731 });
		await sql`
      insert into public.puzzles (id, board_size, region_map, tier)
      values (${PUZZLE_ID}, ${puzzle.public.size}, ${JSON.stringify(puzzle.public.regionMap)}::jsonb, ${puzzle.public.tier})
      on conflict (id) do nothing
    `;
		await sql`
      insert into public.puzzle_solutions
        (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
      values (${PUZZLE_ID}, ${JSON.stringify(puzzle.secret.solution)}::jsonb, 1.0, ${sql.json({})}, 1, ${'test-friends-31'})
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
	});

	const boardDate = () =>
		sql<{ d: string }[]>`select (public.dublin_today() - ${OFFSET_DAYS}::int)::text as d`.then(
			(r) => r[0].d
		);

	test('shows a friend’s solve and your own, ranked by time', async () => {
		const me = await user('board-me');
		const friend = await user('board-friend');
		await befriend(me, friend);
		await insertSolve({ userId: friend, elapsedMs: 60_000 });
		await insertSolve({ userId: me, elapsedMs: 90_000 });

		const date = await boardDate();
		const rows = await as(
			me,
			(tx) => tx<{ user_id: string; rank: string; is_you: boolean }[]>`
        select * from public.friends_leaderboard(${date}::date)
      `
		);
		expect(rows.map((r) => r.user_id)).toEqual([friend, me]);
		expect(rows[1].is_you).toBe(true);
	});

	// THE difference from the global board.
	test('includes an assisted play, with its hint count', async () => {
		const me = await user('assist-me');
		const friend = await user('assist-friend');
		await befriend(me, friend);
		await insertSolve({ userId: friend, elapsedMs: 30_000, assisted: true, hintsUsed: 3 });

		const date = await boardDate();
		const rows = await as(
			me,
			(tx) => tx<{ user_id: string; assisted: boolean; hints_used: number }[]>`
        select * from public.friends_leaderboard(${date}::date)
      `
		);
		const theirs = rows.find((r) => r.user_id === friend);
		expect(theirs?.assisted).toBe(true);
		expect(theirs?.hints_used).toBe(3);

		// The same play is absent from the global board. Asserted on THIS friend rather
		// than on an empty board: other tests in this describe share the fixture date
		// and legitimately put clean solves on it, so an emptiness check would be
		// asserting test isolation rather than the projection difference.
		const globalRows = await as(
			me,
			(tx) => tx<{ display_name: string }[]>`
        select * from public.global_leaderboard(${date}::date, 100, 0)
      `
		);
		expect(globalRows.map((r) => r.display_name)).not.toContain('assist-friend');
	});

	test('excludes a stale play and a later attempt', async () => {
		const me = await user('excl-me');
		const friend = await user('excl-friend');
		await befriend(me, friend);
		await insertSolve({ userId: friend, elapsedMs: 20_000, stale: true });
		await insertSolve({ userId: friend, elapsedMs: 21_000, attemptNo: 2 });

		const date = await boardDate();
		const rows = await as(me, (tx) => tx`select * from public.friends_leaderboard(${date}::date)`);
		expect(rows).toHaveLength(0);
	});

	test('never returns a non-friend, a pending request, or a blocked user', async () => {
		const me = await user('circle-me');
		const stranger = await user('circle-stranger');
		const pending = await user('circle-pending');
		const blocked = await user('circle-blocked');

		const pendingCode = await codeOf(pending);
		await as(me, (tx) => tx`select public.request_friendship(${pendingCode})`);

		await befriend(me, blocked);
		await as(me, (tx) => tx`select public.block_user(${blocked})`);

		for (const u of [stranger, pending, blocked]) {
			await insertSolve({ userId: u, elapsedMs: 10_000 });
		}

		const date = await boardDate();
		const rows = await as(
			me,
			(tx) => tx<{ user_id: string }[]>`select * from public.friends_leaderboard(${date}::date)`
		);
		expect(rows.map((r) => r.user_id)).not.toContain(stranger);
		expect(rows.map((r) => r.user_id)).not.toContain(pending);
		expect(rows.map((r) => r.user_id)).not.toContain(blocked);
	});

	// Friends requires an account on both sides, so `anon` is refused the function
	// outright rather than being handed an empty board. The `auth.uid() is null` guard
	// inside the function is the second line of that defence, for a session that
	// resolves to nobody — not the first.
	test('is refused entirely for a signed-out caller', async () => {
		const date = await boardDate();
		await expect(
			sql.begin(async (tx) => {
				await tx.unsafe(`set local role anon`);
				return tx`select * from public.friends_leaderboard(${date}::date)`;
			})
		).rejects.toThrow(/permission denied/i);
	});
});
