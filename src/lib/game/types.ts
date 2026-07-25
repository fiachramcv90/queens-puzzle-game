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
 * Lightweight, non-authoritative player preferences. Kept in the same guest blob as
 * the in-progress board, and mirrored to the profile once signed in so they follow
 * the player across devices (see `$lib/auth/profile`). Every field is optional: a blob
 * written before a pref existed still loads, falling back to the base experience. The
 * palette token set and the region-label toggle are defined by the accessibility
 * ticket (#24); their names are reserved here so prefs have one home to grow into.
 */
export interface GuestPrefs {
	/** Named palette token set. Reserved for #24; the base palette until then. */
	readonly palette?: string;
	/** Show region labels for colourblind safety. Reserved for #24. */
	readonly regionLabels?: boolean;
	/** Auto-place mark (X) on cells a placed queen rules out. */
	readonly autoMarkX?: boolean;
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
 * One completed play as the guest records it locally — the guest's mirror of a
 * server `plays` row, and the input to the shared history builder ($lib/history).
 * A record is appended the moment a play is submitted, so a guest's history survives
 * offline and follows them until the merge folds the equivalent server rows onto
 * their account.
 *
 * `puzzleDate` is which daily this is; `playedDate` is the Dublin date it was
 * actually played on. They agree for today's daily and disagree for an archive play
 * — the same two-dates model the server uses to keep an archive solve streak-neutral
 * and unranked, so no separate "is archive" flag is stored.
 */
export interface LocalPlayRecord {
	/** The daily's Dublin date, `YYYY-MM-DD`. */
	readonly puzzleDate: string;
	/** The Dublin date the play was solved on, `YYYY-MM-DD`. */
	readonly playedDate: string;
	/** 1 for the first attempt at this daily, incrementing per later attempt. */
	readonly attemptNo: number;
	/** Credited time in ms, exactly as the server recorded it. */
	readonly elapsedMs: number;
	/** Server-derived mistakes, or null when the solve could not be verified. */
	readonly mistakes: number | null;
	/** Hints used (0 until the hints feature ships, #28). */
	readonly hintsUsed: number;
	readonly assisted: boolean;
	readonly stale: boolean;
	readonly unverified: boolean;
	/** A later completed attempt at an already-solved daily: practice, no ranking. */
	readonly replay: boolean;
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
	/**
	 * The Dublin dates this guest has solved a daily on, in `YYYY-MM-DD` — the local
	 * record a guest's streak is derived from (see `$lib/streak`). A guest only ever
	 * plays today's daily, so every entry is an eligible in-window solve. It survives
	 * the merge server-side: once signed in, `recompute_streaks` rebuilds the streak
	 * from the re-keyed play rows, so this local list is only ever the guest's mirror.
	 */
	readonly solvedDates?: string[];
	/**
	 * Every daily this guest has completed, one record per submitted play — the local
	 * source the history view reads from before sign-in. Includes archive plays (whose
	 * `playedDate` differs from `puzzleDate`). Optional so a blob written before this
	 * feature still loads (it restores an empty history). Survives the merge server-side
	 * once the equivalent server rows are re-keyed onto the account.
	 */
	readonly plays?: LocalPlayRecord[];
	/**
	 * Set once this guest's server-side history has been folded onto a signed-in
	 * account. Absent or false means the merge is still pending: on the next
	 * authenticated load the client attempts it (again, if a prior attempt failed or
	 * was offline). The merge itself is idempotent, so this flag is a cost-saver, not
	 * a correctness gate.
	 */
	readonly merged?: boolean;
}
