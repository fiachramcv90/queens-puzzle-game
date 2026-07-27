import { describe, expect, test } from 'vitest';
import { WEEKLY_RAMP, rampSlotForDate } from './ramp';
import { horizonDates, planSchedule, runwayDays, withinWatermarkWindow } from './schedule-plan';
import { shiftDate } from './seed-window';

/**
 * The schedule plan — what one run of the generation pipeline must fill, and whether the
 * pool is starving.
 *
 * This is the half of the pipeline worth testing in isolation: the runway arithmetic and
 * the watermark verdict decide whether a run passes or fails loudly, and neither should
 * need a database to prove. The pipeline script then does exactly one thing on top —
 * generate a board per target date and write it.
 */

/** The `n` dates from `today` forward, inclusive, as a schedule would hold them. */
const consecutive = (today: string, n: number) =>
	Array.from({ length: n }, (_unused, i) => shiftDate(today, i));

describe('horizonDates', () => {
	test('spans today plus the rest of the horizon, inclusive', () => {
		expect(horizonDates('2026-07-26', 3)).toEqual(['2026-07-26', '2026-07-27', '2026-07-28']);
	});

	test('a horizon of one day is today alone', () => {
		expect(horizonDates('2026-07-26', 1)).toEqual(['2026-07-26']);
	});

	test('is gap-free across a month boundary', () => {
		const dates = horizonDates('2026-07-30', 4);
		expect(dates).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
	});

	test('a 90-day horizon holds 90 dates', () => {
		expect(horizonDates('2026-07-26', 90)).toHaveLength(90);
	});
});

/**
 * The watermark window — the line deciding what a reject-sample MISS costs (#53).
 *
 * Inside it, a miss is filled off-slot because a gap that close would break the daily for
 * everyone. Outside it, the date is left empty so a later run can retry it onto the right
 * tier, rather than freezing a wrong-tier board in place forever.
 */
describe('withinWatermarkWindow', () => {
	test('today is inside the window', () => {
		expect(withinWatermarkWindow('2026-07-26', '2026-07-26', 30)).toBe(true);
	});

	test('the last day of the window is inside it and the next day is not', () => {
		expect(withinWatermarkWindow('2026-07-26', '2026-08-24', 30)).toBe(true); // +29
		expect(withinWatermarkWindow('2026-07-26', '2026-08-25', 30)).toBe(false); // +30
	});

	test('a far horizon date is outside it', () => {
		expect(withinWatermarkWindow('2026-07-26', '2026-10-20', 30)).toBe(false);
	});

	test('compares as calendar dates across a year boundary, not as strings by luck', () => {
		expect(withinWatermarkWindow('2026-12-20', '2027-01-05', 30)).toBe(true);
		expect(withinWatermarkWindow('2026-12-20', '2027-02-05', 30)).toBe(false);
	});

	/**
	 * The interlock that makes the two halves safe together: a gap is only ever created
	 * outside the window, and `runwayDays` stops at the first gap — so the run that creates
	 * a gap always still meets the watermark, and only a gap that survives until it drifts
	 * inside the window turns the run red.
	 */
	test('a date left open is always beyond the runway the watermark demands', () => {
		const today = '2026-07-26';
		const watermark = 30;
		// Every date the pipeline is allowed to leave open...
		const leavable = horizonDates(today, 90).filter(
			(date) => !withinWatermarkWindow(today, date, watermark)
		);
		for (const gap of leavable) {
			// ...still leaves a full watermark's worth of consecutive days in front of it.
			const scheduled = horizonDates(today, 90).filter((date) => date !== gap);
			const plan = planSchedule({
				today,
				scheduledDates: scheduled,
				horizonDays: 90,
				watermarkDays: watermark
			});
			expect(plan.meetsWatermark).toBe(true);
		}
	});
});

describe('runwayDays', () => {
	test('counts consecutive scheduled days from today', () => {
		expect(runwayDays('2026-07-26', new Set(consecutive('2026-07-26', 5)), 90)).toBe(5);
	});

	test('is zero when today itself is unscheduled — the pool has already run dry', () => {
		expect(runwayDays('2026-07-26', new Set(consecutive('2026-07-27', 40)), 90)).toBe(0);
	});

	test('stops at the first gap rather than counting scheduled dates beyond it', () => {
		const scheduled = new Set([...consecutive('2026-07-26', 3), ...consecutive('2026-08-10', 30)]);
		expect(runwayDays('2026-07-26', scheduled, 90)).toBe(3);
	});

	test('ignores past dates — the archive is not runway', () => {
		const scheduled = new Set(consecutive('2026-06-01', 40));
		expect(runwayDays('2026-07-26', scheduled, 90)).toBe(0);
	});

	test('never counts past the limit it is given', () => {
		expect(runwayDays('2026-07-26', new Set(consecutive('2026-07-26', 200)), 90)).toBe(90);
	});
});

