import { describe, expect, test } from 'vitest';
import { buildHistory, isRanked, type PlayRecord } from './history';

/**
 * The history builder — the pure domain logic behind the history view, shared by
 * both the guest (local records) and the signed-in player (server rows). It
 * encodes the two rules the spec is emphatic must be written down explicitly:
 * history takes the BEST result per day; ranked takes the FIRST completed
 * in-window play. Archive plays (played outside their own daily's window) are
 * recorded but streak-neutral and unranked.
 */

/** A completed in-window ranked play — the ordinary case. */
function ranked(overrides: Partial<PlayRecord> = {}): PlayRecord {
	return {
		puzzleDate: '2026-07-10',
		playedDate: '2026-07-10',
		attemptNo: 1,
		completed: true,
		elapsedMs: 90_000,
		mistakes: 0,
		hintsUsed: 0,
		assisted: false,
		stale: false,
		unverified: false,
		replay: false,
		...overrides
	};
}

describe('isRanked', () => {
	test('a completed, in-window, clean first play is ranked', () => {
		expect(isRanked(ranked())).toBe(true);
	});

	test('an archive play (played outside its window) is not ranked', () => {
		expect(isRanked(ranked({ playedDate: '2026-07-25' }))).toBe(false);
	});

	test('a replay is not ranked', () => {
		expect(isRanked(ranked({ replay: true, attemptNo: 2 }))).toBe(false);
	});

	test('an assisted, stale or unverified play is not ranked', () => {
		expect(isRanked(ranked({ assisted: true }))).toBe(false);
		expect(isRanked(ranked({ stale: true }))).toBe(false);
		expect(isRanked(ranked({ unverified: true }))).toBe(false);
	});

	test('an uncompleted play is not ranked', () => {
		expect(isRanked(ranked({ completed: false }))).toBe(false);
	});
});

describe('buildHistory', () => {
	test('lists one entry per day, most recent first', () => {
		const entries = buildHistory([
			ranked({ puzzleDate: '2026-07-10', playedDate: '2026-07-10' }),
			ranked({ puzzleDate: '2026-07-12', playedDate: '2026-07-12' }),
			ranked({ puzzleDate: '2026-07-11', playedDate: '2026-07-11' })
		]);
		expect(entries.map((e) => e.puzzleDate)).toEqual(['2026-07-12', '2026-07-11', '2026-07-10']);
	});

	test('a single clean play surfaces its time, mistakes and hints, ranked', () => {
		const [entry] = buildHistory([ranked({ elapsedMs: 102_000, mistakes: 2, hintsUsed: 1 })]);
		expect(entry.best.elapsedMs).toBe(102_000);
		expect(entry.best.mistakes).toBe(2);
		expect(entry.best.hintsUsed).toBe(1);
		expect(entry.ranked?.elapsedMs).toBe(102_000);
		expect(entry.replayed).toBe(false);
		expect(entry.streakNeutral).toBe(false);
		expect(entry.unranked).toBe(false);
	});

	test('a replayed day keeps the ranked time but shows the faster best', () => {
		// First completed play ranks at 3:10; a later practice replay beats it at 1:42.
		const [entry] = buildHistory([
			ranked({ attemptNo: 1, replay: false, elapsedMs: 190_000, mistakes: 3 }),
			ranked({ attemptNo: 2, replay: true, elapsedMs: 102_000, mistakes: 0 })
		]);
		expect(entry.replayed).toBe(true);
		expect(entry.best.elapsedMs).toBe(102_000);
		expect(entry.ranked?.elapsedMs).toBe(190_000);
		expect(entry.unranked).toBe(false);
		expect(entry.streakNeutral).toBe(false);
	});

	test('an archive-only day is recorded, streak-neutral and unranked', () => {
		const [entry] = buildHistory([
			ranked({
				puzzleDate: '2026-07-01',
				playedDate: '2026-07-25',
				attemptNo: 1,
				replay: false,
				elapsedMs: 120_000
			})
		]);
		expect(entry.best.elapsedMs).toBe(120_000);
		expect(entry.ranked).toBeNull();
		expect(entry.unranked).toBe(true);
		expect(entry.streakNeutral).toBe(true);
	});

	test('an assisted in-window solve counts for the streak but is unranked', () => {
		const [entry] = buildHistory([ranked({ assisted: true })]);
		expect(entry.ranked).toBeNull();
		expect(entry.unranked).toBe(true);
		// Played within its window, so it is NOT streak-neutral — integrity lives on
		// the leaderboard, not the streak.
		expect(entry.streakNeutral).toBe(false);
		expect(entry.assisted).toBe(true);
	});

	test('best is the fastest completed play, tie-broken by fewest mistakes', () => {
		const [entry] = buildHistory([
			ranked({ attemptNo: 1, replay: false, elapsedMs: 100_000, mistakes: 4 }),
			ranked({ attemptNo: 2, replay: true, elapsedMs: 100_000, mistakes: 1 })
		]);
		expect(entry.best.mistakes).toBe(1);
	});

	test('an in-progress (uncompleted) play does not create a history entry', () => {
		expect(buildHistory([ranked({ completed: false })])).toEqual([]);
	});

	test('unverified best keeps a null mistake count without crashing', () => {
		const [entry] = buildHistory([ranked({ unverified: true, mistakes: null })]);
		expect(entry.best.mistakes).toBeNull();
		expect(entry.unranked).toBe(true);
	});
});
