import { isAdjacent } from './adjacency';
import type { Cell, RegionMap } from './types';

/**
 * The one region-assignment backtracker the solver core searches with.
 *
 * A solution is a placement of one queen per region that also satisfies one queen
 * per row, one per column, and no two king-adjacent — the same rules
 * {@link checkRules} enforces, phrased as an exact-cover over regions. The search
 * assigns the **most-constrained region first** (fewest remaining candidates) so
 * dead ends surface early, and stops the moment `cap` solutions have been
 * visited: "is there more than one?" only ever needs `cap = 2`.
 *
 * `visit` is called once per solution with the live `placed` array (in region-
 * assignment order, not row order) — a callback rather than a return value so a
 * caller that only needs the *count* pays no allocation, while one that needs the
 * boards copies the snapshot itself. Both {@link countSolutions} and the
 * generator's rival-finder are this function with different visitors.
 */
export function forEachSolution(
	regionMap: RegionMap,
	cap: number,
	visit: (placed: readonly Cell[]) => void
): void {
	const size = regionMap.length;
	if (size === 0 || cap <= 0) return;

	// Cells grouped by region id.
	const regionCells = new Map<number, Cell[]>();
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			const region = regionMap[row][col];
			let cells = regionCells.get(region);
			if (!cells) regionCells.set(region, (cells = []));
			cells.push({ row, col });
		}
	}
	const regions = [...regionCells.keys()];

	const usedRows = new Array<boolean>(size).fill(false);
	const usedCols = new Array<boolean>(size).fill(false);
	const placed: Cell[] = [];
	const assigned = new Set<number>();
	let found = 0;

	const candidates = (region: number): Cell[] =>
		regionCells
			.get(region)!
			.filter(
				(cell) =>
					!usedRows[cell.row] &&
					!usedCols[cell.col] &&
					placed.every((queen) => !isAdjacent(queen, cell))
			);

	const search = (): void => {
		if (found >= cap) return;
		if (assigned.size === regions.length) {
			found++;
			visit(placed);
			return;
		}

		// Most-constrained region first: the unassigned region with the fewest
		// candidates. An empty candidate set is a dead end — prune at once.
		let target: number | null = null;
		let targetCandidates: Cell[] = [];
		for (const region of regions) {
			if (assigned.has(region)) continue;
			const cells = candidates(region);
			if (target === null || cells.length < targetCandidates.length) {
				target = region;
				targetCandidates = cells;
				if (cells.length === 0) break;
			}
		}
		if (target === null) return;

		for (const cell of targetCandidates) {
			usedRows[cell.row] = true;
			usedCols[cell.col] = true;
			placed.push(cell);
			assigned.add(target);

			search();

			assigned.delete(target);
			placed.pop();
			usedCols[cell.col] = false;
			usedRows[cell.row] = false;

			if (found >= cap) return;
		}
	};

	search();
}

/**
 * Collect up to `cap` full solutions of a region map, each returned as one queen
 * per row in row order. A thin {@link forEachSolution} caller that snapshots and
 * row-sorts each placement — used where the boards themselves are needed, not
 * just their count.
 */
export function collectSolutions(regionMap: RegionMap, cap: number): Cell[][] {
	const found: Cell[][] = [];
	forEachSolution(regionMap, cap, (placed) => {
		found.push([...placed].sort((a, b) => a.row - b.row));
	});
	return found;
}
