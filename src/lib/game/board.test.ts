import { describe, it, expect } from 'vitest';
import type { Board } from '$lib/solver';
import { createEmptyBoard, nextTapState, setCell, tapCell, toggleXCell, sweepX } from './board';

describe('createEmptyBoard', () => {
	it('is N×N and all empty', () => {
		const board = createEmptyBoard(3);
		expect(board).toEqual([
			['empty', 'empty', 'empty'],
			['empty', 'empty', 'empty'],
			['empty', 'empty', 'empty']
		]);
	});
});

describe('nextTapState — the 3-state single-tap cycle', () => {
	it('cycles empty → X → queen → empty', () => {
		expect(nextTapState('empty')).toBe('X');
		expect(nextTapState('X')).toBe('queen');
		expect(nextTapState('queen')).toBe('empty');
	});

	it('treats a machine-placed auto-X as the start of the player cycle, going to X', () => {
		// Tapping a lighter auto-X commits it to the player's own X, matching the
		// settled prototype behaviour. auto-X itself is never produced here.
		expect(nextTapState('auto-X')).toBe('X');
	});
});

describe('tapCell', () => {
	it('advances only the tapped cell and leaves the rest untouched', () => {
		const board = createEmptyBoard(2);
		const once = tapCell(board, 0, 1);
		expect(once[0][1]).toBe('X');
		expect(once[0][0]).toBe('empty');
		expect(once[1][0]).toBe('empty');
	});

	it('does not mutate the input board', () => {
		const board = createEmptyBoard(2);
		tapCell(board, 0, 0);
		expect(board[0][0]).toBe('empty');
	});

	it('takes three taps to return a cell to empty', () => {
		let board = createEmptyBoard(1);
		board = tapCell(board, 0, 0); // X
		board = tapCell(board, 0, 0); // queen
		board = tapCell(board, 0, 0); // empty
		expect(board[0][0]).toBe('empty');
	});
});

describe('toggleXCell — desktop right-click', () => {
	it('places an X on an empty cell', () => {
		const board = createEmptyBoard(1);
		expect(toggleXCell(board, 0, 0)[0][0]).toBe('X');
	});

	it('clears an X back to empty', () => {
		let board = createEmptyBoard(1);
		board = setCell(board, 0, 0, 'X');
		expect(toggleXCell(board, 0, 0)[0][0]).toBe('empty');
	});

	it('replaces a queen with an X (a direct X, never a cycle)', () => {
		let board = createEmptyBoard(1);
		board = setCell(board, 0, 0, 'queen');
		expect(toggleXCell(board, 0, 0)[0][0]).toBe('X');
	});
});

describe('sweepX — the touch drag that bulk-marks a row', () => {
	it('sets every swept empty cell to X', () => {
		const board = createEmptyBoard(3);
		const swept = sweepX(board, [
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 0, col: 2 }
		]);
		expect(swept[0]).toEqual(['X', 'X', 'X']);
	});

	it('overwrites auto-X but never a player X or a queen', () => {
		let board = createEmptyBoard(3);
		board = setCell(board, 0, 0, 'queen');
		board = setCell(board, 0, 1, 'auto-X');
		// col 2 stays empty
		const swept = sweepX(board, [
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 0, col: 2 }
		]);
		expect(swept[0]).toEqual(['queen', 'X', 'X']);
	});

	it('is a no-op on an empty sweep', () => {
		const board: Board = createEmptyBoard(2);
		expect(sweepX(board, [])).toEqual(board);
	});
});
