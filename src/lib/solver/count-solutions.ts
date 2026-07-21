import { forEachSolution } from './region-search';
import type { RegionMap } from './types';

/**
 * Count the legal full queen placements for a region map, stopping the moment
 * the count reaches `stopAt`.
 *
 * The only question ever asked of this is "is there more than one solution?", so
 * the default `stopAt = 2` returns as soon as a second solution is found and
 * never enumerates the rest. A return of exactly `stopAt` therefore means "at
 * least `stopAt`", not "exactly `stopAt`".
 *
 * The search itself — one queen per region, most-constrained region first — is
 * {@link forEachSolution}; this is that search with a counting visitor. A
 * solution is a placement of one queen per region that also satisfies one queen
 * per row, one per column, and no two king-adjacent — the same rules
 * {@link checkRules} enforces. N is taken from the region map.
 *
 * The input is the region map, not a played board: this answers "does this
 * region layout have a unique solution?", which is all the generator's
 * uniqueness check asks (the spec's loose "board" argument — see issue #18,
 * where the counter re-checks a re-grown region layout). It needs no placed
 * queens.
 */
export function countSolutions(regionMap: RegionMap, stopAt = 2): number {
	let count = 0;
	forEachSolution(regionMap, stopAt, () => {
		count++;
	});
	return count;
}
