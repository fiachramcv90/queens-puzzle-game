import { describe, expect, test } from 'vitest';
import {
	computeStreak,
	dublinDate,
	effectiveStreak,
	isAtRisk,
	previousDate,
	viewStreak,
	type StreakCache
} from './streak';

describe('dublinDate mirrors the SQL rollover rule in-zone', () => {
	test('renders ISO YYYY-MM-DD', () => {
		// 2026-07-25 12:00 UTC is the same calendar day in Dublin (UTC+1 in summer).
		expect(dublinDate(new Date('2026-07-25T12:00:00Z'))).toBe('2026-07-25');
	});

	test('is computed in Dublin, not UTC — a late-evening UTC instant is still Dublin-tomorrow in summer', () => {
		// 23:30 UTC on 2026-07-25 is 00:30 on 2026-07-26 in Dublin (UTC+1 in July).
		expect(dublinDate(new Date('2026-07-25T23:30:00Z'))).toBe('2026-07-26');
	});

	test('handles the winter offset (Dublin == UTC) correctly', () => {
		expect(dublinDate(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-15');
	});
});

describe('previousDate is pure Dublin-calendar arithmetic', () => {
	test('steps back one day', () => {
		expect(previousDate('2026-07-25')).toBe('2026-07-24');
	});
	test('crosses a month boundary', () => {
		expect(previousDate('2026-08-01')).toBe('2026-07-31');
	});
	test('crosses a year boundary', () => {
		expect(previousDate('2026-01-01')).toBe('2025-12-31');
	});
	test('steps across the spring DST transition without drifting', () => {
		// Ireland springs forward on 2026-03-29; the calendar day before is the 28th.
		expect(previousDate('2026-03-29')).toBe('2026-03-28');
	});
});

describe('computeStreak rebuilds the three facts from solved dates', () => {
	test('no solves is a zero streak with no last date', () => {
		expect(computeStreak([])).toEqual({
			currentStreak: 0,
			longestStreak: 0,
			lastStreakDate: null
		});
	});

	test('a single solve is a streak of one', () => {
		expect(computeStreak(['2026-07-25'])).toEqual({
			currentStreak: 1,
			longestStreak: 1,
			lastStreakDate: '2026-07-25'
		});
	});

	test('consecutive days accumulate', () => {
		expect(computeStreak(['2026-07-23', '2026-07-24', '2026-07-25'])).toEqual({
			currentStreak: 3,
			longestStreak: 3,
			lastStreakDate: '2026-07-25'
		});
	});

	test('order and duplicates in the input do not matter', () => {
		expect(computeStreak(['2026-07-25', '2026-07-23', '2026-07-24', '2026-07-25'])).toEqual({
			currentStreak: 3,
			longestStreak: 3,
			lastStreakDate: '2026-07-25'
		});
	});

	test('a gap resets the current run but longest survives — a bad week keeps a good year', () => {
		const cache = computeStreak([
			// A 3-day run, a gap, then a 2-day run ending most recently.
			'2026-07-01',
			'2026-07-02',
			'2026-07-03',
			'2026-07-20',
			'2026-07-21'
		]);
		expect(cache.currentStreak).toBe(2);
		expect(cache.longestStreak).toBe(3);
		expect(cache.lastStreakDate).toBe('2026-07-21');
	});
});

describe('effectiveStreak is the time-aware at-risk read', () => {
	const cache: StreakCache = {
		currentStreak: 5,
		longestStreak: 9,
		lastStreakDate: '2026-07-24'
	};

	test('solved today reads the full cached streak', () => {
		const solvedToday: StreakCache = { ...cache, lastStreakDate: '2026-07-25' };
		expect(effectiveStreak(solvedToday, '2026-07-25')).toBe(5);
	});

	test('solved yesterday, pending today still reads the full streak (never lose it before the day elapses)', () => {
		expect(effectiveStreak(cache, '2026-07-25')).toBe(5);
	});

	test('a fully-elapsed unsolved day reads 0 — with no write in between', () => {
		// One more day has passed with no solve: last is now two days back.
		expect(effectiveStreak(cache, '2026-07-26')).toBe(0);
	});

	test('never having solved reads 0', () => {
		expect(effectiveStreak({ currentStreak: 0, longestStreak: 0, lastStreakDate: null })).toBe(0);
	});
});

describe('isAtRisk distinguishes the held-but-pending state', () => {
	const cache: StreakCache = { currentStreak: 5, longestStreak: 9, lastStreakDate: '2026-07-24' };

	test('held from yesterday and not yet solved today is at-risk', () => {
		expect(isAtRisk(cache, '2026-07-25')).toBe(true);
	});

	test('solved today is safe, not at-risk', () => {
		expect(isAtRisk({ ...cache, lastStreakDate: '2026-07-25' }, '2026-07-25')).toBe(false);
	});

	test('already lapsed is not at-risk — there is nothing left to lose', () => {
		expect(isAtRisk(cache, '2026-07-27')).toBe(false);
	});

	test('a zero streak is never at-risk', () => {
		expect(
			isAtRisk({ currentStreak: 0, longestStreak: 0, lastStreakDate: null }, '2026-07-25')
		).toBe(false);
	});
});

describe('viewStreak projects the cache for the UI', () => {
	test('surfaces the at-risk held streak as current with the flag set', () => {
		const cache: StreakCache = { currentStreak: 4, longestStreak: 7, lastStreakDate: '2026-07-24' };
		expect(viewStreak(cache, '2026-07-25')).toEqual({ current: 4, longest: 7, atRisk: true });
	});

	test('surfaces a lapsed streak as 0 while longest survives', () => {
		const cache: StreakCache = { currentStreak: 4, longestStreak: 7, lastStreakDate: '2026-07-24' };
		expect(viewStreak(cache, '2026-07-30')).toEqual({ current: 0, longest: 7, atRisk: false });
	});
});
