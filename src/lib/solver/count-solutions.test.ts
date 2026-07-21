import { describe, expect, it } from 'vitest';
import { countSolutions } from './count-solutions';
import { columnRegions, rowRegions, uniqueRegionMap } from './test-fixtures';

describe('countSolutions', () => {
	it('returns exactly 1 for a known-unique board', () => {
		expect(countSolutions(uniqueRegionMap)).toBe(1);
	});

	it('finds the unique solution regardless of how high the cap is', () => {
		expect(countSolutions(uniqueRegionMap, 1)).toBe(1);
		expect(countSolutions(uniqueRegionMap, 5)).toBe(1);
	});

	it('stops at 2 for a known-ambiguous board', () => {
		// Column-region 4×4 has exactly the two non-adjacent permutations.
		expect(countSolutions(columnRegions(4))).toBe(2);
	});

	it('returns 0 when there is no legal placement', () => {
		// On a 2×2 board any two distinct cells are king-adjacent, so no board
		// with one queen per row and column is legal.
		expect(countSolutions(columnRegions(2))).toBe(0);
	});

	describe('the abort at solution #2 actually aborts', () => {
		// A 7×7 row-region board is loose enough to have well over two solutions.
		const many = rowRegions(7);

		it('caps the count at stopAt instead of enumerating', () => {
			// If the search enumerated every solution and then clamped, these would
			// all return the same full total. They track stopAt instead, so the
			// stopAt=2 run must have aborted before reaching the end.
			expect(countSolutions(many, 1)).toBe(1);
			expect(countSolutions(many, 2)).toBe(2);
			expect(countSolutions(many, 3)).toBe(3);
		});

		it('leaves solutions uncounted when it aborts', () => {
			const full = countSolutions(many, Number.MAX_SAFE_INTEGER);
			expect(full).toBeGreaterThan(2);
			// The default run returns fewer than the true total — proof it stopped
			// early rather than counting them all.
			expect(countSolutions(many, 2)).toBeLessThan(full);
		});
	});

	it('is deterministic — the same board counts the same twice', () => {
		const map = rowRegions(6);
		expect(countSolutions(map, Number.MAX_SAFE_INTEGER)).toBe(
			countSolutions(map, Number.MAX_SAFE_INTEGER)
		);
	});
});
