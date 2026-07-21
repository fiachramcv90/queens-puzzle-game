/**
 * Seed a handful of puzzles into the local Supabase and schedule them for today
 * and several past dates, so later slices have real boards to render without
 * waiting on the production generation pipeline.
 *
 * The boards come from the real solver core ({@link generatePuzzle}), so what gets
 * seeded is exactly what production would generate — the public half into
 * `puzzles`, the server-only half into `puzzle_solutions`, one schedule row per
 * date. It connects straight to Postgres (the superuser bypasses RLS, as
 * `service_role` would), because seeding is a local convenience, not a Data API
 * caller.
 *
 * Reproducible and idempotent: each entry has a fixed RNG seed, so re-running
 * produces the same boards, and an entry whose canonical hash is already present
 * is skipped rather than duplicated.
 *
 *   npm run seed
 *
 * Requires `supabase start` to be running. Point at another database with
 * SUPABASE_DB_URL if needed.
 */

import postgres from 'postgres';
import { generatePuzzle, type GeneratedPuzzle } from '../src/lib/solver/index';

const CONNECTION =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * What to seed: a spread of sizes across today and the preceding days. `daysAgo`
 * schedules relative to the Dublin daily so `daysAgo: 0` is always today's board;
 * `seed` fixes the board so the run is reproducible.
 */
interface SeedEntry {
	readonly daysAgo: number;
	readonly size: number;
	readonly seed: number;
}

const ENTRIES: readonly SeedEntry[] = [
	{ daysAgo: 0, size: 8, seed: 1001 },
	{ daysAgo: 1, size: 7, seed: 1002 },
	{ daysAgo: 2, size: 9, seed: 1003 },
	{ daysAgo: 3, size: 8, seed: 1004 },
	{ daysAgo: 4, size: 10, seed: 1005 },
	{ daysAgo: 5, size: 7, seed: 1006 }
];

/**
 * Ensure a board exists and is scheduled for its date. Idempotent on both: an
 * already-seeded board (matched by canonical hash) is reused rather than
 * duplicated, and its schedule row is (re)created if missing — so re-running after
 * something cleared a date restores it. Reports whether the puzzle was newly
 * inserted.
 */
async function seedEntry(sql: postgres.Sql, entry: SeedEntry): Promise<'inserted' | 'existed'> {
	const puzzle: GeneratedPuzzle = generatePuzzle(entry.size, { seed: entry.seed });
	const { public: pub, secret } = puzzle;

	return sql.begin(async (tx) => {
		const existing = await tx<{ puzzle_id: string }[]>`
      select puzzle_id from public.puzzle_solutions where canonical_hash = ${secret.hash}
    `;

		let id: string;
		let outcome: 'inserted' | 'existed';
		if (existing.length > 0) {
			id = existing[0].puzzle_id;
			outcome = 'existed';
		} else {
			[{ id }] = await tx<{ id: string }[]>`
        insert into public.puzzles (board_size, region_map, tier)
        values (${pub.size}, ${sql.json(pub.regionMap)}, ${pub.tier})
        returning id
      `;
			await tx`
        insert into public.puzzle_solutions
          (puzzle_id, solution, difficulty_score, difficulty_signals, generator_version, canonical_hash)
        values (
          ${id},
          ${sql.json(secret.solution)},
          ${secret.score},
          ${sql.json(secret.signals)},
          ${secret.generatorVersion},
          ${secret.hash}
        )
      `;
			outcome = 'inserted';
		}

		// Ensure the schedule row exists regardless — `do nothing` if the date is
		// already taken (by this board, or by anything else).
		await tx`
      insert into public.puzzle_schedule (date, puzzle_id)
      values (public.dublin_today() - ${entry.daysAgo}::int, ${id})
      on conflict (date) do nothing
    `;

		return outcome;
	});
}

async function main(): Promise<void> {
	const sql = postgres(CONNECTION, { max: 1, onnotice: () => {} });
	try {
		let inserted = 0;
		let existed = 0;
		for (const entry of ENTRIES) {
			const outcome = await seedEntry(sql, entry);
			const when = entry.daysAgo === 0 ? 'today' : `today - ${entry.daysAgo}`;
			console.log(`  ${outcome.padEnd(8)} ${entry.size}×${entry.size} for ${when}`);
			if (outcome === 'inserted') inserted++;
			else existed++;
		}
		console.log(
			`\nSeed complete: ${inserted} inserted, ${existed} already present (schedules ensured).`
		);
	} finally {
		await sql.end();
	}
}

main().catch((error) => {
	console.error('Seed failed:', error);
	process.exitCode = 1;
});
