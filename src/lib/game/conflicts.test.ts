import { describe, it, expect } from 'vitest';
import type { Board, CellState, RegionMap } from '$lib/solver';
import { deriveConflicts, isConflict } from './conflicts';

// A 4×4 region map, four rows as four regions — simple and legible.
const regions4: RegionMap = [
	[0, 0, 1, 1],
	[0, 0, 1, 1],
	[2, 2, 3, 3],
	[2, 2, 3, 3]
];

function board4(queens: readonly [number, number][]): Board {
	const board: CellState[][] = Array.from({ length: 4 }, () => Array<CellState>(4).fill('empty'));
	for (const [r, c] of queens) board[r][c] = 'queen';
	return board;
}

describe('deriveConflicts — the red-ring set', () => {
	it('is empty on a board with no queens', () => {
		expect(deriveConflicts(board4([]), regions4).size).toBe(0);
	});

	it('is empty on a legal partial board', () => {
		// Two non-attacking queens, different rows/cols/regions, not adjacent.
		expect(
			deriveConflicts(
				board4([
					[0, 0],
					[2, 2]
				]),
				regions4
			).size
		).toBe(0);
	});

	it('rings both queens sharing a column', () => {
		const conflicts = deriveConflicts(
			board4([
				[0, 1],
				[2, 1]
			]),
			regions4
		);
		expect(isConflict(conflicts, 0, 1)).toBe(true);
		expect(isConflict(conflicts, 2, 1)).toBe(true);
		expect(conflicts.size).toBe(2);
	});

	it('rings king-adjacent queens (including diagonally)', () => {
		const conflicts = deriveConflicts(
			board4([
				[0, 0],
				[1, 1]
			]),
			regions4
		);
		expect(isConflict(conflicts, 0, 0)).toBe(true);
		expect(isConflict(conflicts, 1, 1)).toBe(true);
	});

	it('matches the shared solver core exactly, not a second adjacency check', () => {
		// Region conflict: two queens both in region 0. Delegating to checkRules is
		// what keeps this from being a re-implementation — a region clash the client
		// never coded for is still flagged.
		const conflicts = deriveConflicts(
			board4([
				[0, 0],
				[1, 0]
			]),
			regions4
		);
		expect(isConflict(conflicts, 0, 0)).toBe(true);
		expect(isConflict(conflicts, 1, 0)).toBe(true);
	});

	it('clears once the conflict is resolved', () => {
		const clash = deriveConflicts(
			board4([
				[0, 1],
				[2, 1]
			]),
			regions4
		);
		expect(clash.size).toBe(2);
		const resolved = deriveConflicts(
			board4([
				[0, 1],
				[2, 2]
			]),
			regions4
		);
		expect(resolved.size).toBe(0);
	});
});
