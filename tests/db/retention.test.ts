import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { asRole, connect, type Sql } from './client';
import { generatePuzzle } from '../../src/lib/solver/index';

/**
 * Retention and the unverified alarm (issue #33), against the real functions on a
 * running local Supabase.
 *
 * The property worth testing here is not "does a delete delete things" — it is the
 * one the two-jobs-not-one design exists to guarantee, and the one that would be
 * catastrophic and silent if it broke:
 *
 *   NEITHER JOB CAN REACH THE OTHER'S DATA.
 *
 * `purge_guest_plays` must never touch a row belonging to a converted account —
 * that row is somebody's history and their streak. `purge_move_logs` must never
 * touch a play row at all. Both are enforced structurally rather than by care, and
 * "structurally true" is exactly the kind of claim that deserves a test, because
 * nothing about the code shouts when it stops being true.
 */

let sql: Sql;

const PUZZLE_ID = '77777777-0000-0000-0000-000000000033';
const OFFSET_DAYS = 63;

interface PlaySpec {
	/** Days ago the play started — what both retention clocks measure against. */
	ageDays: number;
	/** An account-owned play. Mutually exclusive with `guest`. */
	userId?: string;
	/** A guest-owned play. */
	guest?: string;
	withLog?: boolean;
	unverified?: boolean;
}

/**
 * `attempt_no` is unique per identity per date. Tracked here rather than derived in
 * SQL so a test that deliberately inserts two plays for the SAME identity (the
 * unverified-rate case) does not collide on the index.
 */
const attempts = new Map<string, number>();
function nextAttempt(identity: string): number {
	const n = (attempts.get(identity) ?? 0) + 1;
	attempts.set(identity, n);
	return n;
}

async function insertPlay(spec: PlaySpec): Promise<string> {
	// `plays` enforces user_id XOR guest_id, and one OPEN play per identity per date.
	// Every fixture here is COMPLETED, so the open-play index never applies.
	const identity = spec.userId ?? spec.guest!;
	const started = sql`now() - make_interval(days => ${spec.ageDays})`;
	const rows = await sql<{ id: string }[]>`
    insert into public.plays
      (user_id, guest_id, puzzle_id, puzzle_date, attempt_no, started_at, completed_at,
       elapsed_ms, mistakes, unverified)
    values (
      ${spec.userId ?? null}, ${spec.guest ?? null}, ${PUZZLE_ID},
      public.dublin_today() - ${OFFSET_DAYS}::int, ${nextAttempt(identity)},
      ${started}, ${started}, ${60000}, ${0}, ${spec.unverified ?? false}
    )
    returning id
  `;
	const id = rows[0].id;
	if (spec.withLog) {
		await sql`
      insert into public.play_move_logs (play_id, move_log, format_version)
      values (${id}, ${sql.json([{ t: 0, row: 0, col: 0, to: 'X' }])}, 1)
    `;
	}
	return id;
}

async function playExists(id: string): Promise<boolean> {
	const rows = await sql`select 1 from public.plays where id = ${id}`;
	return rows.length === 1;
}

async function logExists(id: string): Promise<boolean> {
	const rows = await sql`select 1 from public.play_move_logs where play_id = ${id}`;
	return rows.length === 1;
}

/** A real auth user, so an account-owned play has a valid FK. */
const users: string[] = [];
async function createUser(): Promise<string> {
	const id = crypto.randomUUID();
	await sql`
    insert into auth.users
      (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      '00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated',
      ${`retention-${id}@example.com`}, ${sql.json({})}, ${sql.json({ name: 'Keeper' })}, now(), now()
    )
  `;
	users.push(id);
	return id;
}

