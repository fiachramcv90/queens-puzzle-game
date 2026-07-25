import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asRole, connect, type DataApiRole, type Sql, type TxSql } from './client';
import { generatePuzzle } from '../../src/lib/solver/index';

/**
 * Profiles, the new-user trigger, RLS, and the silent guest merge — exercised against
 * the REAL policies and functions on a running local Supabase, not a mock. Every
 * guarantee the spec pins on the database (name seeding never leaking the raw email,
 * select-own/update-own, the columns a player may NOT self-edit, and the
 * ranked/history rules of the merge) is asserted by the policy engine and the
 * SECURITY DEFINER functions themselves.
 *
 * A single generated 5×5 fixture puzzle, scheduled at a fixed past offset that never
 * contends with the seed or the other db fixtures for a date. Auth users and their
 * plays are minted per test with fresh UUIDs; cascades clean them up.
 */

let sql: Sql;
let puzzleDate: string;

const OFFSET_DAYS = 61; // clear of the seed window and the other db tests' offsets
const PUZZLE_ID = '77777777-0000-0000-0000-000000000025';
const INSTANCE = '00000000-0000-0000-0000-000000000000';

/** Insert a minimal auth user (the trigger seeds its profile). Returns the id. */
async function createUser(opts: {
	email: string;
	meta?: Record<string, unknown>;
}): Promise<string> {
	const id = crypto.randomUUID();
	// raw_user_meta_data must be a real jsonb OBJECT so the seeding trigger's
	// `->> 'name'` can index it. postgres.js's sql.json() sends a proper json value;
	// the `${JSON.stringify(x)}::jsonb` idiom used elsewhere in these fixtures stores a
	// double-encoded jsonb *string* (masked everywhere by defensive JSON.parse), on
	// which `->> 'name'` returns null — which would send the trigger to the email
	// fallback and hide the OAuth-name path. This mirrors how scripts/seed-puzzles.ts
	// writes jsonb.
	await sql`
    insert into auth.users
      (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      ${INSTANCE}, ${id}, 'authenticated', 'authenticated', ${opts.email},
      ${sql.json({})}, ${sql.json(opts.meta ?? {})}, now(), now()
    )
  `;
	return id;
}

