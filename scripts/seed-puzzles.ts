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
 * What to seed: a spread of sizes across a CONTINUOUS window of dailies. `daysAgo`
 * schedules relative to the Dublin daily, so `daysAgo: 0` is always today's board; a
 * NEGATIVE `daysAgo` is a future date (hidden by RLS until it arrives). `seed` fixes
 * the board so the run is reproducible.
 *
 * The window is forward-looking on purpose. A backward-only seed goes stale the moment
 * a real day passes — today outruns the last scheduled date and the home page falls
 * back to the latest past daily, which then (correctly) reads as an archive board. So
 * the window spans a past run for the archive AND a future run for runway, and it is
 * gap-free so no day between is ever missing. This is the local stand-in for the
 * production generation pipeline (#32), which keeps the schedule ~90 days ahead.
 */
interface SeedEntry {
	readonly daysAgo: number;
	readonly size: number;
	readonly seed: number;
}

/** Days of archive to seed behind today. Override with SEED_PAST_DAYS. */
const PAST_DAYS = Number(process.env.SEED_PAST_DAYS ?? 21);
/** Days of runway to seed ahead of today (hidden until each arrives). Override with SEED_FUTURE_DAYS. */
const FUTURE_DAYS = Number(process.env.SEED_FUTURE_DAYS ?? 14);

/**
 * A gentle, repeating size ramp across the week (smaller early, larger at the end),
 * indexed by position in the window so consecutive dailies vary. Sizes stay in the
 * 7–10 range the generator handles quickly enough for a one-shot seed.
 */
const SIZE_RAMP = [7, 7, 8, 8, 9, 9, 10] as const;

/**
 * The continuous window, newest future date first through the oldest past date. Each
 * date gets a distinct `seed` (so every board is a distinct puzzle — `puzzle_schedule`
 * requires a unique puzzle per date), and a size from the ramp.
 */
const ENTRIES: readonly SeedEntry[] = Array.from(
	{ length: PAST_DAYS + FUTURE_DAYS + 1 },
	(_unused, i): SeedEntry => {
		const daysAgo = PAST_DAYS - i; // +PAST_DAYS (oldest) … 0 (today) … -FUTURE_DAYS (furthest ahead)
		return {
			daysAgo,
			size: SIZE_RAMP[((i % SIZE_RAMP.length) + SIZE_RAMP.length) % SIZE_RAMP.length],
			// Unique, stable per date: the offset shifted into a positive, collision-free range.
			seed: 1000 + (daysAgo + FUTURE_DAYS + 1)
		};
	}
);

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
	// `prepare: false` so the script works through Supabase's transaction-mode pooler
	// (Supavisor, port 6543) as well as a direct or session-mode connection — the
	// transaction pooler rejects prepared statements. It is required from CI: a GitHub
	// Actions runner has no IPv6, and the DIRECT Supabase host is IPv6-only, so the
	// SUPABASE_DB_URL secret must be a POOLER connection string (…pooler.supabase.com),
	// which this option keeps compatible whichever pooler mode is chosen.
	const sql = postgres(CONNECTION, { max: 1, prepare: false, onnotice: () => {} });
	try {
		let inserted = 0;
		let existed = 0;
		for (const entry of ENTRIES) {
			const outcome = await seedEntry(sql, entry);
			const when =
				entry.daysAgo === 0
					? 'today'
					: entry.daysAgo > 0
						? `today - ${entry.daysAgo}`
						: `today + ${-entry.daysAgo}`;
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
