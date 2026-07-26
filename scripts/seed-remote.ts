/**
 * Seed a REMOTE Supabase project's schedule over the REST API, with no database
 * password involved.
 *
 * Why this exists alongside `seed-puzzles.ts`: that script talks straight to Postgres,
 * which is right for local development (`supabase start`) but awkward from CI against a
 * hosted project — the direct database host is IPv6-only (unreachable from a GitHub
 * Actions runner) and the pooler route needs a database password that is easy to get
 * subtly wrong. This script instead authenticates with the `SUPABASE_SECRET_KEY`
 * (the key the build spec calls `service_role`), over plain HTTPS. That key already
 * exists for the deployment, bypasses RLS the same way the Edge Functions do, and is
 * the one credential `docs/deployment.md` says this repo's automation should hold.
 *
 * What it writes is identical to the local seed: real boards from the shared solver
 * core — the public half into `puzzles`, the server-only half into `puzzle_solutions`,
 * one `puzzle_schedule` row per date — across a continuous, forward-looking window so
 * today always has a live daily.
 *
 *   SUPABASE_SECRET_KEY=… PUBLIC_SUPABASE_URL=… npm run seed:remote
 *
 * Reproducible and idempotent: each date has a fixed RNG seed, a board whose canonical
 * hash is already present is reused rather than duplicated, and an already-scheduled
 * date is left alone. Re-running only ever fills gaps.
 *
 * The one thing it cannot do that the SQL seed can is wrap a puzzle and its solution in
 * a single transaction — PostgREST has no cross-request transaction. So a failure
 * between the two writes is compensated explicitly (the orphan puzzle is deleted),
 * keeping the canonical-hash reuse check honest on the next run.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generatePuzzle, type GeneratedPuzzle } from '../src/lib/solver/index';
import { buildSeedWindow, type SeedEntry } from '../src/lib/pool/seed-window';
import { dublinDate } from '../src/lib/streak/streak';

const url = process.env.PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url) throw new Error('PUBLIC_SUPABASE_URL is not set.');
if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not set (the service_role key).');

/** Days of archive behind today, and days of runway ahead. Same knobs as the local seed. */
const PAST_DAYS = Number(process.env.SEED_PAST_DAYS ?? 21);
const FUTURE_DAYS = Number(process.env.SEED_FUTURE_DAYS ?? 14);

/**
 * The window to seed. Anchored on today's Dublin date via `dublinDate` — the client mirror
 * of SQL `dublin_today()` — because PostgREST cannot call that function for us the way the
 * local seed's `insert … values` can.
 */
function buildEntries(): SeedEntry[] {
	return buildSeedWindow({
		today: dublinDate(),
		pastDays: PAST_DAYS,
		futureDays: FUTURE_DAYS
	});
}

/** The puzzle id already holding this canonical hash, or null. */
async function existingPuzzleId(db: SupabaseClient, hash: string): Promise<string | null> {
	const { data, error } = await db
		.from('puzzle_solutions')
		.select('puzzle_id')
		.eq('canonical_hash', hash)
		.maybeSingle();
	if (error) throw new Error(`hash lookup failed: ${error.message}`);
	return (data as { puzzle_id: string } | null)?.puzzle_id ?? null;
}

/** Insert both halves of a generated puzzle, returning the new puzzle id. */
async function insertPuzzle(db: SupabaseClient, puzzle: GeneratedPuzzle): Promise<string> {
	const { public: pub, secret } = puzzle;

	const { data, error } = await db
		.from('puzzles')
		.insert({ board_size: pub.size, region_map: pub.regionMap, tier: pub.tier })
		.select('id')
		.single();
	if (error) throw new Error(`puzzle insert failed: ${error.message}`);
	const id = (data as { id: string }).id;

	const { error: secretError } = await db.from('puzzle_solutions').insert({
		puzzle_id: id,
		solution: secret.solution,
		difficulty_score: secret.score,
		difficulty_signals: secret.signals,
		generator_version: secret.generatorVersion,
		canonical_hash: secret.hash
	});
	if (secretError) {
		// No transaction to roll back, so compensate: drop the half-written puzzle rather
		// than leave a board with no solution (which the hash check could never match).
		await db.from('puzzles').delete().eq('id', id);
		throw new Error(`solution insert failed: ${secretError.message}`);
	}

	return id;
}

