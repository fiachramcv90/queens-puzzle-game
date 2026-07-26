import { describe, it, expect } from 'vitest';
import type { Board, RegionMap } from '$lib/solver';
import { createEmptyBoard, setCell } from './board';
import { applyAutoMarks, clearAutoMarks, findRuleViolations } from './hints';

/** A 4×4 map split into four 2×2 quadrant regions. */
const REGIONS: RegionMap = [
	[0, 0, 1, 1],
	[0, 0, 1, 1],
	[2, 2, 3, 3],
	[2, 2, 3, 3]
];

describe('findRuleViolations — the mistake check', () => {
	it('flags nothing on an empty board', () => {
		expect(findRuleViolations(createEmptyBoard(4), REGIONS)).toEqual([]);
	});

	it('flags nothing for a single queen', () => {
		const board = setCell(createEmptyBoard(4), 0, 0, 'queen');
		expect(findRuleViolations(board, REGIONS)).toEqual([]);
	});

	it('flags both queens sharing a row', () => {
		let board = createEmptyBoard(4);
		board = setCell(board, 0, 0, 'queen');
		board = setCell(board, 0, 3, 'queen');
		expect(findRuleViolations(board, REGIONS)).toEqual([
			{ row: 0, col: 0 },
			{ row: 0, col: 3 }
		]);
	});

	it('flags both queens sharing a column', () => {
		let board = createEmptyBoard(4);
		board = setCell(board, 0, 0, 'queen');
		board = setCell(board, 3, 0, 'queen');
		expect(findRuleViolations(board, REGIONS)).toHaveLength(2);
	});

	it('flags both queens sharing a region', () => {
		let board = createEmptyBoard(4);
		// (0,0) and (1,1) are both region 0 — and also king-adjacent, so this
		// asserts the region rule holds regardless.
		board = setCell(board, 0, 0, 'queen');
		board = setCell(board, 1, 1, 'queen');
		expect(findRuleViolations(board, REGIONS)).toHaveLength(2);
	});

	// Chebyshev adjacency: diagonal touching counts, and is the case a
	// |dx|+|dy| shortcut would get wrong.
	it('flags queens touching only diagonally', () => {
		let board = createEmptyBoard(4);
		board = setCell(board, 1, 1, 'queen');
		board = setCell(board, 2, 2, 'queen');
		expect(findRuleViolations(board, REGIONS)).toHaveLength(2);
	});

	it('leaves a legal pair alone', () => {
		let board = createEmptyBoard(4);
		board = setCell(board, 0, 0, 'queen');
		board = setCell(board, 2, 2, 'queen');
		// Different rows, columns and regions, two apart diagonally.
		expect(findRuleViolations(board, REGIONS)).toEqual([]);
	});

	// The deliberate limit: a legal-but-wrong queen is invisible to this check,
	// because flagging it would need the solution.
	it('does not flag a legal queen that is simply not in the solution', () => {
		const board = setCell(createEmptyBoard(4), 3, 3, 'queen');
		expect(findRuleViolations(board, REGIONS)).toEqual([]);
	});

	it('ignores marks entirely — only queens can break a rule', () => {
		let board = createEmptyBoard(4);
		board = setCell(board, 0, 0, 'X');
		board = setCell(board, 0, 1, 'X');
		expect(findRuleViolations(board, REGIONS)).toEqual([]);
	});
});

describe('applyAutoMarks — the auto-mark-X assist', () => {
	it('leaves an empty board untouched', () => {
		const board = createEmptyBoard(4);
		expect(applyAutoMarks(board, REGIONS)).toEqual(board);
	});

	it('rules out the queen’s row, column, region and neighbours', () => {
		const board = setCell(createEmptyBoard(4), 0, 0, 'queen');
		const marked = applyAutoMarks(board, REGIONS);

		expect(marked[0][0]).toBe('queen');
		expect(marked[0][1]).toBe('auto-X'); // same row (and region, and adjacent)
		expect(marked[1][0]).toBe('auto-X'); // same column
		expect(marked[1][1]).toBe('auto-X'); // same region, diagonal neighbour
		// (2,2) shares no row, column or region with (0,0) and is not adjacent.
		expect(marked[2][2]).toBe('empty');
	});

	it("never overwrites the player's own X or a queen", () => {
		let board = createEmptyBoard(4);
		board = setCell(board, 0, 0, 'queen');
		board = setCell(board, 0, 1, 'X');
		board = setCell(board, 2, 2, 'queen');
		const marked = applyAutoMarks(board, REGIONS);
		expect(marked[0][1]).toBe('X');
		expect(marked[2][2]).toBe('queen');
	});

	// The reason it recomputes from scratch: a mark justified by a queen that has
	// since been lifted must go, or the assist quietly lies to the player.
	it('clears an auto-X once the queen that justified it is removed', () => {
		const placed = applyAutoMarks(setCell(createEmptyBoard(4), 0, 0, 'queen'), REGIONS);
		expect(placed[1][0]).toBe('auto-X');

		const lifted = applyAutoMarks(setCell(placed, 0, 0, 'empty'), REGIONS);
		expect(lifted[1][0]).toBe('empty');
		expect(lifted.flat().every((s) => s === 'empty')).toBe(true);
	});

	it('is idempotent — applying it twice changes nothing further', () => {
		const once = applyAutoMarks(setCell(createEmptyBoard(4), 1, 1, 'queen'), REGIONS);
		expect(applyAutoMarks(once, REGIONS)).toEqual(once);
	});
});

describe('clearAutoMarks — turning the assist off', () => {
	it('clears auto-X and leaves the player’s own marks and queens', () => {
		let board: Board = createEmptyBoard(4);
		board = setCell(board, 0, 0, 'queen');
		board = setCell(board, 0, 1, 'X');
		board = setCell(board, 1, 0, 'auto-X');
		const cleared = clearAutoMarks(board);
		expect(cleared[0][0]).toBe('queen');
		expect(cleared[0][1]).toBe('X');
		expect(cleared[1][0]).toBe('empty');
	});
});
