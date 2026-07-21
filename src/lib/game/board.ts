/**
 * Board mutations, as pure functions over the shared solver `Board`.
 *
 * Every function returns a NEW board and never mutates its input — the Svelte
 * store swaps the reference to trigger reactivity, and immutability keeps these
 * trivially testable without a component. The interaction rules themselves — the
 * tap cycle, the right-click toggle, the drag sweep — live here so the component
 * only wires pointer events to them.
 */

import type { Board, Cell, CellState } from '$lib/solver';

/** A fresh N×N board with every cell `empty`. */
export function createEmptyBoard(size: number): Board {
	return Array.from({ length: size }, () => Array.from({ length: size }, (): CellState => 'empty'));
}

/**
 * Whether a drag-sweep may overwrite this cell with an X: only an `empty` cell or
 * a light machine-placed `auto-X`. A player's own `X` or a `queen` is never swept
 * away. This is the one home of that rule — the component asks it too, so a sweep
 * and its live preview can't disagree.
 */
export function isSweepable(state: CellState): boolean {
	return state === 'empty' || state === 'auto-X';
}

/**
 * The next state under a single tap: `empty → X → queen → empty`. One control
 * does everything; a queen is reached by tapping through X, with no mode switch.
 *
 * A machine-placed `auto-X` (lighter, from the future assist) commits to the
 * player's own `X` when tapped — the cycle then proceeds from there.
 */
export function nextTapState(state: CellState): CellState {
	switch (state) {
		case 'empty':
			return 'X';
		case 'X':
			return 'queen';
		case 'queen':
			return 'empty';
		case 'auto-X':
			return 'X';
	}
}

/** Set a single cell to `state`, returning a new board. */
export function setCell(board: Board, row: number, col: number, state: CellState): Board {
	return board.map((cells, r) =>
		r === row ? cells.map((cell, c) => (c === col ? state : cell)) : cells
	);
}

/** Apply a tap to one cell, advancing it through the tap cycle. */
export function tapCell(board: Board, row: number, col: number): Board {
	return setCell(board, row, col, nextTapState(board[row][col]));
}

/**
 * The desktop right-click: toggle an X directly, skipping the cycle. An existing
 * X clears to empty; anything else (empty, queen, auto-X) becomes an X.
 */
export function toggleXCell(board: Board, row: number, col: number): Board {
	return setCell(board, row, col, board[row][col] === 'X' ? 'empty' : 'X');
}

/**
 * The touch drag-sweep: mark a run of cells with X in one gesture. Only cells
 * that were `empty` or a light `auto-X` are swept — a player's own X or a queen
 * is left alone, so a drag never wipes a deliberate placement.
 */
export function sweepX(board: Board, cells: readonly Cell[]): Board {
	if (cells.length === 0) return board;
	const sweep = new Set(cells.map(({ row, col }) => `${row},${col}`));
	return board.map((row, r) =>
		row.map((cell, c) => {
			if (!sweep.has(`${r},${c}`)) return cell;
			return isSweepable(cell) ? 'X' : cell;
		})
	);
}
