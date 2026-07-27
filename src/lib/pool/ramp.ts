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
 * ## Why the week starts at Intro, and skips Easy (#52)
 *
 * Every slot below is **reachable** — each is hit within its reject-sampling budget
 * (`config.pool.tierAttemptsPerDate`, with the per-tier override beside it) reliably.
 *
 * The low end is shaped by a discontinuity in the score rather than by board size. The
 * dominant term is forced-deduction depth, an INTEGER, normalised `depth / (depth + 1.5)`
 * and weighted 100: depth 0 contributes 0, depth 1 contributes 40. At 7×7 the size term
 * is exactly 0 (it normalises `(size - 7) / 4`), so a 7×7 scores either **~9** — the board
 * falls to pure propagation, no guessing anywhere — or **≥45**, once any hypothesis is
 * needed. Nothing lands between. Measured over 600 boards across ten irregularity biases:
 * 22 scored 8.6–9.1, the rest 45–87, and **not one** landed in the 10–45 band.
 *
 * `Easy` occupies 20–45 at this size, so it is not merely rare — it is **structurally
 * unreachable**, and it stays unreachable at a smaller board, because the size term is
 * already clamped to 0 at the floor. That also means reducing the size weight would not
 * open it up. Only recalibration will: `difficulty.ts` holds the weights and the cut
 * points, and the spec books that in as a post-launch fast-follow against real solve
 * times. When the cut points move, revisit the ladder here.
 *
 * `Intro` **is** reachable — roughly one 7×7 draw in a hundred is depth 0 — which is why
 * Monday aims at it. Those boards are not visually plainer for being easy: their region
 * size variance runs 8.9–20.0, ABOVE the Mediums at 6.3–17.1. They read as proper Queens
 * boards that happen to never force a guess, which is exactly what a Monday should be.
 *
 * So the reachable ladder is **Intro → Medium → Hard → Expert**, and the week climbs one
 * reachable step at a time. It is still gentle, still trends size up alongside tier, still
 * puts Expert at the weekend; the gap where `Easy` would sit is the score's, not the
 * ramp's.
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
 * never climbs more than one REACHABLE step in a day — `Easy` is skipped because no board
 * can score into it, not because the week jumps (see the module doc).
 */
export const WEEKLY_RAMP: readonly RampSlot[] = [
	{ tier: 'Intro', size: 7 }, // Mon — depth 0: solvable by propagation alone, no guessing
	{ tier: 'Medium', size: 7 }, // Tue — same size, but now a hypothesis is needed
	{ tier: 'Hard', size: 8 }, // Wed — tier and size both step up
	{ tier: 'Hard', size: 9 }, // Thu — a tier plateau; size carries the climb instead
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
