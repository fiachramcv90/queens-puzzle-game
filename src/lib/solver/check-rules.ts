import { isAdjacent } from './adjacency';
import type { Board, Cell, RegionMap } from './types';

/**
 * The individual rule breaches on a board, each reported independently so a
 * caller (or a test) can inspect one class without inferring it from another.
 */
export interface Violations {
	/** Row indices holding more than one queen. */
	readonly duplicateRows: readonly number[];
	/** Column indices holding more than one queen. */
	readonly duplicateColumns: readonly number[];
	/** Region ids holding more than one queen. */
	readonly duplicateRegions: readonly number[];
	/** Unordered pairs of queens at Chebyshev distance 1 (king-adjacent). */
	readonly adjacentPairs: readonly (readonly [Cell, Cell])[];
	/** Queens currently on the board. */
	readonly queenCount: number;
	/** Queens a complete solution must have — the board size N. */
	readonly requiredQueens: number;
}

/** The result of checking a board against the rules. */
export interface RuleCheck {
	/**
	 * A complete, legal solution: exactly N queens, one per row, one per column,
	 * one per region, and no two king-adjacent. This is the win condition and,
	 * because a unique-solution puzzle's only legal full board is its solution,
	 * the server's acceptance test too.
	 */
	readonly solved: boolean;
	/**
	 * Every queen breaking at least one rule as the board stands, deduped — what
	 * the client rings in red. Empty on a legal board, whether partial or
	 * complete. Wrong queen count alone does not populate this: a legal
	 * mid-solve board with too few queens has nothing to highlight.
	 */
	readonly conflicts: readonly Cell[];
	/** The breaches broken out by class. */
	readonly violations: Violations;
}

/**
 * Check a board against the Queens rules: one queen per row, per column and per
 * region, and no two queens king-adjacent (Chebyshev distance 1).
 *
 * Correct on partial boards, not only complete ones — a player mid-solve has
 * fewer than N queens, and that is not itself a violation. `solved` is true only
 * when the board is both complete (N queens) and free of every violation;
 * `conflicts` reflects only real rule breaches, so it stays empty while a legal
 * board is still being filled in.
 *
 * `board` and `regionMap` are both N×N; N is taken from the board.
 */
export function checkRules(board: Board, regionMap: RegionMap): RuleCheck {
	const size = board.length;
	const queens: Cell[] = [];
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			if (board[row][col] === 'queen') queens.push({ row, col });
		}
	}

	const rowCounts = new Map<number, number>();
	const colCounts = new Map<number, number>();
	const regionCounts = new Map<number, number>();
	for (const { row, col } of queens) {
		rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
		colCounts.set(col, (colCounts.get(col) ?? 0) + 1);
		const region = regionMap[row][col];
		regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
	}

	const duplicatedKeys = (counts: Map<number, number>): number[] =>
		[...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key);

	const duplicateRows = duplicatedKeys(rowCounts).sort((a, b) => a - b);
	const duplicateColumns = duplicatedKeys(colCounts).sort((a, b) => a - b);
	const duplicateRegions = duplicatedKeys(regionCounts).sort((a, b) => a - b);

	const adjacentPairs: (readonly [Cell, Cell])[] = [];
	for (let i = 0; i < queens.length; i++) {
		for (let j = i + 1; j < queens.length; j++) {
			if (isAdjacent(queens[i], queens[j])) adjacentPairs.push([queens[i], queens[j]]);
		}
	}

	// A queen is a conflict if it shares a row, column or region with another
	// queen, or is king-adjacent to one. Deduped by coordinate.
	const conflictKeys = new Set<string>();
	const conflicts: Cell[] = [];
	const flag = (cell: Cell): void => {
		const key = `${cell.row},${cell.col}`;
		if (conflictKeys.has(key)) return;
		conflictKeys.add(key);
		conflicts.push(cell);
	};
	for (const queen of queens) {
		const region = regionMap[queen.row][queen.col];
		if (
			(rowCounts.get(queen.row) ?? 0) > 1 ||
			(colCounts.get(queen.col) ?? 0) > 1 ||
			(regionCounts.get(region) ?? 0) > 1
		) {
			flag(queen);
		}
	}
	for (const [a, b] of adjacentPairs) {
		flag(a);
		flag(b);
	}

	const violations: Violations = {
		duplicateRows,
		duplicateColumns,
		duplicateRegions,
		adjacentPairs,
		queenCount: queens.length,
		requiredQueens: size
	};

	const solved =
		queens.length === size &&
		duplicateRows.length === 0 &&
		duplicateColumns.length === 0 &&
		duplicateRegions.length === 0 &&
		adjacentPairs.length === 0;

	return { solved, conflicts, violations };
}
