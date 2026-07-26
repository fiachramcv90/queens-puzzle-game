import { describe, it, expect } from 'vitest';
import type { Cell, CellState } from './types';
import { nextReveal } from './reveal';

/** A 4×4 board with every cell empty, then whatever the test places on it. */
function emptyBoard(size = 4): CellState[][] {
	return Array.from({ length: size }, () => Array.from({ length: size }, (): CellState => 'empty'));
}

const SOLUTION: readonly Cell[] = [
	{ row: 0, col: 1 },
	{ row: 1, col: 3 },
	{ row: 2, col: 0 },
	{ row: 3, col: 2 }
];

describe('nextReveal', () => {
	it('reveals the first solution cell on an empty board', () => {
		expect(nextReveal(emptyBoard(), SOLUTION)).toEqual({ row: 0, col: 1 });
	});

	it('skips queens the player has already found', () => {
		const board = emptyBoard();
		board[0][1] = 'queen';
		expect(nextReveal(board, SOLUTION)).toEqual({ row: 1, col: 3 });
	});

	it('returns null once every solution queen is placed', () => {
		const board = emptyBoard();
		for (const { row, col } of SOLUTION) board[row][col] = 'queen';
		expect(nextReveal(board, SOLUTION)).toBeNull();
	});

	// A mark on a solution cell is the player's mistake, and clearing it up is
	// exactly the help a reveal is for — so it must not read as "already found".
	it('still reveals a solution cell the player has marked X', () => {
		const board = emptyBoard();
		board[0][1] = 'X';
		expect(nextReveal(board, SOLUTION)).toEqual({ row: 0, col: 1 });
	});

	it('ignores queens standing on cells that are not in the solution', () => {
		const board = emptyBoard();
		board[0][0] = 'queen';
		board[3][3] = 'queen';
		expect(nextReveal(board, SOLUTION)).toEqual({ row: 0, col: 1 });
	});

	it('scans in row order regardless of how the solution is ordered', () => {
		const shuffled = [...SOLUTION].reverse();
		expect(nextReveal(emptyBoard(), shuffled)).toEqual({ row: 0, col: 1 });
	});

	// The reveal is a server round-trip precisely so it survives a board state the
	// client could not solve from. A board of the wrong size must not throw.
	it('survives a board smaller than the solution expects', () => {
		expect(nextReveal(emptyBoard(2), SOLUTION)).toEqual({ row: 0, col: 1 });
	});

	it('handles an empty solution', () => {
		expect(nextReveal(emptyBoard(), [])).toBeNull();
	});
});
