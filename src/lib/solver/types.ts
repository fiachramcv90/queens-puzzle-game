/**
 * The shared vocabulary of the solver core.
 *
 * These types are the board and region-map representations, the cell states and
 * the move-log format that every later consumer — the offline generator, the
 * client's live conflict highlighting and the server's submission replay — reads
 * and writes. There is deliberately one definition of each here so the three
 * systems cannot drift apart.
 *
 * This module is a pure library: no I/O, no framework, no Supabase import. That
 * purity is a hard constraint (see the MVP build spec, issue #18) — it is what
 * lets the same code run in a GitHub Action, in the browser and inside an Edge
 * Function.
 */

/**
 * The state of a single cell.
 *
 * - `empty` — nothing placed.
 * - `X` — a player-placed mark. The deduction is the puzzle; X's are the
 *   player's own notation.
 * - `queen` — a placed queen. The only state the rules care about.
 * - `auto-X` — a machine-placed mark, present only while the auto-mark-X assist
 *   is on. Visually lighter than a player `X`, cleared and recomputed as queens
 *   move. Enabling the assist counts as a hint.
 *
 * Use these words in code, tests and UI — the domain language is fixed.
 */
export type CellState = 'empty' | 'X' | 'queen' | 'auto-X';

/**
 * A queen board: an N×N grid of cell states, indexed `board[row][col]`.
 *
 * Rows and columns both run `0 .. N-1`. Only cells in the `queen` state affect
 * the rules; `X`, `auto-X` and `empty` are ignored by {@link checkRules}.
 */
export type Board = readonly (readonly CellState[])[];

/**
 * A region map: an N×N grid assigning every cell to a region, indexed
 * `regionMap[row][col]`. Region ids are integers `0 .. N-1`, one region per id.
 *
 * The region map is the public half of a puzzle — it ships to the client. The
 * solution never does.
 */
export type RegionMap = readonly (readonly number[])[];

/** A cell coordinate on the board. */
export interface Cell {
	readonly row: number;
	readonly col: number;
}

/**
 * A single entry in a move log: at time `t` (milliseconds since the
 * server-authoritative play start), the cell at `(row, col)` was set to `to`.
 *
 * The log is the ordered record of everything a player did. The server replays
 * it to derive the mistake count; it is also kept for audit and "replay your
 * solve". The format is versioned — see {@link MOVE_LOG_FORMAT_VERSION}.
 */
export interface Move {
	/** Milliseconds since the play started. */
	readonly t: number;
	readonly row: number;
	readonly col: number;
	/** The state the cell was set to by this move. */
	readonly to: CellState;
}

/** An ordered move log — replayed as a unit, never a move at a time. */
export type MoveLog = readonly Move[];
