import { describe, it, expect } from 'vitest';
import type { Board } from '$lib/solver';
import {
	createEmptyBoard,
	nextFocus,
	nextTapState,
	setCell,
	tapCell,
	toggleXCell,
	sweepX
} from './board';

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

describe('nextFocus — keyboard navigation across the grid', () => {
	const middle = { row: 2, col: 2 };

	it('moves one cell per arrow key', () => {
		expect(nextFocus(middle, 'ArrowUp', 5)).toEqual({ row: 1, col: 2 });
		expect(nextFocus(middle, 'ArrowDown', 5)).toEqual({ row: 3, col: 2 });
		expect(nextFocus(middle, 'ArrowLeft', 5)).toEqual({ row: 2, col: 1 });
		expect(nextFocus(middle, 'ArrowRight', 5)).toEqual({ row: 2, col: 3 });
	});

	// Clamping rather than wrapping: on a board where each row and column holds
	// exactly one queen, silently crossing from the last column to the next row
	// would move the player across a boundary the puzzle cares about.
	it('clamps at every edge instead of wrapping', () => {
		expect(nextFocus({ row: 0, col: 0 }, 'ArrowUp', 5)).toEqual({ row: 0, col: 0 });
		expect(nextFocus({ row: 0, col: 0 }, 'ArrowLeft', 5)).toEqual({ row: 0, col: 0 });
		expect(nextFocus({ row: 4, col: 4 }, 'ArrowDown', 5)).toEqual({ row: 4, col: 4 });
		expect(nextFocus({ row: 4, col: 4 }, 'ArrowRight', 5)).toEqual({ row: 4, col: 4 });
	});

	it('sends Home and End to the ends of the current row', () => {
		expect(nextFocus(middle, 'Home', 5)).toEqual({ row: 2, col: 0 });
		expect(nextFocus(middle, 'End', 5)).toEqual({ row: 2, col: 4 });
	});

	it('sends Ctrl+Home and Ctrl+End to the board corners', () => {
		expect(nextFocus(middle, 'Home', 5, { ctrlKey: true })).toEqual({ row: 0, col: 0 });
		expect(nextFocus(middle, 'End', 5, { ctrlKey: true })).toEqual({ row: 4, col: 4 });
	});

	it('sends PageUp and PageDown to the ends of the current column', () => {
		expect(nextFocus(middle, 'PageUp', 5)).toEqual({ row: 0, col: 2 });
		expect(nextFocus(middle, 'PageDown', 5)).toEqual({ row: 4, col: 2 });
	});

	// Null is how the component knows to leave the event alone, so a key it does not
	// handle still does whatever the browser would normally do with it.
	it('returns null for a key it does not handle', () => {
		expect(nextFocus(middle, 'a', 5)).toBeNull();
		expect(nextFocus(middle, 'Tab', 5)).toBeNull();
		expect(nextFocus(middle, ' ', 5)).toBeNull();
		expect(nextFocus(middle, 'Enter', 5)).toBeNull();
	});

	it('works on the smallest and largest real boards', () => {
		expect(nextFocus({ row: 0, col: 0 }, 'ArrowRight', 7)).toEqual({ row: 0, col: 1 });
		expect(nextFocus({ row: 10, col: 10 }, 'ArrowRight', 11)).toEqual({ row: 10, col: 10 });
		expect(nextFocus({ row: 5, col: 5 }, 'End', 11)).toEqual({ row: 5, col: 10 });
	});
});
