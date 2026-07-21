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
import type { Board, Cell, DifficultyTier, RegionMap } from '$lib/solver';
import { createEmptyBoard, sweepX, tapCell, toggleXCell } from './board';
import { deriveConflicts } from './conflicts';
import type { Daily, PersistedPlay } from './types';

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

	/** Cells to ring red — exactly the shared solver core's conflict set. */
	readonly conflicts: ReadonlySet<string> = $derived(deriveConflicts(this.board, this.regionMap));
	/** A complete, legal board. The win condition, derived — no check button. */
	readonly solved: boolean = $derived(checkRules(this.board, this.regionMap).solved);
	/** Queens currently placed, for the "k/N placed" status line. */
	readonly queenCount: number = $derived(
		this.board.reduce((n, row) => n + row.filter((c) => c === 'queen').length, 0)
	);
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
		this.nowMs = Date.now();
	}

	/** Tap a cell, advancing it through `empty → X → queen → empty`. */
	tap(row: number, col: number): void {
		this.board = tapCell(this.board, row, col);
		this.freezeIfSolved();
	}

	/** Right-click: toggle an X on a cell directly, skipping the cycle. */
	toggleX(row: number, col: number): void {
		this.board = toggleXCell(this.board, row, col);
		this.freezeIfSolved();
	}

	/** Drag-sweep: mark a run of cells with X in one gesture. */
	sweep(cells: readonly Cell[]): void {
		this.board = sweepX(this.board, cells);
		this.freezeIfSolved();
	}

	/** The play as it should be persisted right now. */
	snapshot(): PersistedPlay {
		return {
			puzzleId: this.puzzleId,
			board: this.board,
			startedAt: this.startedAt,
			solvedElapsedMs: this.solvedElapsedMs
		};
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
