import { checkRules } from './check-rules';
import type { Board, CellState, MoveLog, RegionMap } from './types';

/** The outcome of replaying a move log through the rules. */
export interface ReplayResult {
	/**
	 * The board the log reconstructs, applying every move in order to an empty
	 * board. The server compares this to the submitted final board: a mismatch is
	 * the `unverified` signal (a deploy skew as likely as a cheat).
	 */
	readonly finalBoard: Board;
	/**
	 * Mistakes made over the play: the number of moves that placed a queen which,
	 * the instant it landed, broke a rule (shared a row, column or region with
	 * another queen, or was king-adjacent to one). Derived here and nowhere else —
	 * the client's own count is never trusted.
	 */
	readonly mistakes: number;
}

/**
 * Replay a move log to derive the final board and the mistake count.
 *
 * Every move sets one cell to a state; applied in log order to a fresh empty
 * board, they reproduce exactly what the player did. A move is counted as a
 * mistake only when it places a `queen` that is in conflict the moment it lands —
 * so undoing a bad placement later does not un-count the mistake, and X's and
 * clears are never mistakes. N is taken from the region map.
 *
 * Out-of-bounds moves are ignored rather than thrown on: a malformed log must
 * never crash the submit path. It will simply fail to reconstruct the submitted
 * board, which the server reads as `unverified`.
 */
export function replayMoveLog(regionMap: RegionMap, moveLog: MoveLog): ReplayResult {
	const size = regionMap.length;
	const board: CellState[][] = Array.from({ length: size }, () =>
		Array.from({ length: size }, (): CellState => 'empty')
	);

	let mistakes = 0;
	for (const move of moveLog) {
		if (!inBounds(move.row, move.col, size)) continue;
		board[move.row][move.col] = move.to;
		if (move.to === 'queen' && placedIntoConflict(board, regionMap, move.row, move.col)) {
			mistakes++;
		}
	}

	return { finalBoard: board, mistakes };
}

function inBounds(row: number, col: number, size: number): boolean {
	return (
		Number.isInteger(row) &&
		Number.isInteger(col) &&
		row >= 0 &&
		row < size &&
		col >= 0 &&
		col < size
	);
}

/** Whether the queen just placed at `(row, col)` is itself flagged as a conflict. */
function placedIntoConflict(board: Board, regionMap: RegionMap, row: number, col: number): boolean {
	return checkRules(board, regionMap).conflicts.some((c) => c.row === row && c.col === col);
}
