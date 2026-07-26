import { describe, expect, test } from 'vitest';
import type { HistoryEntry } from '$lib/history/history';
import {
	PAGE_SIZE,
	offsetFor,
	ownStanding,
	rowToEntry,
	toPage,
	type LeaderboardRow
} from './leaderboard';

function row(over: Partial<LeaderboardRow> = {}): LeaderboardRow {
	return {
		rank: 1,
		display_name: 'Sam',
		elapsed_ms: 102000,
		mistakes: 0,
		is_you: false,
		...over
	};
}

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		puzzleDate: '2026-07-26',
		best: { elapsedMs: 102000, mistakes: 0, hintsUsed: 0, assisted: false },
		ranked: { elapsedMs: 102000, mistakes: 0, hintsUsed: 0, assisted: false },
		replayed: false,
		unranked: false,
		streakNeutral: false,
		assisted: false,
		...over
	};
}

describe('rowToEntry', () => {
	test('maps the row shape the function returns to the display entry', () => {
		expect(
			rowToEntry(row({ rank: 3, display_name: 'Ada', elapsed_ms: 90500, is_you: true }))
		).toEqual({
			rank: 3,
			displayName: 'Ada',
			elapsedMs: 90500,
			mistakes: 0,
			isYou: true
		});
	});

	test('coerces the bigint columns, which arrive as strings from postgrest', () => {
		const mapped = rowToEntry(row({ rank: '11', elapsed_ms: '187000' }));
		expect(mapped.rank).toBe(11);
		expect(mapped.elapsedMs).toBe(187000);
	});

	test('keeps a null mistake count null rather than coercing it to zero', () => {
		expect(rowToEntry(row({ mistakes: null })).mistakes).toBeNull();
	});
});

describe('offsetFor', () => {
	test('the first page starts at zero', () => {
		expect(offsetFor(0)).toBe(0);
	});

	test('each later page steps by one page of rows', () => {
		expect(offsetFor(1)).toBe(PAGE_SIZE);
		expect(offsetFor(4)).toBe(4 * PAGE_SIZE);
	});

	test('a negative page is clamped to the first page', () => {
		expect(offsetFor(-3)).toBe(0);
	});
});

describe('toPage', () => {
	test('a short read is the last page', () => {
		const rows = Array.from({ length: 3 }, (_, i) => row({ rank: i + 1 }));
		const page = toPage(rows, 25);
		expect(page.entries).toHaveLength(3);
		expect(page.hasNext).toBe(false);
	});

	test('an exactly-full read is still the last page', () => {
		const rows = Array.from({ length: 25 }, (_, i) => row({ rank: i + 1 }));
		const page = toPage(rows, 25);
		expect(page.entries).toHaveLength(25);
		expect(page.hasNext).toBe(false);
	});

	test('the probe row beyond the page is reported, not displayed', () => {
		const rows = Array.from({ length: 26 }, (_, i) => row({ rank: i + 1 }));
		const page = toPage(rows, 25);
		expect(page.entries).toHaveLength(25);
		expect(page.entries.at(-1)?.rank).toBe(25);
		expect(page.hasNext).toBe(true);
	});
});

describe('ownStanding', () => {
	test('no completed play today means nothing to show', () => {
		expect(ownStanding(null)).toBeNull();
	});

	test('one clean solve shows a single time with no explanation to give', () => {
		const standing = ownStanding(entry());
		expect(standing).toEqual({
			bestMs: 102000,
			rankedMs: 102000,
			differ: false,
			reason: null
		});
	});

	test('a faster replay shows both times and names the first-attempt rule', () => {
		const standing = ownStanding(
			entry({
				best: { elapsedMs: 102000, mistakes: 0, hintsUsed: 0, assisted: false },
				ranked: { elapsedMs: 190000, mistakes: 1, hintsUsed: 0, assisted: false },
				replayed: true
			})
		);
		expect(standing?.bestMs).toBe(102000);
		expect(standing?.rankedMs).toBe(190000);
		expect(standing?.differ).toBe(true);
		expect(standing?.reason).toMatch(/first completed attempt/i);
	});

	test('an assisted solve has no ranked time, and the reason says so', () => {
		const standing = ownStanding(
			entry({
				ranked: null,
				unranked: true,
				assisted: true,
				best: { elapsedMs: 102000, mistakes: 0, hintsUsed: 2, assisted: true }
			})
		);
		expect(standing?.rankedMs).toBeNull();
		expect(standing?.differ).toBe(false);
		expect(standing?.reason).toMatch(/assisted/i);
	});

	test('an archive solve has no ranked time, and the reason is the frozen board', () => {
		const standing = ownStanding(entry({ ranked: null, unranked: true, streakNeutral: true }));
		expect(standing?.rankedMs).toBeNull();
		expect(standing?.reason).toMatch(/archive/i);
	});

	test('any other unranked solve still gets an explanation', () => {
		const standing = ownStanding(entry({ ranked: null, unranked: true }));
		expect(standing?.rankedMs).toBeNull();
		expect(standing?.reason).toBeTruthy();
	});
});
