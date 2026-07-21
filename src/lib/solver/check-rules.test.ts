import { describe, expect, it } from 'vitest';
import { checkRules } from './check-rules';
import {
	boardWithQueens,
	columnRegions,
	diagonalRegions,
	rowRegions,
	uniqueRegionMap,
	uniqueSolution
} from './test-fixtures';

describe('checkRules — a legal board', () => {
	it('reports a complete, legal solution as solved with no conflicts', () => {
		const result = checkRules(boardWithQueens(4, uniqueSolution), uniqueRegionMap);
		expect(result.solved).toBe(true);
		expect(result.conflicts).toEqual([]);
		expect(result.violations.queenCount).toBe(4);
		expect(result.violations.requiredQueens).toBe(4);
	});

	it('does not flag a legal partial board mid-solve', () => {
		// Two legal queens, N=4 board: distinct rows, columns and regions, not
		// adjacent. Nothing to highlight, but not solved either.
		const board = boardWithQueens(4, [
			{ row: 0, col: 1 },
			{ row: 2, col: 0 }
		]);
		const result = checkRules(board, uniqueRegionMap);
		expect(result.solved).toBe(false);
		expect(result.conflicts).toEqual([]);
		expect(result.violations.queenCount).toBe(2);
		expect(result.violations.adjacentPairs).toEqual([]);
	});
});

describe('checkRules — each violation class in isolation', () => {
	it('detects a duplicate row', () => {
		const board = boardWithQueens(4, [
			{ row: 0, col: 0 },
			{ row: 0, col: 2 }
		]);
		const result = checkRules(board, columnRegions(4));
		expect(result.violations.duplicateRows).toEqual([0]);
		expect(result.violations.duplicateColumns).toEqual([]);
		expect(result.violations.duplicateRegions).toEqual([]);
		expect(result.violations.adjacentPairs).toEqual([]);
		expect(result.conflicts).toHaveLength(2);
		expect(result.solved).toBe(false);
	});

	it('detects a duplicate column', () => {
		const board = boardWithQueens(4, [
			{ row: 0, col: 0 },
			{ row: 2, col: 0 }
		]);
		const result = checkRules(board, rowRegions(4));
		expect(result.violations.duplicateColumns).toEqual([0]);
		expect(result.violations.duplicateRows).toEqual([]);
		expect(result.violations.duplicateRegions).toEqual([]);
		expect(result.violations.adjacentPairs).toEqual([]);
		expect(result.conflicts).toHaveLength(2);
		expect(result.solved).toBe(false);
	});

	it('detects a duplicate region', () => {
		// (0,0) and (2,2) are both region 0 under (r+c) mod 4: distinct rows,
		// distinct columns, not adjacent — the breach is the region alone.
		const board = boardWithQueens(4, [
			{ row: 0, col: 0 },
			{ row: 2, col: 2 }
		]);
		const result = checkRules(board, diagonalRegions(4));
		expect(result.violations.duplicateRegions).toEqual([0]);
		expect(result.violations.duplicateRows).toEqual([]);
		expect(result.violations.duplicateColumns).toEqual([]);
		expect(result.violations.adjacentPairs).toEqual([]);
		expect(result.conflicts).toHaveLength(2);
		expect(result.solved).toBe(false);
	});

	it('detects king-adjacency, including the diagonal a Manhattan check misses', () => {
		// (0,0) and (1,1) are diagonally adjacent: distinct rows, columns and
		// regions (column layout), so the breach is the adjacency alone.
		const board = boardWithQueens(4, [
			{ row: 0, col: 0 },
			{ row: 1, col: 1 }
		]);
		const result = checkRules(board, columnRegions(4));
		expect(result.violations.adjacentPairs).toHaveLength(1);
		expect(result.violations.duplicateRows).toEqual([]);
		expect(result.violations.duplicateColumns).toEqual([]);
		expect(result.violations.duplicateRegions).toEqual([]);
		expect(result.conflicts).toHaveLength(2);
		expect(result.solved).toBe(false);
	});

	it('detects a wrong queen count', () => {
		const board = boardWithQueens(4, [{ row: 1, col: 1 }]);
		const result = checkRules(board, columnRegions(4));
		expect(result.violations.queenCount).toBe(1);
		expect(result.violations.requiredQueens).toBe(4);
		expect(result.solved).toBe(false);
		// One legal queen: nothing to highlight even though the board is incomplete.
		expect(result.conflicts).toEqual([]);
	});
});

describe('checkRules — Chebyshev adjacency without row/column uniqueness', () => {
	it('does not treat a same-column pair two apart as adjacent', () => {
		// Column uniqueness is violated here (both in column 0). A Manhattan-style
		// check would wrongly call (0,0)/(2,0) adjacent; Chebyshev does not.
		const board = boardWithQueens(4, [
			{ row: 0, col: 0 },
			{ row: 2, col: 0 }
		]);
		const result = checkRules(board, rowRegions(4));
		expect(result.violations.adjacentPairs).toEqual([]);
		expect(result.violations.duplicateColumns).toEqual([0]);
	});

	it('still flags a genuine diagonal adjacency on an illegal board', () => {
		const board = boardWithQueens(4, [
			{ row: 0, col: 0 },
			{ row: 1, col: 1 },
			{ row: 3, col: 1 }
		]);
		const result = checkRules(board, rowRegions(4));
		expect(result.violations.adjacentPairs).toHaveLength(1);
		expect(result.violations.duplicateColumns).toEqual([1]);
	});
});
