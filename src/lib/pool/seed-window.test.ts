import { describe, expect, test } from 'vitest';
import { rampSlotForDate } from './ramp';
import { LEGACY_SEEDS, buildSeedWindow, entryParams, seedForDate, shiftDate } from './seed-window';

/**
 * The seed window — the shared input both seed scripts build their dailies from.
 *
 * These tests exist because of a real failure: a positional seed formula handed
 * 2026-08-07 the pair (size 9, seed 1003), identical to a legacy hand-picked entry, so
 * the generator reproduced a board that was already scheduled and the seed run died on
 * `puzzle_schedule.puzzle_id`'s unique constraint. The window is therefore asserted to be
 * gap-free, collision-free and stable per date.
 */

describe('shiftDate', () => {
	test('shifts forward and back across a month boundary', () => {
		expect(shiftDate('2026-07-31', 1)).toBe('2026-08-01');
		expect(shiftDate('2026-08-01', -1)).toBe('2026-07-31');
	});

	test('shifts across a year boundary', () => {
		expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
	});

	test('handles a leap day', () => {
		expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
	});

	test('a zero shift is identity', () => {
		expect(shiftDate('2026-07-26', 0)).toBe('2026-07-26');
	});
});

describe('seedForDate', () => {
	test('is the date as YYYYMMDD', () => {
		expect(seedForDate('2026-08-07')).toBe(20260807);
	});

	test('is stable — the same date always seeds the same board', () => {
		expect(seedForDate('2026-08-07')).toBe(seedForDate('2026-08-07'));
	});

	test('never lands on a legacy hand-picked seed', () => {
		// The legacy seeds are small (1001–1006); a YYYYMMDD seed cannot reach them.
		for (const legacy of LEGACY_SEEDS) {
			expect(seedForDate('2026-08-07')).not.toBe(legacy);
		}
	});
});

describe('buildSeedWindow', () => {
	const window = buildSeedWindow({ today: '2026-07-26', pastDays: 21, futureDays: 14 });

	test('spans past through future inclusive of today', () => {
		expect(window).toHaveLength(36);
		expect(window[0].date).toBe('2026-07-05');
		expect(window[window.length - 1].date).toBe('2026-08-09');
		expect(window.some((e) => e.date === '2026-07-26')).toBe(true);
	});

	test('is gap-free and ordered oldest first', () => {
		for (let i = 1; i < window.length; i++) {
			expect(window[i].date).toBe(shiftDate(window[i - 1].date, 1));
		}
	});

	test('every date has a distinct seed', () => {
		expect(new Set(window.map((e) => e.seed)).size).toBe(window.length);
	});

	test('no (size, seed) pair collides with a legacy entry — the 2026-08-07 regression', () => {
		// A collision here regenerates an already-scheduled board, which cannot be
		// rescheduled: puzzle_schedule.puzzle_id is unique.
		const collisions = window.filter((e) => LEGACY_SEEDS.includes(e.seed));
		expect(collisions).toEqual([]);
	});

	test('sizes stay within the generator’s supported range', () => {
		for (const entry of window) {
			expect(entry.size).toBeGreaterThanOrEqual(7);
			expect(entry.size).toBeLessThanOrEqual(11);
		}
	});

	test('consecutive dailies vary in size rather than repeating one board size', () => {
		expect(new Set(window.map((e) => e.size)).size).toBeGreaterThan(1);
	});

	test('a window anchored on a different today still contains that today', () => {
		const other = buildSeedWindow({ today: '2026-12-31', pastDays: 2, futureDays: 2 });
		expect(other.map((e) => e.date)).toEqual([
			'2026-12-29',
			'2026-12-30',
			'2026-12-31',
			'2027-01-01',
			'2027-01-02'
		]);
	});

	test('every date takes its (tier, size) from the weekly ramp', () => {
		for (const entry of window) {
			const slot = rampSlotForDate(entry.date);
			expect(entry.tier).toBe(slot.tier);
			expect(entry.size).toBe(slot.size);
		}
	});

	test('a date keeps its board parameters regardless of which window it appears in', () => {
		const wide = buildSeedWindow({ today: '2026-07-26', pastDays: 40, futureDays: 40 });
		const entry = wide.find((e) => e.date === '2026-08-07');
		expect(entry).toEqual({ date: '2026-08-07', ...entryParams('2026-08-07') });
	});

	test('a date keeps its seed regardless of which window it appears in', () => {
		const wide = buildSeedWindow({ today: '2026-07-26', pastDays: 40, futureDays: 40 });
		const narrow = buildSeedWindow({ today: '2026-07-26', pastDays: 1, futureDays: 1 });
		const from = (w: typeof wide, date: string) => w.find((e) => e.date === date)?.seed;
		expect(from(narrow, '2026-07-26')).toBe(from(wide, '2026-07-26'));
	});
});
