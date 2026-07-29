/**
 * The reactive game state for one daily — the runes store the board component and
 * page bind to.
 *
 * It owns the board and derives everything a rule question answers from the
 * shared solver core: the conflict set to ring, and whether the board is solved.
 * Win detection is therefore automatic and continuous — there is no check action,
 * because `solved` is simply a derivation of the current board.
 *
 * The timer here is DISPLAY ONLY. `startedAt` is wall-clock and `elapsedMs` ticks
 * off a `nowMs` the host bumps each second; the next ticket makes the server the
 * authority on credited time, and nothing here should be read as the number that
 * counts.
 */

import { checkRules } from '$lib/solver';
import type { Board, Cell, DifficultyTier, Move, MoveLog, RegionMap } from '$lib/solver';
import { clearMarks, countMarks, createEmptyBoard, sweepX, tapCell, toggleXCell } from './board';
import { applyAutoMarks, clearAutoMarks } from './hints';
import { deriveConflicts } from './conflicts';
import type { Daily, PersistedPlay, PlayResult } from './types';

export class GameState {
	readonly puzzleId: string;
	readonly size: number;
	readonly tier: DifficultyTier;
	// Assigned once in the constructor and never mutated; the plain initializer is
	// only here so the derived fields below can reference it without a
	// "used before initialization" complaint (the derivations run lazily, after
	// the constructor has set the real map).
	regionMap: RegionMap = [];

	/** The full mark-up: every cell's state. Swapped as a whole on each move. */
	board: Board = $state.raw([]);
	/** Epoch ms the display timer started (persisted, so a refresh continues it). */
	startedAt: number = $state(0);
	/** Frozen elapsed ms once solved; `undefined` while still solving. */
	solvedElapsedMs: number | undefined = $state(undefined);
	/** Wall clock the host bumps each second to advance the running timer. */
	nowMs: number = $state(Date.now());
	/** The opaque server play token, once `start` has returned it. */
	token: string | undefined = $state(undefined);
	/** The server's recorded result, once the solve has been submitted. */
	result: PlayResult | undefined = $state(undefined);

	/**
	 * Whether this play has taken a hint. Mirrors the SERVER's flag — the server
	 * sets it, this only reflects what the server said so the UI can stop warning a
	 * player who is already unranked. Nothing here is what the leaderboard reads.
	 */
	assisted: boolean = $state(false);
	/** Hints taken, as counted by the server. Shown to friends, never to rank. */
	hintsUsed: number = $state(0);
	/** Whether the auto-mark-X assist is currently filling cells. */
	autoMarkX: boolean = $state(false);
	/** Cells the mistake check flagged, until the next move clears them. */
	flagged: readonly Cell[] = $state.raw([]);

	/**
	 * The move log: every cell state-change in order, `t` ms since the play start.
	 * The server replays it to derive mistakes and to verify the board, so it is
	 * carried here (and persisted) rather than reconstructed. Not reactive — nothing
	 * renders from it directly.
	 */
	private moves: Move[] = [];

	/** Cells to ring red — exactly the shared solver core's conflict set. */
	readonly conflicts: ReadonlySet<string> = $derived(deriveConflicts(this.board, this.regionMap));
	/** A complete, legal board. The win condition, derived — no check button. */
	readonly solved: boolean = $derived(checkRules(this.board, this.regionMap).solved);
	/** Queens currently placed, for the "k/N placed" status line. */
	readonly queenCount: number = $derived(
		this.board.reduce((n, row) => n + row.filter((c) => c === 'queen').length, 0)
	);
	/** The player's own marks currently down — what the clear control acts on. */
	readonly markCount: number = $derived(countMarks(this.board));
	/** Display-only elapsed time: frozen once solved, live otherwise. */
	readonly elapsedMs: number = $derived(
		this.solvedElapsedMs ?? Math.max(0, this.nowMs - this.startedAt)
	);

	constructor(daily: Daily, restored?: PersistedPlay) {
		this.puzzleId = daily.id;
		this.regionMap = daily.regionMap;
		this.size = daily.boardSize;
		this.tier = daily.tier;
		// Restore a play only if it belongs to THIS daily; a new day starts fresh.
		const usable = restored && restored.puzzleId === daily.id ? restored : undefined;
		this.board = usable ? usable.board : createEmptyBoard(daily.boardSize);
		this.startedAt = usable ? usable.startedAt : Date.now();
		this.solvedElapsedMs = usable?.solvedElapsedMs;
		this.moves = usable?.moveLog ? [...usable.moveLog] : [];
		this.token = usable?.token;
		this.result = usable?.result;
		this.assisted = usable?.assisted ?? false;
		this.hintsUsed = usable?.hintsUsed ?? 0;
		this.autoMarkX = usable?.autoMarkX ?? false;
		this.nowMs = Date.now();
	}

