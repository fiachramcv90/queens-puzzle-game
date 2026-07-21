import { describe, expect, it } from 'vitest';
import { isAdjacent } from './adjacency';
import type { Cell } from './types';

const at = (row: number, col: number): Cell => ({ row, col });

describe('isAdjacent (Chebyshev distance 1)', () => {
	it('flags the four orthogonal neighbours', () => {
		expect(isAdjacent(at(3, 3), at(2, 3))).toBe(true);
		expect(isAdjacent(at(3, 3), at(4, 3))).toBe(true);
		expect(isAdjacent(at(3, 3), at(3, 2))).toBe(true);
		expect(isAdjacent(at(3, 3), at(3, 4))).toBe(true);
	});

	it('flags all four diagonal neighbours — the case a Manhattan check misses', () => {
		// Diagonal neighbours are Chebyshev 1 (adjacent) but Manhattan 2, so a
		// `|dr| + |dc| > 2` "not adjacent" shortcut wrongly clears them.
		expect(isAdjacent(at(3, 3), at(2, 2))).toBe(true);
		expect(isAdjacent(at(3, 3), at(2, 4))).toBe(true);
		expect(isAdjacent(at(3, 3), at(4, 2))).toBe(true);
		expect(isAdjacent(at(3, 3), at(4, 4))).toBe(true);
	});

	it('does not flag a same-column pair two apart — the case a Manhattan check over-flags', () => {
		// (0,0) and (2,0) are Chebyshev 2 (not adjacent) but Manhattan 2, so a
		// `|dr| + |dc| <= 2` notion would wrongly treat them as touching. This is
		// exactly the pair that only stays safe once column uniqueness holds, and
		// the client hands us boards where it does not yet.
		expect(isAdjacent(at(0, 0), at(2, 0))).toBe(false);
		expect(isAdjacent(at(0, 0), at(0, 2))).toBe(false);
	});

	it('does not flag knight-move or farther pairs', () => {
		expect(isAdjacent(at(0, 0), at(1, 2))).toBe(false);
		expect(isAdjacent(at(0, 0), at(2, 1))).toBe(false);
		expect(isAdjacent(at(0, 0), at(2, 2))).toBe(false);
		expect(isAdjacent(at(0, 0), at(5, 5))).toBe(false);
	});

	it('does not flag a cell against itself', () => {
		expect(isAdjacent(at(4, 4), at(4, 4))).toBe(false);
	});

	it('is symmetric', () => {
		expect(isAdjacent(at(1, 1), at(2, 2))).toBe(isAdjacent(at(2, 2), at(1, 1)));
		expect(isAdjacent(at(1, 1), at(4, 4))).toBe(isAdjacent(at(4, 4), at(1, 1)));
	});
});
