/**
 * The client-side game vocabulary — the shapes the board UI, its persistence and
 * its data load agree on.
 *
 * The rules and the board representation are NOT redefined here: `Board`,
 * `CellState` and `RegionMap` come from the shared solver core ($lib/solver), so
 * the client cannot drift from the generator or the server's replay. This module
 * only adds what is client-only: the puzzle snapshot the page renders and the
 * persisted play a refresh restores.
 */

import type { Board, MoveLog, RegionMap } from '$lib/solver';
import type { DifficultyTier } from '$lib/solver';

/**
 * The public half of today's daily, as the client needs it to render and play:
 * the region map, the board size N, and the named difficulty tier. The solution
 * is deliberately absent — it never leaves the server.
 *
 * `date` is the Europe/Dublin calendar date the puzzle is the daily for (see the
 * rollover rule in the puzzle-tables migration). `id` keys persistence, so a new
 * daily starts a fresh play rather than colliding with yesterday's.
 */
export interface Daily {
	readonly id: string;
	/** ISO `YYYY-MM-DD`, Europe/Dublin. */
	readonly date: string;
	readonly boardSize: number;
	readonly tier: DifficultyTier;
	readonly regionMap: RegionMap;
}

/**
 * Lightweight, non-authoritative player preferences. Kept in the same guest blob
 * as the in-progress board. Empty for now — the palette and CVD toggles land in a
 * later ticket — but the shape exists so persistence has one home to grow into.
 */
export interface GuestPrefs {
	/** Reserved. The palette token set and CVD toggle arrive in a later ticket. */
	readonly [key: string]: never;
}

/**
 * The result the server recorded for a completed play, as the result screen shows
 * it. Credited time and mistakes are the server's numbers, never the client's —
 * the display timer above is only ever a preview of `elapsedMs`.
 */
export interface PlayResult {
	/** Credited time: server wall-clock, the number that counts. */
	readonly elapsedMs: number;
	/** Server-derived mistakes, or null when the solve could not be verified. */
	readonly mistakes: number | null;
	/** No heartbeat within the stale window: still counted, dropped from ranking. */
	readonly stale: boolean;
	/** The move log did not replay to the submitted board. */
	readonly unverified: boolean;
	/** A later attempt at an already-solved daily: practice, no ranking. */
	readonly replay: boolean;
	/** 1 for the first attempt at this daily, incrementing per later attempt. */
	readonly attemptNo: number;
}

/**
 * One puzzle's in-progress (or completed) play, as persisted. The board is the
 * full mark-up so a refresh restores exactly what the player left; the move log is
 * kept alongside it so a refresh mid-solve does not lose the record the server
 * replays (losing it would flag an honest solve `unverified`). `startedAt` and
 * `solvedElapsedMs` drive the display-only timer; `token` and `result` carry the
 * server-authoritative play across reloads.
 */
export interface PersistedPlay {
	readonly puzzleId: string;
	readonly board: Board;
	/** Epoch milliseconds the play's timer started (the server's start, once known). */
	readonly startedAt: number;
	/** Frozen elapsed milliseconds once solved; absent while still solving. */
	readonly solvedElapsedMs?: number;
	/**
	 * The move log so far — replayed by the server, so it must survive a refresh.
	 * Optional so a blob written before this feature still loads (it restores empty).
	 */
	readonly moveLog?: MoveLog;
	/** The opaque server play token, once `start` has returned it. */
	readonly token?: string;
	/** The server's recorded result, once the solve has been submitted. */
	readonly result?: PlayResult;
}

/**
 * The whole guest blob under one localStorage key. Minted on first play and keyed
 * by a guest UUID; holds prefs, the current in-progress play, and a snapshot of
 * the daily it belongs to.
 *
 * The `daily` snapshot is what makes an OFFLINE refresh work: with the region map
 * cached, a returning player whose network is down can still be handed back their
 * board, because the data load returned nothing to render from.
 */
export interface GuestBlob {
	readonly guestId: string;
	readonly prefs: GuestPrefs;
	/** The daily the current play belongs to, cached for offline rendering. */
	readonly daily?: Daily;
	/** The current in-progress (or just-solved) play, if any. */
	readonly play?: PersistedPlay;
}
