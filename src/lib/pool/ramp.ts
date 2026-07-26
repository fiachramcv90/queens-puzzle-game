/**
 * The weekly ramp: which `(tier, size)` slot each date in the pool is filled to.
 *
 * The build spec (issue #18, "Daily rollover and scheduling") locks the shape rather
 * than the cells: *a gentle Mon→Sun climb with board size trending up alongside tier,
 * Expert at the weekend — monotonic-ish and curated, not a rigid tier-per-weekday.*
 *
 * "Curated, not rigid" is what the plateaus below express. Tuesday and Wednesday share
 * a tier, and so do Saturday and Sunday, so the week reads as a climb with rest steps
 * rather than five equal jumps — while size keeps moving underneath, which is the
 * second, separate difficulty axis. That is deliberately a hand-picked table: it is a
 * curation decision about how the daily should feel, so it lives here as code next to
 * the pipeline that reads it, not in `$lib/config` with the tunable operational numbers
 * (the horizon, the watermark, the retry budgets).
 *
 * The pipeline reject-samples into these slots: it generates at the slot's size and
 * keeps a board only when the *computed* tier matches. The ramp names the target; the
 * solver core decides whether a given board hits it.
 *
 * ## Why the week starts at Medium and not at Intro
 *
 * Every slot below is **reachable** — measured against the current generator and the
 * current `scoreDifficulty` cut points, each one is hit within the reject-sampling budget
 * (`config.pool.tierAttemptsPerDate`) reliably — measured at 28 consecutive dates, all 28
 * landed on slot, in 2.8s of CPU total.
 *
 * That constraint is what shapes the low end. With today's cut points the *easiest board
 * the generator reliably makes* is a Medium: sampled across every irregularity bias, a
 * 7×7 scores 49–86 almost always, against an `Easy` ceiling of 45 and an `Intro` ceiling
 * of 20. Intro turns up in roughly one draw in twenty-five, and `Easy` in none — so
 * neither is a slot a date could be filled to dependably. Board size is the
 * second-heaviest term in the score and 7 is already its floor, so there is no smaller
 * board to reach for.
 *
 * Aiming the ramp at tiers the generator cannot produce would not make easier dailies —
 * it would make every Monday and Tuesday miss its slot and get filled off-target, so the
 * ramp would be fiction while the boards stayed exactly as hard. A ramp of reachable
 * slots is the honest version of the same curve: it still climbs gently, still trends
 * size up alongside tier, still puts Expert at the weekend.
 *
 * The fix for the low end is recalibration, not a different ramp: `difficulty.ts` holds
 * the weights and the tier cut points, and the build spec already books that in as a
 * post-launch fast-follow against real solve times. When the cut points move, move the
 * two early cells here with them — nothing else in the pipeline is affected.
 */

import type { DifficultyTier } from '$lib/solver';

/** One day's target on the ramp: reject-sample until a board of this size scores this tier. */
export interface RampSlot {
	readonly tier: DifficultyTier;
	/** Board size N (7–11), the second difficulty axis — an input to the score, not the tier. */
	readonly size: number;
}

/**
 * The ramp, Monday first. Both columns are non-decreasing across the week, and the tier
 * never climbs more than one step in a day.
 */
export const WEEKLY_RAMP: readonly RampSlot[] = [
	{ tier: 'Medium', size: 7 }, // Mon — the gentlest board the generator currently makes
	{ tier: 'Hard', size: 7 }, // Tue — same size, a harder region layout
	{ tier: 'Hard', size: 8 }, // Wed — a tier plateau, so the climb is not mechanical
	{ tier: 'Hard', size: 9 }, // Thu — size carries the difficulty this time
	{ tier: 'Expert', size: 9 }, // Fri
	{ tier: 'Expert', size: 10 }, // Sat — Expert at the weekend
	{ tier: 'Expert', size: 11 } // Sun — the week's hardest board
] as const;

/**
 * The day of the week a `YYYY-MM-DD` Dublin date falls on, `0` = Monday … `6` = Sunday.
 *
 * Computed at UTC midnight so it never depends on the runtime zone — the same pure
 * calendar arithmetic `shiftDate` in `./seed-window` uses. A daily's date is already the
 * in-zone Dublin date by the time it reaches here, so no further zone handling is owed.
 */
export function weekdayIndex(date: string): number {
	const [year, month, day] = date.split('-').map(Number);
	// `getUTCDay()` is 0 = Sunday; rotate so the ramp can be written Monday-first.
	return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** The ramp slot a date is to be filled to. */
export function rampSlotForDate(date: string): RampSlot {
	return WEEKLY_RAMP[weekdayIndex(date)];
}
