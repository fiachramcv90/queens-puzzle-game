/**
 * Live conflict highlighting — the subtle red ring on clashing queens.
 *
 * There is deliberately no adjacency or duplicate logic here. The set of ringed
 * cells is exactly `checkRules(...).conflicts` from the shared solver core, so
 * the client can never disagree with the generator or the server's replay about
 * what a rule breach is. This module only reshapes that list into a fast lookup
 * for rendering.
 *
 * This is the free baseline available to everyone: it is not a hint and never
 * flags a play as assisted.
 */

import { checkRules } from '$lib/solver';
import type { Board, RegionMap } from '$lib/solver';

/** A cell coordinate as a `"row,col"` string, for O(1) membership tests. */
function key(row: number, col: number): string {
	return `${row},${col}`;
}

/**
 * The set of cells to ring, keyed `"row,col"`. Empty on any legal board, partial
 * or complete — a legal mid-solve board with too few queens has nothing to flag.
 */
export function deriveConflicts(board: Board, regionMap: RegionMap): Set<string> {
	const { conflicts } = checkRules(board, regionMap);
	return new Set(conflicts.map(({ row, col }) => key(row, col)));
}

/** Whether the cell at `(row, col)` is in the conflict set. */
export function isConflict(conflicts: ReadonlySet<string>, row: number, col: number): boolean {
	return conflicts.has(key(row, col));
}