/**
 * Whether `puzzleId` already holds a schedule slot. A puzzle is scheduled at most once
 * (`puzzle_schedule.puzzle_id` is unique — the guarantee that a returning player never
 * gets a board they have already solved), so a board that is already scheduled can never
 * be reused for another date, however well its canonical hash matches.
 */
async function isPuzzleScheduled(db: SupabaseClient, puzzleId: string): Promise<boolean> {
	const { data, error } = await db
		.from('puzzle_schedule')
		.select('date')
		.eq('puzzle_id', puzzleId)
		.maybeSingle();
	if (error) throw new Error(`schedule read failed: ${error.message}`);
	return data !== null;
}

/** How many boards to try for one date before giving up. */
const MAX_BOARD_ATTEMPTS = 5;

/**
 * A puzzle ready to be scheduled for `entry.date`: an existing board with the same
 * canonical hash when that board is still unscheduled, otherwise a freshly inserted one.
 *
 * The loop exists for the one case that must not become a hard failure — the regenerated
 * board's hash matches a puzzle that is ALREADY scheduled on another date. Reusing it
 * would violate the unique `puzzle_id`, and skipping the date would silently leave the
 * gap we are here to close, so we perturb the seed and generate a genuinely different
 * board instead.
 */
async function puzzleForDate(
	db: SupabaseClient,
	entry: SeedEntry
): Promise<{ id: string; puzzle: GeneratedPuzzle; reused: boolean }> {
	for (let attempt = 0; attempt < MAX_BOARD_ATTEMPTS; attempt++) {
		// A prime stride, so a perturbed seed lands far from any other date's seed.
		const puzzle = generatePuzzle(entry.size, { seed: entry.seed + attempt * 7919 });
		const existing = await existingPuzzleId(db, puzzle.secret.hash);

		if (existing === null) {
			return { id: await insertPuzzle(db, puzzle), puzzle, reused: false };
		}
		if (!(await isPuzzleScheduled(db, existing))) {
			return { id: existing, puzzle, reused: true };
		}
		// That board is spoken for by another date; try a different one.
	}
	throw new Error(
		`could not find an unscheduled board for ${entry.date} in ${MAX_BOARD_ATTEMPTS} attempts`
	);
}

/** Whether a daily is already scheduled for `date`. */
async function isScheduled(db: SupabaseClient, date: string): Promise<boolean> {
	const { data, error } = await db
		.from('puzzle_schedule')
		.select('date')
		.eq('date', date)
		.maybeSingle();
	if (error) throw new Error(`schedule read failed: ${error.message}`);
	return data !== null;
}

/**
 * Schedule `puzzleId` for `date`. `ignoreDuplicates` so a concurrent run that claimed
 * the date between our check and this write is a no-op rather than an error — the
 * REST equivalent of the local seed's `on conflict (date) do nothing`.
 */
async function scheduleDate(db: SupabaseClient, date: string, puzzleId: string): Promise<void> {
	const { error } = await db
		.from('puzzle_schedule')
		.upsert({ date, puzzle_id: puzzleId }, { onConflict: 'date', ignoreDuplicates: true });
	if (error) throw new Error(`schedule insert failed: ${error.message}`);
}

async function main(): Promise<void> {
	const db = createClient(url!, secretKey!, { auth: { persistSession: false } });
	const entries = buildEntries();

	console.log(
		`Seeding ${entries.length} dailies: ${entries[0].date} … ${entries[entries.length - 1].date} ` +
			`(today ${dublinDate()})\n`
	);

	let scheduled = 0;
	let skipped = 0;

	for (const entry of entries) {
		// Check before generating: an already-scheduled date is the common case on a
		// re-run, and generation is by far the slow part.
		if (await isScheduled(db, entry.date)) {
			console.log(`  already-scheduled  ${entry.date}`);
			skipped++;
			continue;
		}

		const { id: puzzleId, puzzle, reused } = await puzzleForDate(db, entry);
		await scheduleDate(db, entry.date, puzzleId);

		console.log(
			`  scheduled          ${entry.date}  ${puzzle.public.size}×${puzzle.public.size} · ${puzzle.public.tier}${reused ? ' (board reused)' : ''}`
		);
		scheduled++;
	}

	console.log(`\nSeed complete: ${scheduled} newly scheduled, ${skipped} already present.`);
}

main().catch((error: unknown) => {
	console.error('Remote seed failed:', error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
