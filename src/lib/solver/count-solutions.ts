import { isAdjacent } from './adjacency';
import type { Cell, RegionMap } from './types';

/**
 * Count the legal full queen placements for a region map, stopping the moment
 * the count reaches `stopAt`.
 *
 * The only question ever asked of this is "is there more than one solution?", so
 * the default `stopAt = 2` returns as soon as a second solution is found and
 * never enumerates the rest. A return of exactly `stopAt` therefore means "at
 * least `stopAt`", not "exactly `stopAt`".
 *
 * The search assigns one queen per region, taking the most-constrained region
 * (fewest remaining candidates) first so dead ends surface early. A solution is
 * a placement of one queen per region that also satisfies one queen per row, one
 * per column, and no two king-adjacent — the same rules {@link checkRules}
 * enforces. N is taken from the region map.
 *
 * The input is the region map, not a played board: this answers "does this
 * region layout have a unique solution?", which is all the generator's
 * uniqueness check asks (the spec's loose "board" argument — see issue #18,
 * where the counter re-checks a re-grown region layout). It needs no placed
 * queens.
 */
export function countSolutions(regionMap: RegionMap, stopAt = 2): number {
	const size = regionMap.length;
	if (size === 0 || stopAt <= 0) return 0;

	// Cells grouped by region id.
	const regionCells = new Map<number, Cell[]>();
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			const region = regionMap[row][col];
			let cells = regionCells.get(region);
			if (!cells) {
				cells = [];
				regionCells.set(region, cells);
			}
			cells.push({ row, col });
		}
	}
	const regions = [...regionCells.keys()];

	const usedRows = new Array<boolean>(size).fill(false);
	const usedCols = new Array<boolean>(size).fill(false);
	const placed: Cell[] = [];
	const assigned = new Set<number>();
	let count = 0;

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
		if (count >= stopAt) return;
		if (assigned.size === regions.length) {
			count++;
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

			if (count >= stopAt) return;
		}
	};

	search();
	return count;
}
