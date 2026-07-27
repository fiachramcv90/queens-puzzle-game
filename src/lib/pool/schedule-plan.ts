/**
 * The schedule plan: what one run of the generation pipeline has to fill, and whether
 * the pool is starving.
 *
 * The build spec keeps `puzzle_schedule` **~90 days ahead** with a **loud-fail 30-day
 * watermark** — the run fails visibly if runway drops below 30 days, so a starving pool
 * is discovered with a month to spare rather than on the morning it empties. Both
 * numbers are tunable operational values and live in `$lib/config` (`pool.horizonDays`,
 * `pool.loudFailWatermarkDays`); this module is the arithmetic that reads them.
 *
 * It is deliberately pure — it takes the dates already scheduled and returns the dates
 * still owed — so the two decisions that make a run pass or fail can be proven without a
 * database. The pipeline script (`scripts/seed-remote.ts`) supplies the schedule rows,
 * generates a board for each target date, and re-plans afterwards to check the watermark.
 *
 * **Runway is forward-looking and gap-stopping.** It counts *consecutive* scheduled days
 * starting at today, so a schedule with a hole three days out has three days of runway
 * however many rows sit beyond the hole. That is the honest reading: the daily breaks at
 * the first gap, not at the last row. Past dates are archive, never runway.
 */

import { rampSlotForDate, type RampSlot } from './ramp';
import { shiftDate } from './seed-window';

/** What to plan against: today, what is already scheduled, and the two pool numbers. */
export interface SchedulePlanOptions {
	/** Today's Dublin date, `YYYY-MM-DD`. */
	readonly today: string;
	/** Every date `puzzle_schedule` already holds a row for. Order and extent are free. */
	readonly scheduledDates: Iterable<string>;
	/** How many days of schedule to keep ahead, counting today (`pool.horizonDays`). */
	readonly horizonDays: number;
	/** Fall below this many days of runway and the run must fail loudly. */
	readonly watermarkDays: number;
}

/** What one run owes, and the verdict on the runway it found. */
export interface SchedulePlan {
	readonly today: string;
	readonly horizonDays: number;
	readonly watermarkDays: number;
	/** Dates inside the horizon with no schedule row, oldest first. */
	readonly targetDates: readonly string[];
	/** Consecutive scheduled days from today forward, capped at the horizon. */
	readonly runwayDays: number;
	/** Whether {@link runwayDays} is at or above {@link watermarkDays}. */
	readonly meetsWatermark: boolean;
	/** The `(tier, size)` slot a date is to be filled to — the ramp, carried for convenience. */
	slotFor(date: string): RampSlot;
	/**
	 * Whether a date is near enough that an off-slot board beats leaving it empty — see
	 * {@link withinWatermarkWindow}.
	 */
	acceptsOffSlotFill(date: string): boolean;
}

/**
 * Whether `date` falls inside the watermark window — today up to but not including
 * `today + watermarkDays`.
 *
 * This is the line the pipeline uses to decide what a reject-sample MISS costs (#53).
 * Inside the window a gap is dangerous and an off-slot board is the lesser harm; outside
 * it, leaving the date empty is strictly better, because the date stays in
 * {@link SchedulePlan.targetDates} and every subsequent weekly run tries it again — so a
 * miss self-heals to the correct tier instead of freezing a wrong-tier board in place.
 * (A filled date is never revisited: `targetDates` skips anything already scheduled.)
 *
 * The two halves interlock deliberately. Because a gap can only ever be created OUTSIDE
 * the window, and {@link runwayDays} stops counting at the first gap, a gap can never fail
 * the watermark on the run that made it. It fails only if it survives long enough to drift
 * inside the window — roughly eight more weekly attempts — at which point it genuinely is
 * an emergency and the run goes red. Loudness tracks consequence, with no second alarm.
 */
export function withinWatermarkWindow(today: string, date: string, watermarkDays: number): boolean {
	// Lexicographic comparison is date order for `YYYY-MM-DD`, so no parsing is owed.
	return date < shiftDate(today, watermarkDays);
}

/** The horizon: `today` and the following `horizonDays - 1` days, oldest first. */
export function horizonDates(today: string, horizonDays: number): string[] {
	return Array.from({ length: Math.max(0, horizonDays) }, (_unused, i) => shiftDate(today, i));
}

/**
 * Consecutive scheduled days from `today` forward, stopping at the first gap and never
 * counting past `limit`. `0` means today itself is unscheduled — the pool has run dry and
 * the daily is already falling back to an archive board.
 */
export function runwayDays(today: string, scheduled: ReadonlySet<string>, limit: number): number {
	let days = 0;
	while (days < limit && scheduled.has(shiftDate(today, days))) days++;
	return days;
}

/** Plan a run: the gaps to fill inside the horizon, and the runway verdict. */
export function planSchedule(options: SchedulePlanOptions): SchedulePlan {
	const { today, horizonDays, watermarkDays } = options;
	const scheduled = new Set(options.scheduledDates);

	const targetDates = horizonDates(today, horizonDays).filter((date) => !scheduled.has(date));
	const runway = runwayDays(today, scheduled, horizonDays);

	return {
		today,
		horizonDays,
		watermarkDays,
		targetDates,
		runwayDays: runway,
		meetsWatermark: runway >= watermarkDays,
		slotFor: rampSlotForDate,
		acceptsOffSlotFill: (date) => withinWatermarkWindow(today, date, watermarkDays)
	};
}
