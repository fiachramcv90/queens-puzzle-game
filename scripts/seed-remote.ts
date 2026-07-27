/**
 * The generation pipeline (issue #32): top the pool and the schedule back up to the
 * horizon, on a hosted Supabase project, over the REST API with no database password.
 *
 *   SUPABASE_SECRET_KEY=… PUBLIC_SUPABASE_URL=… npm run seed:remote
 *   SUPABASE_SECRET_KEY=… PUBLIC_SUPABASE_URL=… npm run seed:remote -- --dry-run
 *
 * Run weekly on a cron, and manually on demand, by
 * `.github/workflows/generate-pool.yml`. The pool is generated **offline and never on
 * the request path** — no player ever waits on a generator.
 *
 * ## What one run does
 *
 * 1. Reads the schedule rows inside the horizon and plans against them
 *    (`$lib/pool/schedule-plan`).
 * 2. Fills every gap: for each date, **reject-sample** to that date's `(tier, size)` slot
 *    on the Mon→Sun ramp (`$lib/pool/ramp`) — generate at the target size, keep a board
 *    only when its *computed* tier matches.
 * 3. Re-reads the schedule and **fails loudly** if runway is below the watermark, so a
 *    starving pool surfaces with a month to spare rather than on the morning it empties.
 *
 * Every puzzle is written with its `difficulty_score`, its raw `difficulty_signals` and
 * its `generator_version`, so recalibrating the tier thresholds against real solve times
 * after launch is a data question rather than a migration. The solution goes only to
 * `puzzle_solutions`, never to `puzzles` — the client never receives a solution.
 *
 * ## No repeats, ever
 *
 * The canonical `(size, region_map, solution)` hash is the guard. A generated board whose
 * hash matches a puzzle that is already scheduled cannot be scheduled again — a returning
 * player must never get a board they have already solved — so the pipeline perturbs the
 * seed and generates a genuinely different board instead. An unscheduled board with a
 * matching hash is reused rather than duplicated.
 *
 * ## Why the REST API rather than Postgres
 *
 * `scripts/seed-puzzles.ts` talks straight to Postgres, which is right for local
 * development (`supabase start`) but awkward from CI against a hosted project: the direct
 * database host is IPv6-only (unreachable from a GitHub Actions runner) and the pooler
 * route needs a database password that is easy to get subtly wrong. This path instead
 * authenticates with `SUPABASE_SECRET_KEY` (the key the build spec calls `service_role`)
 * over plain HTTPS. That key already exists for the deployment, bypasses RLS the same way
 * the Edge Functions do, and is the one credential `docs/deployment.md` says this repo's
 * automation should hold. It is held as an Actions secret and never committed — and it is
 * a server-only key: see `src/lib/server/supabase-env.ts` for why it must never reach a
 * client bundle.
 *
 * The one thing this cannot do that the SQL seed can is wrap a puzzle and its solution in
 * a single transaction — PostgREST has no cross-request transaction. So a failure between
 * the two writes is compensated explicitly (the orphan puzzle is deleted), keeping the
 * canonical-hash reuse check honest on the next run.
 *
 * Idempotent: a date's parameters are derived from the date itself, an already-scheduled
 * date is left alone, and an existing board is reused rather than duplicated. Re-running
 * only ever fills gaps.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
	generate,
	generatePuzzle,
	type DifficultyTier,
	type GeneratedPuzzle
} from '../src/lib/solver/index';
import { entryParams, shiftDate, type SeedEntry } from '../src/lib/pool/seed-window';
import { planSchedule, type SchedulePlan } from '../src/lib/pool/schedule-plan';
import { pool } from '../src/lib/config/index';
import { dublinDate } from '../src/lib/streak/streak';

const url = process.env.PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url) throw new Error('PUBLIC_SUPABASE_URL is not set.');
if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not set (the service_role key).');

/** Report what would be scheduled and write nothing. `--dry-run` or `POOL_DRY_RUN=1`. */
const DRY_RUN =
	process.argv.includes('--dry-run') || /^(1|true)$/i.test(process.env.POOL_DRY_RUN ?? '');

/**
 * An operator override, or the configured default.
 *
 * Blank counts as absent, not as zero. A `workflow_dispatch` input that the operator left
 * empty arrives as an empty string on every run of the workflow — including the weekly
 * cron, where no inputs exist at all — and `Number('')` is `0`. Read literally, that would
 * silently set the horizon to nothing and make every run a no-op that then fails the
 * watermark. So: blank, missing or unparseable all fall back to config.
 */
function numberEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** How far ahead to keep the schedule. Defaults to the tunable `pool.horizonDays`. */
const HORIZON_DAYS = numberEnv('POOL_HORIZON_DAYS', pool.horizonDays);
/** Runway below this fails the run loudly. Defaults to `pool.loudFailWatermarkDays`. */
const WATERMARK_DAYS = numberEnv('POOL_WATERMARK_DAYS', pool.loudFailWatermarkDays);

/** A GitHub Actions annotation, so a failure is visible in the run summary, not just the log. */
function annotate(level: 'error' | 'warning', message: string): void {
	console.log(`::${level}::${message}`);
}

/** Every date `puzzle_schedule` already holds a row for, within `[from, to]`. */
async function scheduledDatesBetween(
	db: SupabaseClient,
	from: string,
	to: string
): Promise<string[]> {
	const { data, error } = await db
		.from('puzzle_schedule')
		.select('date')
		.gte('date', from)
		.lte('date', to);
	if (error) throw new Error(`schedule read failed: ${error.message}`);
	return (data as { date: string }[]).map((row) => row.date);
}

/**
 * Plan a run against what the schedule currently holds.
 *
 * Forward-looking only. This pipeline's job is runway; past dailies are history and must
 * not be rewritten, and the watermark verdict must only ever look forward or a long
 * archive would read as healthy runway.
 */
