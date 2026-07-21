import { isAdjacent } from './adjacency';
import type { Cell, RegionMap } from './types';
import type { DifficultySignals } from './difficulty';

/**
 * Extract the raw difficulty signals of a region map — the inputs
 * {@link scoreDifficulty} weighs. Two families:
 *
 * - **Region geometry** (size variance, boundary perimeter-to-area, row/column
 *   span): pure counting over the partition. Irregular, elongated, interlocking
 *   regions read as harder.
 * - **Search hardness** ({@link forcedDeductionDepth}, solver nodes/backtracks):
 *   measured by a propagate-then-branch solve. Forced-deduction depth is `0` when
 *   the board falls to pure propagation and rises with each level of
 *   hypothesis-and-check the board forces — the dominant proxy for human effort.
 *
 * Only ever run on a board already proven to have a **unique** solution: the
 * propagation is sound precisely because every forced move (a region, row or
 * column with a single remaining cell) is on the one true solution. See
 * `docs/adr/0001-difficulty-scoring.md`.
 *
 * @see scoreDifficulty in ./difficulty for how these are combined.
 */
export function extractSignals(regionMap: RegionMap): DifficultySignals {
	const size = regionMap.length;
	const geometry = regionGeometry(regionMap);
	const search = analyzeSearch(regionMap);
	return {
		forcedDeductionDepth: search.depth,
		size,
		regionSizeVariance: geometry.sizeVariance,
		regionPerimeterAreaRatio: geometry.perimeterAreaRatio,
		regionRowColSpan: geometry.rowColSpan,
		solverNodes: search.nodes,
		solverBacktracks: search.backtracks
	};
}

interface Geometry {
	readonly sizeVariance: number;
	readonly perimeterAreaRatio: number;
	readonly rowColSpan: number;
}

/** Pure counting metrics over the partition — the region-irregularity signals. */
function regionGeometry(regionMap: RegionMap): Geometry {
	const size = regionMap.length;
	const cells = new Map<number, Cell[]>();
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			const region = regionMap[row][col];
			let list = cells.get(region);
			if (!list) cells.set(region, (list = []));
			list.push({ row, col });
		}
	}
	const regions = [...cells.values()];

	const sizes = regions.map((r) => r.length);
	const meanSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
	const sizeVariance = sizes.reduce((acc, s) => acc + (s - meanSize) ** 2, 0) / sizes.length;

	let perimeterAreaSum = 0;
	let spanSum = 0;
	for (const region of regions) {
		let perimeter = 0;
		let minRow = size;
		let maxRow = -1;
		let minCol = size;
		let maxCol = -1;
		for (const { row, col } of region) {
			minRow = Math.min(minRow, row);
			maxRow = Math.max(maxRow, row);
			minCol = Math.min(minCol, col);
			maxCol = Math.max(maxCol, col);
			// A cell edge is on the region boundary when its orthogonal neighbour is
			// off-board or in a different region.
			for (const [dr, dc] of [
				[-1, 0],
				[1, 0],
				[0, -1],
				[0, 1]
			]) {
				const nr = row + dr;
				const nc = col + dc;
				if (
					nr < 0 ||
					nr >= size ||
					nc < 0 ||
					nc >= size ||
					regionMap[nr][nc] !== regionMap[row][col]
				) {
					perimeter++;
				}
			}
		}
		perimeterAreaSum += perimeter / region.length;
		spanSum += maxRow - minRow + 1 + (maxCol - minCol + 1);
	}

	return {
		sizeVariance,
		perimeterAreaRatio: perimeterAreaSum / regions.length,
		rowColSpan: spanSum / regions.length
	};
}

interface SearchResult {
	readonly depth: number;
	readonly nodes: number;
	readonly backtracks: number;
}

/**
 * Solve the board with a propagate-then-branch search, recording the branch
 * depth on the path to the solution plus the nodes expanded and backtracks made.
 *
 * Propagation places every forced move — a region, row or column with a single
 * remaining candidate — before branching, so a board solvable by deduction alone
 * never expands a node (depth 0, zero effort). Ordering is deterministic
 * (most-constrained region, then row-major candidates), so the result is a stable
 * function of the board.
 */