	/** Tap a cell, advancing it through `empty → X → queen → empty`. */
	tap(row: number, col: number): void {
		this.applyMove(tapCell(this.board, row, col));
	}

	/** Right-click: toggle an X on a cell directly, skipping the cycle. */
	toggleX(row: number, col: number): void {
		this.applyMove(toggleXCell(this.board, row, col));
	}

	/** Drag-sweep: mark a run of cells with X in one gesture. */
	sweep(cells: readonly Cell[]): void {
		this.applyMove(sweepX(this.board, cells));
	}

	/**
	 * Clear every mark in one action, leaving the queens exactly where they are.
	 *
	 * NOT a hint, and so deliberately not routed anywhere near one: clearing REMOVES
	 * information and can never bring a player closer to the solution, so it costs
	 * nothing — no server call, no `assisted` charge, no ranking. It goes through the
	 * normal move path like every other interaction, so each cleared cell lands in the
	 * move log and the server's replay reproduces the board it produced.
	 */
	clearMarks(): void {
		this.applyMove(clearMarks(this.board));
	}

	/**
	 * Turn the auto-mark-X assist on or off. Turning it ON immediately fills the
	 * ruled-out cells; turning it OFF clears every mark it placed and leaves the
	 * player's own alone.
	 *
	 * The `assisted` charge is NOT made here — the caller records it with the server
	 * first and only flips this once the server has agreed. A locally-set flag would
	 * be exactly the client-confessed flag the spec forbids.
	 */
	setAutoMarkX(on: boolean): void {
		this.autoMarkX = on;
		this.applyMove(on ? applyAutoMarks(this.board, this.regionMap) : clearAutoMarks(this.board));
	}

	/** Show the mistake check's findings until the player's next move. */
	flag(cells: readonly Cell[]): void {
		this.flagged = cells;
	}

	/**
	 * Place a revealed queen. It goes through the normal move path, so it lands in
	 * the move log exactly like a hand-placed queen — the log is a record of what
	 * happened to the board, and a revealed queen did happen.
	 */
	reveal(cell: Cell): void {
		this.applyMove(
			this.board.map((cells, row) =>
				cells.map((state, col) => (row === cell.row && col === cell.col ? 'queen' : state))
			)
		);
	}

	/** The move log so far — what the client submits and persists. */
	moveLog(): MoveLog {
		return this.moves;
	}

	/** The play as it should be persisted right now. */
	snapshot(): PersistedPlay {
		return {
			puzzleId: this.puzzleId,
			board: this.board,
			startedAt: this.startedAt,
			solvedElapsedMs: this.solvedElapsedMs,
			moveLog: this.moves,
			token: this.token,
			result: this.result,
			assisted: this.assisted,
			hintsUsed: this.hintsUsed,
			autoMarkX: this.autoMarkX
		};
	}

	/**
	 * Swap in a new board, logging every cell that changed as a move so the log
	 * captures exactly what the player did. Diffing here keeps recording in one
	 * place, correct no matter which interaction (tap, toggle, sweep) produced the
	 * new board. `t` is ms since the play start, so it survives the server anchoring
	 * `startedAt` after `start` returns.
	 */
	private applyMove(next: Board): void {
		// The assist owns its marks, so they are recomputed against the new board on
		// every move — a queen lifted must take its auto-X's with it, or the assist
		// quietly lies. This happens BEFORE the diff, deliberately: the log has to
		// describe the board that actually results, or the server's replay reproduces
		// a different board and flags an honest solve `unverified`.
		const settled = this.autoMarkX ? applyAutoMarks(next, this.regionMap) : next;

		const t = Math.max(0, Date.now() - this.startedAt);
		for (let row = 0; row < settled.length; row++) {
			for (let col = 0; col < settled[row].length; col++) {
				if (settled[row][col] !== this.board[row][col]) {
					this.moves.push({ t, row, col, to: settled[row][col] });
				}
			}
		}
		this.board = settled;
		// Any move invalidates what the mistake check found a moment ago.
		this.flagged = [];
		this.freezeIfSolved();
	}

	/**
	 * Stop the display timer the instant the board becomes solved, capturing the
	 * elapsed time so it no longer ticks. Idempotent — only the first solve freezes.
	 */
	private freezeIfSolved(): void {
		if (this.solvedElapsedMs === undefined && this.solved) {
			this.solvedElapsedMs = Math.max(0, Date.now() - this.startedAt);
		}
	}
}