async function readPlan(db: SupabaseClient, today: string): Promise<SchedulePlan> {
	const scheduledDates = await scheduledDatesBetween(db, today, shiftDate(today, HORIZON_DAYS));
	return planSchedule({
		today,
		scheduledDates,
		horizonDays: HORIZON_DAYS,
		watermarkDays: WATERMARK_DAYS
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
 * The reject-sampling budget for a tier: the per-tier override where there is one,
 * otherwise the shared budget. Only `Intro` currently overrides it — a depth-0 board is
 * about a one-in-a-hundred draw, so the shared budget would miss Monday most weeks (#52).
 */
function attemptsFor(tier: DifficultyTier): number {
	return pool.tierAttemptsByTier[tier] ?? pool.tierAttemptsPerDate;
}

/**
 * Reject-sample a board into `entry`'s `(tier, size)` slot.
 *
 * `generate` samples boards at the target size and returns the first whose *computed*
 * tier matches — the generate-then-classify loop the spec locks. Exact-tier hits are not
 * guaranteed on any single draw, so it can exhaust its budget and report failure. When it
 * does we still fill the date, with a board at the right size whose tier is whatever it
 * scored, and say so loudly: a gap in the schedule breaks the daily outright, while an
 * off-slot tier is a curation blemish the operator can see and re-roll.
 */
function sampleForSlot(
	entry: SeedEntry,
	salt: number
): { puzzle: GeneratedPuzzle; onSlot: boolean } {
	const seed = entry.seed + salt;
	const onSlot = generate(entry.size, entry.tier, {
		seed,
		maxTierAttempts: attemptsFor(entry.tier)
	});
	if (onSlot) return { puzzle: onSlot, onSlot: true };
	return { puzzle: generatePuzzle(entry.size, { seed }), onSlot: false };
}

/** How one date was filled, for the run report. */
interface Filled {
	readonly puzzleId: string;
	readonly puzzle: GeneratedPuzzle;
	readonly reused: boolean;
	readonly onSlot: boolean;
}

/**
 * A puzzle ready to be scheduled for `entry.date`: an existing board with the same
 * canonical hash when that board is still unscheduled, otherwise a freshly inserted one.
 *
 * The loop exists for the one case that must not become a hard failure — the sampled
 * board's hash matches a puzzle that is ALREADY scheduled on another date. Reusing it
 * would violate the unique `puzzle_id`, and skipping the date would silently leave the
 * gap we are here to close, so we perturb the seed and sample a genuinely different board.
 */
async function fillDate(db: SupabaseClient, entry: SeedEntry): Promise<Filled> {
	for (let attempt = 0; attempt < pool.boardAttemptsPerDate; attempt++) {
		// A prime stride, so a perturbed seed lands far from any other date's seed.
		const { puzzle, onSlot } = sampleForSlot(entry, attempt * 7919);
		const existing = await existingPuzzleId(db, puzzle.secret.hash);

		if (existing === null) {
			return { puzzleId: await insertPuzzle(db, puzzle), puzzle, reused: false, onSlot };
		}
		if (!(await isPuzzleScheduled(db, existing))) {
			return { puzzleId: existing, puzzle, reused: true, onSlot };
		}
		// That board is spoken for by another date; try a different one.
	}
	throw new Error(
		`could not find an unscheduled board for ${entry.date} in ${pool.boardAttemptsPerDate} attempts`
	);
}

/**
 * Schedule `puzzleId` for `date`. `ignoreDuplicates` so a concurrent run that claimed the
 * date between our read and this write is a no-op rather than an error — the REST
 * equivalent of the local seed's `on conflict (date) do nothing`.
 */
async function scheduleDate(db: SupabaseClient, date: string, puzzleId: string): Promise<void> {
	const { error } = await db
		.from('puzzle_schedule')
		.upsert({ date, puzzle_id: puzzleId }, { onConflict: 'date', ignoreDuplicates: true });
	if (error) throw new Error(`schedule insert failed: ${error.message}`);
}

/**
 * Report the plan and stop. Nothing is generated and nothing is written.
 *
 * The report is exact rather than indicative: every date's `(tier, size)` target is a pure
 * function of the date, so what this prints is precisely what a real run would aim at.
 * Generation itself is skipped, which is what keeps a dry run instant.
 */
function reportDryRun(plan: SchedulePlan): void {
	console.log('DRY RUN — nothing will be generated and nothing will be written.\n');
	console.log(`Runway today: ${plan.runwayDays} day(s) of ${plan.horizonDays}.`);
	console.log(`${plan.targetDates.length} date(s) would be filled:\n`);

	for (const date of plan.targetDates) {
		const { tier, size } = plan.slotFor(date);
		console.log(`  would schedule  ${date}  ${size}×${size} · ${tier}`);
	}

	const after = plan.targetDates.length === 0 ? plan.runwayDays : plan.horizonDays;
	console.log(
		`\nRunway after a real run would be ${after} day(s), against a ` +
			`${plan.watermarkDays}-day watermark.`
	);
}

async function main(): Promise<void> {
	const db = createClient(url!, secretKey!, { auth: { persistSession: false } });
	const today = dublinDate();

	const plan = await readPlan(db, today);
	console.log(
		`Pool generation — today ${today}, horizon ${plan.horizonDays} day(s), ` +
			`watermark ${plan.watermarkDays} day(s).\n`
	);

	if (DRY_RUN) {
		reportDryRun(plan);
		return;
	}

	let scheduled = 0;
	let reused = 0;
	let offSlot = 0;

	for (const date of plan.targetDates) {
		const entry: SeedEntry = { date, ...entryParams(date) };
		const filled = await fillDate(db, entry);
		await scheduleDate(db, date, filled.puzzleId);

		const { size, tier } = filled.puzzle.public;
		const notes = [
			filled.reused ? 'board reused' : null,
			filled.onSlot ? null : `off-slot: wanted ${entry.tier}`
		].filter(Boolean);
		console.log(
			`  scheduled  ${date}  ${size}×${size} · ${tier}` +
				`${notes.length > 0 ? `  (${notes.join(', ')})` : ''}`
		);

		scheduled++;
		if (filled.reused) reused++;
		if (!filled.onSlot) offSlot++;
	}

	console.log(
		`\n${scheduled} date(s) newly scheduled, ${reused} board(s) reused, ${offSlot} off-slot.`
	);
	if (offSlot > 0) {
		annotate(
			'warning',
			`${offSlot} date(s) could not be reject-sampled onto their ramp tier within their ` +
				`attempt budget and were filled off-slot. The daily still works; re-dispatch this ` +
				`workflow to re-roll, or widen pool.tierAttemptsPerDate (or the per-tier override).`
		);
	}

	// The loud-fail watermark. Re-read rather than trusting the writes above: a concurrent
	// run, a partial failure or a rejected row must all show up as what the schedule now
	// actually holds.
	const after = await readPlan(db, today);
	console.log(
		`Runway now ${after.runwayDays} day(s) of ${after.horizonDays}, ` +
			`watermark ${after.watermarkDays}.`
	);

	if (!after.meetsWatermark) {
		annotate(
			'error',
			`The pool is starving: only ${after.runwayDays} day(s) of scheduled runway remain, ` +
				`below the ${after.watermarkDays}-day watermark. ${after.targetDates.length} date(s) ` +
				`in the horizon are still unfilled.`
		);
		throw new Error(
			`schedule runway ${after.runwayDays} day(s) is below the ` +
				`${after.watermarkDays}-day watermark`
		);
	}

	console.log('Pool generation complete.');
}

main().catch((error: unknown) => {
	console.error('Pool generation failed:', error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
