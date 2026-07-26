/**
 * The two hints that compute in the browser.
 *
 * Both work from the PUBLIC region map and the player's own board. Neither needs —
 * or is given — the solution. That is a deliberate limit, not an oversight:
 *
 *   - The mistake check flags cells breaking a stated rule RIGHT NOW. It cannot
 *     flag a mark that is legal but not in the solution, because a solution-aware
 *     check would break solution-server-only and invite guess-and-check: place a
 *     queen, ask "is that wrong?", and the board becomes a search.
 *   - Auto-mark-X fills cells ruled out by row, column, region and king-adjacency —
 *     bookkeeping the player could do by hand, done faster.
 *
 * Both still cost the play its ranking, and that charge is recorded SERVER-side by
 * the `assist` endpoint. Computing locally and charging remotely is the honest
 * split: the help is cheap to produce, but admitting to it cannot be left to the
 * client or nobody would admit to anything.
 *
 * The always-on conflict ring is NOT here and is never a hint — it is the free
 * baseline every player gets.
 */

import type { Board, Cell, RegionMap } from '$lib/solver';
import { isAdjacent } from '$lib/solver';

/**
 * Every cell holding a queen that breaks a rule as the board currently stands:
 * a second queen in its row, its column or its region, or another queen a king's
 * move away.
 *
 * This is the same relation the conflict ring already draws — and that is the
 * point. The ring is passive and easy to miss on a full board; the mistake check
 * is the player asking "show me, now". Returning the cells rather than a boolean
 * lets the caller render them however it likes.
 */
export function findRuleViolations(board: Board, regionMap: RegionMap): Cell[] {
	const queens: Cell[] = [];
	for (let row = 0; row < board.length; row++) {
		for (let col = 0; col < board[row].length; col++) {
			if (board[row][col] === 'queen') queens.push({ row, col });
		}
	}

	const flagged = new Set<string>();
	for (let i = 0; i < queens.length; i++) {
		for (let j = i + 1; j < queens.length; j++) {
			const a = queens[i];
			const b = queens[j];
			const clashes =
				a.row === b.row ||
				a.col === b.col ||
				regionMap[a.row][a.col] === regionMap[b.row][b.col] ||
				isAdjacent(a, b);
			if (clashes) {
				flagged.add(`${a.row},${a.col}`);
				flagged.add(`${b.row},${b.col}`);
			}
		}
	}

	return queens.filter((q) => flagged.has(`${q.row},${q.col}`));
}

/**
 * The board with `auto-X` written onto every empty cell that a placed queen rules
 * out, and every existing `auto-X` that is no longer ruled out cleared back to
 * empty.
 *
 * Recomputed from scratch on every call rather than patched incrementally, because
 * the assist has to survive a queen being REMOVED: an incremental fill would leave
 * behind marks justified by a queen that is no longer there. The player's own `X`
 * and every `queen` are left exactly as they are — the assist owns only the cells
 * it placed, which is what makes the lighter `auto-X` state a separate state rather
 * than a flavour of `X`.
 */
export function applyAutoMarks(board: Board, regionMap: RegionMap): Board {
	const size = board.length;
	const queens: Cell[] = [];
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			if (board[row][col] === 'queen') queens.push({ row, col });
		}
	}

	const ruledOut = (row: number, col: number): boolean =>
		queens.some(
			(q) =>
				q.row === row ||
				q.col === col ||
				regionMap[q.row][q.col] === regionMap[row][col] ||
				isAdjacent(q, { row, col })
		);

	return board.map((cells, row) =>
		cells.map((state, col) => {
			if (state === 'empty' && ruledOut(row, col)) return 'auto-X';
			if (state === 'auto-X' && !ruledOut(row, col)) return 'empty';
			return state;
		})
	);
}

/**
 * The board with every `auto-X` cleared back to empty — what happens when the
 * player turns the assist off. Their own marks and queens are untouched.
 */
export function clearAutoMarks(board: Board): Board {
	return board.map((cells) => cells.map((state) => (state === 'auto-X' ? 'empty' : state)));
}