function analyzeSearch(regionMap: RegionMap): SearchResult {
	const size = regionMap.length;
	let nodes = 0;
	let backtracks = 0;

	const candidatesAt = (placed: Cell[]): boolean[][] => {
		const usedRow = new Array<boolean>(size).fill(false);
		const usedCol = new Array<boolean>(size).fill(false);
		const usedRegion = new Set<number>();
		for (const q of placed) {
			usedRow[q.row] = true;
			usedCol[q.col] = true;
			usedRegion.add(regionMap[q.row][q.col]);
		}
		const possible: boolean[][] = Array.from({ length: size }, () =>
			new Array<boolean>(size).fill(false)
		);
		for (let row = 0; row < size; row++) {
			if (usedRow[row]) continue;
			for (let col = 0; col < size; col++) {
				if (usedCol[col] || usedRegion.has(regionMap[row][col])) continue;
				if (placed.some((q) => isAdjacent(q, { row, col }))) continue;
				possible[row][col] = true;
			}
		}
		return possible;
	};

	// Returns the branch depth at which the unique solution is reached, or null if
	// this partial placement is a dead end.
	const solve = (start: Cell[], depth: number): number | null => {
		const placed = [...start];

		// Propagate forced moves until none remain, a contradiction appears, or the
		// board is complete.
		for (;;) {
			if (placed.length === size) return depth;
			const possible = candidatesAt(placed);

			const usedRow = new Array<boolean>(size).fill(false);
			const usedCol = new Array<boolean>(size).fill(false);
			const usedRegion = new Set<number>();
			for (const q of placed) {
				usedRow[q.row] = true;
				usedCol[q.col] = true;
				usedRegion.add(regionMap[q.row][q.col]);
			}

			let forced: Cell | null = null;
			let dead = false;

			// Region singles.
			const regionCells = new Map<number, Cell[]>();
			for (let row = 0; row < size && !dead; row++) {
				for (let col = 0; col < size; col++) {
					if (!possible[row][col]) continue;
					const region = regionMap[row][col];
					let list = regionCells.get(region);
					if (!list) regionCells.set(region, (list = []));
					list.push({ row, col });
				}
			}
			for (let region = 0; region < size; region++) {
				if (usedRegion.has(region)) continue;
				const list = regionCells.get(region);
				if (!list || list.length === 0) {
					dead = true;
					break;
				}
				if (list.length === 1 && !forced) forced = list[0];
			}

			// Row singles.
			for (let row = 0; row < size && !dead; row++) {
				if (usedRow[row]) continue;
				let count = 0;
				let only: Cell | null = null;
				for (let col = 0; col < size; col++) {
					if (possible[row][col]) {
						count++;
						only = { row, col };
					}
				}
				if (count === 0) dead = true;
				else if (count === 1 && !forced) forced = only;
			}

			// Column singles.
			for (let col = 0; col < size && !dead; col++) {
				if (usedCol[col]) continue;
				let count = 0;
				let only: Cell | null = null;
				for (let row = 0; row < size; row++) {
					if (possible[row][col]) {
						count++;
						only = { row, col };
					}
				}
				if (count === 0) dead = true;
				else if (count === 1 && !forced) forced = only;
			}

			if (dead) return null;
			if (forced) {
				placed.push(forced);
				continue;
			}
			break; // no forced move — branch.
		}

		// Branch on the most-constrained unassigned region.
		nodes++;
		const possible = candidatesAt(placed);
		const usedRegion = new Set<number>(placed.map((q) => regionMap[q.row][q.col]));
		let target: Cell[] | null = null;
		for (let region = 0; region < size; region++) {
			if (usedRegion.has(region)) continue;
			const cells: Cell[] = [];
			for (let row = 0; row < size; row++) {
				for (let col = 0; col < size; col++) {
					if (possible[row][col] && regionMap[row][col] === region) cells.push({ row, col });
				}
			}
			if (target === null || cells.length < target.length) target = cells;
		}
		if (target === null) return null;

		for (const cell of target) {
			const result = solve([...placed, cell], depth + 1);
			if (result !== null) return result;
			backtracks++;
		}
		return null;
	};

	const depth = solve([], 0);
	return { depth: depth ?? 0, nodes, backtracks };
}