/** Read a profile row directly (superuser), or null. */
async function profileOf(userId: string) {
	const rows = await sql<
		{ display_name: string; name_confirmed: boolean; current_streak: number }[]
	>`
    select display_name, name_confirmed, current_streak from public.profiles where id = ${userId}
  `;
	return rows[0] ?? null;
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
class Rollback extends Error {}

/**
 * Insert a play row directly (superuser bypasses RLS), for building merge scenarios.
 * `completedMinAgo` (when set) marks the play completed at that time — distinct from
 * `startedMinAgo` so a scenario can make completion order diverge from start order, as
 * a concurrently-played guest and account do.
 */
async function insertPlay(opts: {
	userId?: string;
	guestId?: string;
	attemptNo: number;
	startedMinAgo: number;
	completedMinAgo?: number;
	completed?: boolean;
	replay?: boolean;
}): Promise<string> {
	const isCompleted = opts.completed || opts.completedMinAgo !== undefined;
	const completedAt =
		opts.completedMinAgo !== undefined
			? sql`now() - make_interval(mins => ${opts.completedMinAgo})`
			: isCompleted
				? sql`now()`
				: null;
	const rows = await sql<{ id: string }[]>`
    insert into public.plays
      (user_id, guest_id, puzzle_id, puzzle_date, attempt_no, started_at, completed_at, replay)
    values (
      ${opts.userId ?? null}, ${opts.guestId ?? null}, ${PUZZLE_ID}, ${puzzleDate},
      ${opts.attemptNo}, now() - make_interval(mins => ${opts.startedMinAgo}),
      ${completedAt}, ${opts.replay ?? false}
    )
    returning id
  `;
	return rows[0].id;
}

async function playsFor(userId: string) {
	return sql<
		{
			id: string;
			attempt_no: number;
			completed: boolean;
			replay: boolean;
			guest_id: string | null;
		}[]
	>`
    select id, attempt_no, completed_at is not null as completed, replay, guest_id
    from public.plays where user_id = ${userId}
    order by started_at, id
  `;
}

beforeAll(async () => {
	sql = connect();

	const puzzle = generatePuzzle(5, { seed: 20260724 });
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	await sql`delete from public.puzzle_schedule where date = public.dublin_today() - ${OFFSET_DAYS}::int`;

	await sql`
    insert into public.puzzles (id, board_size, region_map, tier)
    values (${PUZZLE_ID}, ${puzzle.public.size}, ${JSON.stringify(puzzle.public.regionMap)}::jsonb, ${puzzle.public.tier})
  `;
	await sql`
    insert into public.puzzle_solutions
      (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
    values (${PUZZLE_ID}, ${JSON.stringify(puzzle.secret.solution)}::jsonb, ${puzzle.secret.score},
      ${JSON.stringify(puzzle.secret.signals)}::jsonb, ${puzzle.secret.generatorVersion}, 'test-profiles-merge')
  `;
	const [{ date }] = await sql<{ date: string }[]>`
    insert into public.puzzle_schedule (date, puzzle_id)
    values (public.dublin_today() - ${OFFSET_DAYS}::int, ${PUZZLE_ID})
    returning to_char(date, 'YYYY-MM-DD') as date
  `;
	puzzleDate = date;
});

afterAll(async () => {
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	// Fixture auth users are removed by each test; nothing global to tidy beyond the puzzle.
	await sql.end();
});

describe('the new-user trigger seeds a 1:1 profile', () => {
	test('an OAuth user seeds the display name from the provider name', async () => {
		const id = await createUser({ email: 'ada@oauth.test', meta: { name: 'Ada Lovelace' } });
		try {
			const p = await profileOf(id);
			expect(p?.display_name).toBe('Ada Lovelace');
			expect(p?.name_confirmed).toBe(false);
		} finally {
			await sql`delete from auth.users where id = ${id}`;
		}
	});

	test('a magic-link user seeds from the email LOCAL-PART, never the raw address', async () => {
		const id = await createUser({ email: 'sam.carter@example.com' });
		try {
			const p = await profileOf(id);
			expect(p?.display_name).toBe('sam.carter');
			expect(p?.display_name).not.toContain('@');
		} finally {
			await sql`delete from auth.users where id = ${id}`;
		}
	});

	test('exactly one profile row exists per user', async () => {
		const id = await createUser({ email: 'one@example.com', meta: { full_name: 'Full Name' } });
		try {
			const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.profiles where id = ${id}
      `;
			expect(n).toBe(1);
			expect((await profileOf(id))?.display_name).toBe('Full Name');
		} finally {
			await sql`delete from auth.users where id = ${id}`;
		}
	});
});

describe('RLS: select-own and update-own, with the sensitive columns held back', () => {
	test('a player reads their own profile and not another player’s', async () => {
		const a = await createUser({ email: 'a@example.com', meta: { name: 'Player A' } });
		const b = await createUser({ email: 'b@example.com', meta: { name: 'Player B' } });
		try {
			const own = await asUser(a, (tx) => tx`select display_name from public.profiles`);
			expect(own).toHaveLength(1);
			expect((own[0] as { display_name: string }).display_name).toBe('Player A');

			const others = await asUser(a, (tx) => tx`select id from public.profiles where id = ${b}`);
			expect(others).toHaveLength(0);
		} finally {
			await sql`delete from auth.users where id = any(${[a, b]})`;
		}
	});

	test('a player may update their own display name and confirm it', async () => {
		const a = await createUser({ email: 'edit@example.com', meta: { name: 'Before' } });
		try {
			// Update-own: the policy matches the row, and the update touches exactly it.
			// The read-back inside the same tx proves the write landed before rollback.
			const after = await asUser(a, async (tx) => {
				const res = await tx`
          update public.profiles set display_name = 'After', name_confirmed = true where id = ${a}
        `;
				expect(res.count).toBe(1);
				return tx<{ display_name: string; name_confirmed: boolean }[]>`
          select display_name, name_confirmed from public.profiles where id = ${a}
        `;
			});
			expect(after[0].display_name).toBe('After');
			expect(after[0].name_confirmed).toBe(true);
		} finally {
			await sql`delete from auth.users where id = ${a}`;
		}
	});

	test('a player cannot update another player’s profile', async () => {
		const a = await createUser({ email: 'a2@example.com', meta: { name: 'A' } });
		const b = await createUser({ email: 'b2@example.com', meta: { name: 'B' } });
		try {
			await asUser(
				a,
				(tx) => tx`update public.profiles set display_name = 'hacked' where id = ${b}`
			);
			// RLS matched zero rows for A; B is untouched.
			expect((await profileOf(b))?.display_name).toBe('B');
		} finally {
			await sql`delete from auth.users where id = any(${[a, b]})`;
		}
	});

	test('a player cannot self-edit the streak cache — it is not in the update grant', async () => {
		const a = await createUser({ email: 'streak@example.com', meta: { name: 'S' } });
		try {
			await expect(
				asUser(a, (tx) => tx`update public.profiles set current_streak = 999 where id = ${a}`)
			).rejects.toThrow(/permission denied/i);
		} finally {
			await sql`delete from auth.users where id = ${a}`;
		}
	});

	test('a player cannot self-edit their friend_code — it is server-minted', async () => {
		const a = await createUser({ email: 'code@example.com', meta: { name: 'C' } });
		try {
			await expect(
				asUser(a, (tx) => tx`update public.profiles set friend_code = 'STEAL' where id = ${a}`)
			).rejects.toThrow(/permission denied/i);
		} finally {
			await sql`delete from auth.users where id = ${a}`;
		}
	});

	test.each(['anon'] as DataApiRole[])('%s cannot read profiles at all', async (role) => {
		const a = await createUser({ email: 'anon@example.com', meta: { name: 'X' } });
		try {
			await expect(
				asRole(sql, role, (tx) => tx`select id from public.profiles where id = ${a}`)
			).rejects.toThrow(/permission denied/i);
		} finally {
			await sql`delete from auth.users where id = ${a}`;
		}
	});
});

describe('merge_guest_plays: the silent re-key', () => {
	test('a guest’s completed play is re-keyed onto the account, and the merge is idempotent', async () => {
		const user = await createUser({ email: 'merge1@example.com', meta: { name: 'M1' } });
		const guest = crypto.randomUUID();
		try {
			await insertPlay({ guestId: guest, attemptNo: 1, startedMinAgo: 30, completed: true });

			const merged = await sql<{ merge_guest_plays: number }[]>`
        select public.merge_guest_plays(${user}, ${guest})
      `;
			expect(merged[0].merge_guest_plays).toBe(1);

			const plays = await playsFor(user);
			expect(plays).toHaveLength(1);
			expect(plays[0].guest_id).toBeNull();
			expect(plays[0].completed).toBe(true);
			expect(plays[0].replay).toBe(false); // the day's ranked play

			// No guest rows remain, so a second merge is a no-op — running it twice
			// equals running it once.
			const again = await sql<{ merge_guest_plays: number }[]>`
        select public.merge_guest_plays(${user}, ${guest})
      `;
			expect(again[0].merge_guest_plays).toBe(0);
			expect(await playsFor(user)).toHaveLength(1);
		} finally {
			await sql`delete from auth.users where id = ${user}`;
			await sql`delete from public.plays where guest_id = ${guest}`;
		}
	});

	test('ranked keeps the FIRST completed play (by completion, not start); both kept for history', async () => {
		const user = await createUser({ email: 'merge2@example.com', meta: { name: 'M2' } });
		const guest = crypto.randomUUID();
		try {
			// Completion order deliberately diverges from start order, as concurrently
			// played guest and account rows can: the account STARTED earlier but the guest
			// COMPLETED earlier. "First completed" is the guest's, so it is ranked and the
			// account's solve becomes a replay — proving the recompute orders by completed_at.
			const userPlay = await insertPlay({
				userId: user,
				attemptNo: 1,
				startedMinAgo: 20,
				completedMinAgo: 2
			});
			const guestPlay = await insertPlay({
				guestId: guest,
				attemptNo: 1,
				startedMinAgo: 10,
				completedMinAgo: 5
			});

			await sql`select public.merge_guest_plays(${user}, ${guest})`;

			const plays = await playsFor(user);
			expect(plays).toHaveLength(2); // both preserved for best-result-per-day history
			const byId = new Map(plays.map((p) => [p.id, p]));
			expect(byId.get(guestPlay)?.replay).toBe(false); // completed first → ranked
			expect(byId.get(userPlay)?.replay).toBe(true); // completed later → practice
			// attempt numbers stay unique per (user, date).
			expect(new Set(plays.map((p) => p.attempt_no)).size).toBe(2);
		} finally {
			await sql`delete from auth.users where id = ${user}`;
			await sql`delete from public.plays where guest_id = ${guest}`;
		}
	});

	test('two open plays for one day: the account’s is kept, the guest’s dropped', async () => {
		const user = await createUser({ email: 'merge3@example.com', meta: { name: 'M3' } });
		const guest = crypto.randomUUID();
		try {
			const kept = await insertPlay({ userId: user, attemptNo: 1, startedMinAgo: 10 }); // open
			await insertPlay({ guestId: guest, attemptNo: 1, startedMinAgo: 40 }); // open, same day

			await sql`select public.merge_guest_plays(${user}, ${guest})`;

			const plays = await playsFor(user);
			expect(plays).toHaveLength(1); // guest's open play dropped — one open play per day
			expect(plays[0].id).toBe(kept);
			// No guest rows left over.
			const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.plays where guest_id = ${guest}
      `;
			expect(n).toBe(0);
		} finally {
			await sql`delete from auth.users where id = ${user}`;
			await sql`delete from public.plays where guest_id = ${guest}`;
		}
	});

	test('an open guest play is re-keyed when the account only has a completed play', async () => {
		const user = await createUser({ email: 'merge4@example.com', meta: { name: 'M4' } });
		const guest = crypto.randomUUID();
		try {
			await insertPlay({ userId: user, attemptNo: 1, startedMinAgo: 60, completed: true });
			await insertPlay({ guestId: guest, attemptNo: 1, startedMinAgo: 5 }); // open

			await sql`select public.merge_guest_plays(${user}, ${guest})`;

			const plays = await playsFor(user);
			expect(plays).toHaveLength(2);
			const open = plays.filter((p) => !p.completed);
			expect(open).toHaveLength(1); // the re-keyed guest play is the single open one
			expect(open[0].guest_id).toBeNull();
		} finally {
			await sql`delete from auth.users where id = ${user}`;
			await sql`delete from public.plays where guest_id = ${guest}`;
		}
	});
});