describe('planSchedule', () => {
	const options = { today: '2026-07-26', horizonDays: 90, watermarkDays: 30 };

	test('an empty schedule needs every date in the horizon filled', () => {
		const plan = planSchedule({ ...options, scheduledDates: [] });
		expect(plan.targetDates).toHaveLength(90);
		expect(plan.targetDates[0]).toBe('2026-07-26');
		expect(plan.runwayDays).toBe(0);
	});

	test('a full horizon needs nothing filled and clears the watermark', () => {
		const plan = planSchedule({ ...options, scheduledDates: consecutive('2026-07-26', 90) });
		expect(plan.targetDates).toEqual([]);
		expect(plan.runwayDays).toBe(90);
		expect(plan.meetsWatermark).toBe(true);
	});

	test('targets only the gaps, in date order', () => {
		const scheduled = consecutive('2026-07-26', 90).filter(
			(date) => date !== '2026-08-01' && date !== '2026-09-15'
		);
		const plan = planSchedule({ ...options, scheduledDates: scheduled });
		expect(plan.targetDates).toEqual(['2026-08-01', '2026-09-15']);
	});

	test('ignores schedule rows outside the horizon rather than counting them as runway', () => {
		const plan = planSchedule({
			...options,
			scheduledDates: [...consecutive('2026-01-01', 100), ...consecutive('2027-01-01', 10)]
		});
		expect(plan.targetDates).toHaveLength(90);
		expect(plan.runwayDays).toBe(0);
	});

	test('reports the watermark breached when runway is under it', () => {
		const plan = planSchedule({ ...options, scheduledDates: consecutive('2026-07-26', 29) });
		expect(plan.runwayDays).toBe(29);
		expect(plan.meetsWatermark).toBe(false);
	});

	test('runway exactly at the watermark is not a breach — the fail is *below* it', () => {
		const plan = planSchedule({ ...options, scheduledDates: consecutive('2026-07-26', 30) });
		expect(plan.runwayDays).toBe(30);
		expect(plan.meetsWatermark).toBe(true);
	});

	test('carries the watermark through, so the caller reports one number not two', () => {
		const plan = planSchedule({ ...options, scheduledDates: [] });
		expect(plan.watermarkDays).toBe(30);
		expect(plan.horizonDays).toBe(90);
	});

	test('carries the off-slot verdict for each date, against its own watermark', () => {
		const plan = planSchedule({
			today: '2026-07-26',
			scheduledDates: [],
			horizonDays: 90,
			watermarkDays: 30
		});
		expect(plan.acceptsOffSlotFill('2026-07-26')).toBe(true); // today
		expect(plan.acceptsOffSlotFill('2026-08-24')).toBe(true); // last day inside
		expect(plan.acceptsOffSlotFill('2026-08-25')).toBe(false); // first day outside
		expect(plan.acceptsOffSlotFill('2026-10-20')).toBe(false); // far out
	});

	test('every target date carries its ramp slot', () => {
		const plan = planSchedule({ ...options, scheduledDates: [] });
		for (const date of plan.targetDates) {
			expect(plan.slotFor(date)).toEqual(rampSlotForDate(date));
		}
	});

	test('a 90-day horizon covers the whole ramp, so no tier goes unused', () => {
		const plan = planSchedule({ ...options, scheduledDates: [] });
		const tiers = new Set(plan.targetDates.map((date) => plan.slotFor(date).tier));
		expect(tiers.size).toBe(new Set(WEEKLY_RAMP.map((slot) => slot.tier)).size);
	});

	test('is idempotent — re-planning against a filled schedule asks for nothing more', () => {
		const first = planSchedule({ ...options, scheduledDates: [] });
		const second = planSchedule({ ...options, scheduledDates: first.targetDates });
		expect(second.targetDates).toEqual([]);
		expect(second.meetsWatermark).toBe(true);
	});
});
