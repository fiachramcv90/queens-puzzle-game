import { describe, expect, test } from 'vitest';
import { replayMoveLog } from './replay';
import type { CellState, MoveLog, RegionMap } from './types';

/**
 * The move log is the forensic record of a play, and the server derives the
 * mistake count by replaying it through this — never trusting the client's own
 * count. These tests pin two things: the board reconstructed from a log matches
 * what those moves produce, and a "mistake" is exactly a queen placed into a rule
 * conflict at the moment it lands.
 */

// A 4×4 with four column-stripe regions, one region per column. Its unique
// solution places one queen per row/column/region with no two adjacent.
const REGIONS_4: RegionMap = [
	[0, 1, 2, 3],
	[0, 1, 2, 3],
	[0, 1, 2, 3],
	[0, 1, 2, 3]
];

// A known legal, complete solution for REGIONS_4 (one per row, column, region;
// no two king-adjacent): (0,1) (1,3) (2,0) (3,2).
const SOLUTION_4: ReadonlyArray<readonly [number, number]> = [
	[0, 1],
	[1, 3],
	[2, 0],
	[3, 2]
];

function queen(t: number, row: number, col: number) {
	return { t, row, col, to: 'queen' as CellState };
}

function set(t: number, row: number, col: number, to: CellState) {
	return { t, row, col, to };
}

describe('replayMoveLog reconstructs the final board', () => {
	test('applies each move in order to an empty board', () => {
		const log: MoveLog = [
			set(0, 0, 0, 'X'),
			queen(1, 1, 1),
			set(2, 0, 0, 'queen'), // overwrite the X with a queen
			set(3, 2, 2, 'X')
		];
		const { finalBoard } = replayMoveLog(REGIONS_4, log);
		expect(finalBoard[0][0]).toBe('queen');
		expect(finalBoard[1][1]).toBe('queen');
		expect(finalBoard[2][2]).toBe('X');
		expect(finalBoard[3][3]).toBe('empty');
	});

	test('a later move overrides an earlier one on the same cell', () => {
		const log: MoveLog = [queen(0, 2, 2), set(1, 2, 2, 'empty')];
		const { finalBoard } = replayMoveLog(REGIONS_4, log);
		expect(finalBoard[2][2]).toBe('empty');
	});
});

describe('mistakes are queens placed into a conflict', () => {
	test('a clean solve logs zero mistakes', () => {
		const log: MoveLog = SOLUTION_4.map(([r, c], i) => queen(i, r, c));
		const { mistakes } = replayMoveLog(REGIONS_4, log);
		expect(mistakes).toBe(0);
	});

	test('placing a queen adjacent to an existing one is one mistake', () => {
		// (0,0) then (1,1): king-adjacent — the second placement is the mistake.
		const log: MoveLog = [queen(0, 0, 0), queen(1, 1, 1)];
		const { mistakes } = replayMoveLog(REGIONS_4, log);
		expect(mistakes).toBe(1);
	});

	test('a queen sharing a column with an existing queen is a mistake', () => {
		// Same column, not adjacent (rows 0 and 2) — still a duplicate-column breach.
		const log: MoveLog = [queen(0, 0, 0), queen(1, 2, 0)];
		const { mistakes } = replayMoveLog(REGIONS_4, log);
		expect(mistakes).toBe(1);
	});

	test('removing the offending queen and replaying cleanly still counts the earlier mistake', () => {
		const log: MoveLog = [
			queen(0, 0, 0),
			queen(1, 1, 1), // mistake: adjacent
			set(2, 1, 1, 'empty'), // undo it
			queen(3, 1, 2) // legal relative to (0,0)
		];
		const { mistakes } = replayMoveLog(REGIONS_4, log);
		expect(mistakes).toBe(1);
	});

	test('X and empty moves are never mistakes', () => {
		const log: MoveLog = [set(0, 0, 0, 'X'), set(1, 1, 1, 'X'), set(2, 2, 2, 'empty')];
		const { mistakes } = replayMoveLog(REGIONS_4, log);
		expect(mistakes).toBe(0);
	});
});

describe('robustness', () => {
	test('an out-of-bounds move is ignored, not a crash', () => {
		const log: MoveLog = [queen(0, 9, 9), queen(1, 0, 1)];
		const { finalBoard, mistakes } = replayMoveLog(REGIONS_4, log);
		expect(finalBoard[0][1]).toBe('queen');
		expect(mistakes).toBe(0);
	});

	test('an empty log yields an empty board and no mistakes', () => {
		const { finalBoard, mistakes } = replayMoveLog(REGIONS_4, []);
		expect(mistakes).toBe(0);
		expect(finalBoard.flat().every((c) => c === 'empty')).toBe(true);
	});
});
