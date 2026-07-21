import type { Board, Cell, CellState, RegionMap } from './types';

/**
 * Shared fixtures for the solver-core tests. Not a test file itself — the region
 * layouts and the hand-built unique puzzle are used by more than one spec, so
 * they live here rather than being copy-pasted.
 */

/** Build an N×N board with queens at the given cells and every other cell empty. */
export function boardWithQueens(size: number, queens: Cell[]): Board {
	const grid: CellState[][] = Array.from({ length: size }, () =>
		Array.from({ length: size }, (): CellState => 'empty')
	);
	for (const { row, col } of queens) grid[row][col] = 'queen';
	return grid;
}

/** region(r, c) = c — each column is a region. Isolates row and adjacency breaches. */
export const columnRegions = (size: number): RegionMap =>
	Array.from({ length: size }, () => Array.from({ length: size }, (_, col) => col));

/** region(r, c) = r — each row is a region. Isolates column breaches; also a loose layout with many solutions. */
export const rowRegions = (size: number): RegionMap =>
	Array.from({ length: size }, (_, row) => Array.from({ length: size }, () => row));

/** region(r, c) = (r + c) mod N — a diagonal-band layout. Isolates region breaches. */
export const diagonalRegions = (size: number): RegionMap =>
	Array.from({ length: size }, (_, row) =>
		Array.from({ length: size }, (_, col) => (row + col) % size)
	);

/**
 * A hand-built 4×4 puzzle whose only legal full board is
 * {@link uniqueSolution}, S = {(0,1),(1,3),(2,0),(3,2)}. It is a column-region
 * layout except that (0,2) is pulled into region 3, which kills the one other
 * non-adjacent permutation and leaves exactly one solution.
 */
export const uniqueRegionMap: RegionMap = [
	[0, 1, 3, 3],
	[0, 1, 2, 3],
	[0, 1, 2, 3],
	[0, 1, 2, 3]
];

/** The single legal full board of {@link uniqueRegionMap}. */
export const uniqueSolution: Cell[] = [
	{ row: 0, col: 1 },
	{ row: 1, col: 3 },
	{ row: 2, col: 0 },
	{ row: 3, col: 2 }
];
