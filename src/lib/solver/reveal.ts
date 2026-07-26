/**
 * Choosing which cell a reveal hands back.
 *
 * Pure, and in the solver core rather than in the Edge Function, for the reason
 * everything else here is: it is a RULE, and rules belong where all three callers
 * can reach them and where they can be tested without I/O. The Edge Function is
 * only the I/O around this decision.
 *
 * The rule is deliberately blunt — hand back the first solution queen the player
 * has not already found, scanning by row. It does not attempt to pick the
 * "most instructive" next deduction, because the moment it does it needs a model of
 * what the player can already infer, and a wrong guess there is worse than an
 * honest one: this is the hint a stuck player takes to finish rather than abandon.
 *
 * It works from ANY board state, including one that has drifted from the solution
 * or been corrupted. That is the whole reason the reveal is a server round-trip
 * rather than a client solver — a client-side reveal computed from a wrong board is
 * unreliable exactly when the player most needs it.
 */

import type { Board, Cell } from './types';

/**
 * The next correct cell to reveal, or `null` when the player has already placed
 * every queen in the solution (in which case there is nothing left to reveal and
 * the board is either solved or holds only surplus marks).
 *
 * "Already found" means a queen standing on that exact cell. A mark (X) sitting on
 * a solution cell is a mistake the player has made, and revealing it is precisely
 * the help they asked for — so it does not count as found.
 */
export function nextReveal(board: Board, solution: readonly Cell[]): Cell | null {
	const ordered = [...solution].sort((a, b) => a.row - b.row || a.col - b.col);
	for (const cell of ordered) {
		if (!isQueenAt(board, cell)) return { row: cell.row, col: cell.col };
	}
	return null;
}

/**
 * Whether the board already holds a queen at that cell. Out-of-range cells read as
 * "not a queen" rather than throwing: a board that disagrees with the solution's
 * size is corrupt input, and the reveal's job is to survive corrupt input.
 */
function isQueenAt(board: Board, cell: Cell): boolean {
	return board[cell.row]?.[cell.col] === 'queen';
}
