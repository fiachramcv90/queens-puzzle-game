import { describe, expect, test } from 'vitest';
import { DIFFICULTY_TIERS, type DifficultyTier } from '$lib/solver';
import { WEEKLY_RAMP, rampSlotForDate, weekdayIndex } from './ramp';

/**
 * The weekly ramp — the curated Mon→Sun climb that decides which `(tier, size)` slot
 * each scheduled date is reject-sampled into.
 *
 * The build spec locks the *shape*, not the exact cells: a gentle climb, size trending
 * up alongside tier, Expert at the weekend, monotonic-ish rather than a rigid
 * tier-per-weekday. These tests assert that shape, so the table stays curatable without
 * a test rewrite every time a cell is nudged.
 */

const tierRank = (tier: DifficultyTier) => DIFFICULTY_TIERS.indexOf(tier);

describe('weekdayIndex', () => {
	test('is 0 on Monday and 6 on Sunday', () => {
		// 2026-07-27 is a Monday.
		expect(weekdayIndex('2026-07-27')).toBe(0);
		expect(weekdayIndex('2026-08-02')).toBe(6);
	});

	test('covers every day of one week exactly once', () => {
		const week = [
			'2026-07-27',
			'2026-07-28',
			'2026-07-29',
			'2026-07-30',
			'2026-07-31',
			'2026-08-01',
			'2026-08-02'
		];
		expect(week.map(weekdayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	test('is pure calendar arithmetic, so it holds across a year boundary', () => {
		expect(weekdayIndex('2027-01-01')).toBe(4); // Friday
	});
});

describe('WEEKLY_RAMP', () => {
	test('has one slot per day of the week, Monday first', () => {
		expect(WEEKLY_RAMP).toHaveLength(7);
	});

	test('every size sits inside the generator’s supported 7–11 range', () => {
		for (const slot of WEEKLY_RAMP) {
			expect(slot.size).toBeGreaterThanOrEqual(7);
			expect(slot.size).toBeLessThanOrEqual(11);
		}
	});

	test('climbs monotonically in tier across the week', () => {
		for (let i = 1; i < WEEKLY_RAMP.length; i++) {
			expect(tierRank(WEEKLY_RAMP[i].tier)).toBeGreaterThanOrEqual(
				tierRank(WEEKLY_RAMP[i - 1].tier)
			);
		}
	});

	test('size trends up alongside tier rather than independently', () => {
		for (let i = 1; i < WEEKLY_RAMP.length; i++) {
			expect(WEEKLY_RAMP[i].size).toBeGreaterThanOrEqual(WEEKLY_RAMP[i - 1].size);
		}
	});

	test('is a gentle climb — it never jumps more than one tier in a day', () => {
		for (let i = 1; i < WEEKLY_RAMP.length; i++) {
			expect(tierRank(WEEKLY_RAMP[i].tier) - tierRank(WEEKLY_RAMP[i - 1].tier)).toBeLessThanOrEqual(
				1
			);
		}
	});

	test('puts Expert at the weekend', () => {
		expect(WEEKLY_RAMP[5].tier).toBe('Expert'); // Saturday
		expect(WEEKLY_RAMP[6].tier).toBe('Expert'); // Sunday
	});

	test('starts the week strictly gentler than it ends, on both axes', () => {
		const [monday] = WEEKLY_RAMP;
		const sunday = WEEKLY_RAMP[WEEKLY_RAMP.length - 1];
		expect(tierRank(monday.tier)).toBeLessThan(tierRank(sunday.tier));
		expect(monday.size).toBeLessThan(sunday.size);
	});

	test('aims only at tiers the generator can actually produce', () => {
		// With the current `scoreDifficulty` cut points a 7×7 scores well above the Easy
		// ceiling, so Intro and Easy are unreachable at every supported size. Aiming at
		// them would make the early week miss its slot every day without producing an
		// easier board — see the module doc. Recalibration moves this, not the ramp.
		for (const slot of WEEKLY_RAMP) {
			expect(slot.tier).not.toBe('Intro');
			expect(slot.tier).not.toBe('Easy');
		}
	});

	test('is curated, not a rigid tier-per-weekday — at least one tier plateaus', () => {
		const tiers = WEEKLY_RAMP.map((slot) => slot.tier);
		expect(new Set(tiers).size).toBeLessThan(WEEKLY_RAMP.length);
	});
});

describe('rampSlotForDate', () => {
	test('reads the slot for the date’s weekday', () => {
		expect(rampSlotForDate('2026-07-27')).toEqual(WEEKLY_RAMP[0]);
		expect(rampSlotForDate('2026-08-02')).toEqual(WEEKLY_RAMP[6]);
	});

	test('is stable — the same date always lands in the same slot', () => {
		expect(rampSlotForDate('2026-08-07')).toEqual(rampSlotForDate('2026-08-07'));
	});

	test('repeats weekly, so a date and the date seven days later share a slot', () => {
		expect(rampSlotForDate('2026-07-27')).toEqual(rampSlotForDate('2026-08-03'));
	});
});