beforeAll(async () => {
	sql = connect();
	const puzzle = generatePuzzle(5, { seed: 20260733 });
	await sql`
    insert into public.puzzles (id, board_size, region_map, tier)
    values (${PUZZLE_ID}, ${puzzle.public.size}, ${JSON.stringify(puzzle.public.regionMap)}::jsonb, ${puzzle.public.tier})
    on conflict (id) do nothing
  `;
	await sql`
    insert into public.puzzle_solutions
      (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
    values (${PUZZLE_ID}, ${JSON.stringify(puzzle.secret.solution)}::jsonb, 1.0, ${sql.json({})}, 7, ${'test-retention-33'})
    on conflict (puzzle_id) do nothing
  `;
	await sql`
    insert into public.puzzle_schedule (date, puzzle_id)
    values (public.dublin_today() - ${OFFSET_DAYS}::int, ${PUZZLE_ID})
    on conflict (date) do nothing
  `;
});

// Each test builds its own scenario, so the fixture plays are cleared between them.
// Scoped to this file's puzzle so a sweep here can never touch another suite's rows.
afterEach(async () => {
	await sql`delete from public.plays where puzzle_id = ${PUZZLE_ID}`;
});

afterAll(async () => {
	await sql`delete from public.puzzles where id = ${PUZZLE_ID}`;
	if (users.length > 0) await sql`delete from auth.users where id = any(${users}::uuid[])`;
	await sql.end();
});

describe('purge_guest_plays', () => {
	test('deletes an unconverted guest play past the window', async () => {
		const old = await insertPlay({ guest: crypto.randomUUID(), ageDays: 120 });
		const deleted = await sql<{ purge_guest_plays: number }[]>`
      select public.purge_guest_plays(90)
    `;
		expect(deleted[0].purge_guest_plays).toBeGreaterThanOrEqual(1);
		expect(await playExists(old)).toBe(false);
	});

	test('leaves a guest play inside the window alone', async () => {
		const recent = await insertPlay({ guest: crypto.randomUUID(), ageDays: 10 });
		await sql`select public.purge_guest_plays(90)`;
		expect(await playExists(recent)).toBe(true);
	});

	/**
	 * THE criterion from #33: "Purging never removes a play row belonging to a
	 * converted (merged) account."
	 *
	 * The merge re-keys a guest's rows to their user id, so a converted player's row
	 * has `user_id` set and `guest_id` null. The function's `guest_id is not null and
	 * user_id is null` predicate therefore cannot match it — by construction, not by
	 * care. This asserts that with a row far older than any window.
	 */
	test('never removes an account-owned play, however old', async () => {
		const user = await createUser();
		const merged = await insertPlay({ userId: user, ageDays: 3650 });
		await sql`select public.purge_guest_plays(1)`;
		expect(await playExists(merged)).toBe(true);
	});

	test('takes the move log with the play it deletes', async () => {
		const old = await insertPlay({ guest: crypto.randomUUID(), ageDays: 120, withLog: true });
		expect(await logExists(old)).toBe(true);
		await sql`select public.purge_guest_plays(90)`;
		// Cascade, and correct here: the play itself is gone, so the log has nothing
		// left to be evidence of.
		expect(await logExists(old)).toBe(false);
	});

	test('reports how many rows it removed', async () => {
		// Drain first. The function sweeps the whole table, so any stale guest row an
		// earlier suite left behind would be counted here and make the assertion depend
		// on test order rather than on this function.
		await sql`select public.purge_guest_plays(90)`;

		await insertPlay({ guest: crypto.randomUUID(), ageDays: 200 });
		await insertPlay({ guest: crypto.randomUUID(), ageDays: 200 });
		const recent = await insertPlay({ guest: crypto.randomUUID(), ageDays: 5 });

		const [{ purge_guest_plays: n }] = await sql<{ purge_guest_plays: number }[]>`
      select public.purge_guest_plays(90)
    `;
		expect(n).toBe(2);
		expect(await playExists(recent)).toBe(true);
	});
});

