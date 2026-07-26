/**
 * Seed the local Supabase with real boards across a continuous window of dates, so later
 * slices have a daily to render without waiting on the production generation pipeline.
 *
 * The window comes from the shared `$lib/pool/seed-window` — the same one the remote seed
 * uses — so it always includes today and runs some days ahead as runway. The boards come
 * from the real solver core ({@link generatePuzzle}), so what gets seeded is exactly what
 * production would generate: the public half into `puzzles`, the server-only half into
 * `puzzle_solutions`, one `puzzle_schedule` row per date. It connects straight to Postgres
 * (the superuser bypasses RLS, as `service_role` would), because seeding is a local
 * convenience, not a Data API caller.
 *
 * Reproducible and idempotent: a date's seed is derived from the date itself, so re-running
 * regenerates the same board; an already-scheduled date is left alone and an existing board
 * is reused rather than duplicated. Re-running only ever fills gaps.
 *
 *   npm run seed
 *
 * Requires `supabase start` to be running. For a HOSTED project use `npm run seed:remote`
 * instead, which needs no database password — see scripts/seed-remote.ts.
 */

import postgres from 'postgres';
import { generatePuzzle, type GeneratedPuzzle } from '../src/lib/solver/index';
import { buildSeedWindow, type SeedEntry } from '../src/lib/pool/seed-window';
import { dublinDate } from '../src/lib/streak/streak';

const CONNECTION =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Days of archive to seed behind today. Override with SEED_PAST_DAYS. */
const PAST_DAYS = Number(process.env.SEED_PAST_DAYS ?? 21);
/** Days of runway to seed ahead of today (hidden until each arrives). Override with SEED_FUTURE_DAYS. */
const FUTURE_DAYS = Number(process.env.SEED_FUTURE_DAYS ?? 14);

/**
 * The window to seed, from the shared `$lib/pool/seed-window` — the same continuous,
 * forward-looking set of dates the remote seed uses, so the two scripts cannot drift.
 * Dates are anchored on `dublinDate()`, the client mirror of SQL `dublin_today()`.
 */
const ENTRIES: readonly SeedEntry[] = buildSeedWindow({
	today: dublinDate(),
	pastDays: PAST_DAYS,
	futureDays: FUTURE_DAYS
});

/** How many boards to try for one date before giving up. */
const MAX_BOARD_ATTEMPTS = 5;

/**
 * Ensure a board exists and is scheduled for its date, in one transaction. Idempotent on
 * both counts: an already-seeded board (matched by canonical hash) is reused rather than
 * duplicated, and the schedule row is created if missing — so re-running after something
 * cleared a date restores it. Reports whether the puzzle was newly inserted, or whether
 * the date was already scheduled.
 *
 * The attempt loop guards the one case that must not become a hard failure: the
 * regenerated board's hash matches a puzzle that is ALREADY scheduled on another date.
 * A puzzle may be scheduled at most once (`puzzle_schedule.puzzle_id` is unique, so a
 * returning player never gets a board they have already solved), so that board cannot be
 * reused here — and skipping the date would silently leave a gap. We perturb the seed and
 * generate a genuinely different board instead.
 */
async function seedEntry(
	sql: postgres.Sql,
	entry: SeedEntry
): Promise<'inserted' | 'existed' | 'already-scheduled'> {
	return sql.begin(async (tx) => {
		const taken = await tx`
      select 1 from public.puzzle_schedule where date = ${entry.date}
    `;
		if (taken.length > 0) return 'already-scheduled';

		for (let attempt = 0; attempt < MAX_BOARD_ATTEMPTS; attempt++) {
			// A prime stride, so a perturbed seed lands far from any other date's seed.
			const puzzle: GeneratedPuzzle = generatePuzzle(entry.size, {
				seed: entry.seed + attempt * 7919
			});
			const { public: pub, secret } = puzzle;

			const existing = await tx<{ puzzle_id: string }[]>`
        select puzzle_id from public.puzzle_solutions where canonical_hash = ${secret.hash}
      `;

			let id: string;
			let outcome: 'inserted' | 'existed';
			if (existing.length > 0) {
				id = existing[0].puzzle_id;
				const scheduled = await tx`
          select 1 from public.puzzle_schedule where puzzle_id = ${id}
        `;
				// Spoken for by another date — try a different board.
				if (scheduled.length > 0) continue;
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

			await tx`
        insert into public.puzzle_schedule (date, puzzle_id)
        values (${entry.date}, ${id})
        on conflict (date) do nothing
      `;

			return outcome;
		}

		throw new Error(
			`could not find an unscheduled board for ${entry.date} in ${MAX_BOARD_ATTEMPTS} attempts`
		);
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
		const today = dublinDate();
		console.log(
			`Seeding ${ENTRIES.length} dailies: ${ENTRIES[0].date} … ${ENTRIES[ENTRIES.length - 1].date} ` +
				`(today ${today})\n`
		);

		let inserted = 0;
		let existed = 0;
		let skipped = 0;
		for (const entry of ENTRIES) {
			const outcome = await seedEntry(sql, entry);
			const marker = entry.date === today ? ' ← today' : '';
			console.log(`  ${outcome.padEnd(17)} ${entry.date}  ${entry.size}×${entry.size}${marker}`);
			if (outcome === 'inserted') inserted++;
			else if (outcome === 'existed') existed++;
			else skipped++;
		}
		console.log(
			`\nSeed complete: ${inserted} inserted, ${existed} board(s) reused, ${skipped} date(s) already scheduled.`
		);
	} finally {
		await sql.end();
	}
}

main().catch((error) => {
	console.error('Seed failed:', error);
	process.exitCode = 1;
});