describe('purge_move_logs', () => {
	test('drops an old log but KEEPS its play row', async () => {
		const user = await createUser();
		const play = await insertPlay({ userId: user, ageDays: 120, withLog: true });

		const [{ purge_move_logs: n }] = await sql<{ purge_move_logs: number }[]>`
      select public.purge_move_logs(30)
    `;
		expect(n).toBeGreaterThanOrEqual(1);
		expect(await logExists(play)).toBe(false);
		// The whole point of the split: history and streaks depend on this row.
		expect(await playExists(play)).toBe(true);
	});

	test('leaves a log inside its own window alone', async () => {
		const play = await insertPlay({ guest: crypto.randomUUID(), ageDays: 5, withLog: true });
		await sql`select public.purge_move_logs(30)`;
		expect(await logExists(play)).toBe(true);
	});

	/**
	 * The two clocks are independent. A play 60 days old sits PAST the 30-day log
	 * clock and INSIDE the 90-day guest clock, so the log goes and the play stays —
	 * which only works if neither job is reaching into the other's data.
	 */
	test('the two clocks are independent on the same row', async () => {
		const guest = crypto.randomUUID();
		const play = await insertPlay({ guest, ageDays: 60, withLog: true });

		await sql`select public.purge_move_logs(30)`;
		await sql`select public.purge_guest_plays(90)`;

		expect(await logExists(play)).toBe(false);
		expect(await playExists(play)).toBe(true);
	});

	test('deletes no play rows at all, whatever the window', async () => {
		const guest = crypto.randomUUID();
		const play = await insertPlay({ guest, ageDays: 3650, withLog: true });
		const before = await sql<{ n: number }[]>`select count(*)::int as n from public.plays`;
		await sql`select public.purge_move_logs(0)`;
		const after = await sql<{ n: number }[]>`select count(*)::int as n from public.plays`;
		expect(after[0].n).toBe(before[0].n);
		expect(await playExists(play)).toBe(true);
	});
});

describe('unverified_rate', () => {
	test('reports the rate with the versions beside it', async () => {
		const guest = crypto.randomUUID();
		await insertPlay({ guest, ageDays: 1, withLog: true, unverified: true });
		await insertPlay({ guest, ageDays: 1, withLog: true });

		const rows = await sql<
			{
				day: string;
				completed_plays: number;
				unverified_plays: number;
				unverified_pct: string;
				generator_versions: number[] | null;
				move_log_versions: number[] | null;
			}[]
		>`select * from public.unverified_rate(14)`;

		const yesterday = rows.find((r) => Number(r.completed_plays) >= 2);
		expect(yesterday).toBeDefined();
		expect(Number(yesterday!.unverified_plays)).toBeGreaterThanOrEqual(1);
		// The versions are what turn "the rate jumped" into a diagnosis, so they must
		// actually arrive rather than being null.
		expect(yesterday!.generator_versions).toContain(7);
		expect(yesterday!.move_log_versions).toContain(1);
	});

	test('counts only completed plays', async () => {
		const guest = crypto.randomUUID();
		await sql`
      insert into public.plays (guest_id, puzzle_id, puzzle_date, attempt_no, started_at)
      values (${guest}, ${PUZZLE_ID}, public.dublin_today() - ${OFFSET_DAYS}::int, 1, now())
    `;
		const rows = await sql<{ completed_plays: number }[]>`
      select * from public.unverified_rate(14)
    `;
		const total = rows.reduce((n, r) => n + Number(r.completed_plays), 0);
		const [{ n: completed }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.plays
      where completed_at is not null and completed_at >= now() - interval '14 days'
    `;
		expect(total).toBe(completed);
	});
});

/**
 * These three are operator tooling that reads and deletes across every identity.
 * A client being able to call any of them would be a data-loss bug in the first two
 * and a cross-user disclosure in the third.
 */
describe('retention functions are unreachable by clients', () => {
	for (const fn of [
		'purge_guest_plays(90)',
		'purge_move_logs(30)',
		'unverified_rate(14)'
	] as const) {
		test(`anon and authenticated cannot execute ${fn.split('(')[0]}`, async () => {
			for (const role of ['anon', 'authenticated'] as const) {
				await expect(
					asRole(sql, role, (tx) => tx.unsafe(`select * from public.${fn}`))
				).rejects.toThrow(/permission denied/i);
			}
		});
	}

	test('service_role can execute them — the Edge/ops path still works', async () => {
		await expect(
			asRole(sql, 'service_role', (tx) => tx`select * from public.unverified_rate(14)`)
		).resolves.toBeDefined();
	});
});
