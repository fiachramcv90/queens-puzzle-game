/**
 * The global leaderboard, as the client models it.
 *
 * Deliberately framework-free and I/O-free: the board's rows arrive from ONE place —
 * the `global_leaderboard()` security-definer function (see
 * `supabase/migrations/20260727120000_global_leaderboard.sql`) — and this module only
 * maps them, pages them, and derives the player's own standing. Every rule that decides
 * WHICH plays reach the board lives in the `ranked_plays` view; nothing here re-implements
 * any part of that filter, and nothing here sorts: the ranking (solve time, then fewest
 * mistakes, then earliest submission) is computed in SQL so page 2 continues page 1
 * rather than re-ranking a slice.
 */

import type { HistoryEntry } from '$lib/history/history';

/**
 * A row exactly as `global_leaderboard()` returns it. The `bigint` columns (`rank`,
 * `elapsed_ms`) can arrive as strings over PostgREST, so they are typed as they really
 * come and coerced in {@link rowToEntry} rather than trusted.
 */
export interface LeaderboardRow {
	readonly rank: number | string;
	readonly display_name: string;
	readonly elapsed_ms: number | string;
	readonly mistakes: number | null;
	readonly is_you: boolean;
}

/** One row of the board as the UI shows it. */
export interface LeaderboardEntry {
	/** Position on the whole board, not within the page. */
	readonly rank: number;
	readonly displayName: string;
	/** The credited solve time in ms. */
	readonly elapsedMs: number;
	/** Server-derived mistakes. Null is not reachable on this board (an unverified play is never ranked), but the column is nullable. */
	readonly mistakes: number | null;
	/** This row belongs to the signed-in player reading the board. */
	readonly isYou: boolean;
}

/**
 * How many rows one page of the board shows. A presentation choice rather than an
 * operational tunable — the function accepts any limit and clamps it server-side — so it
 * lives with the view that renders it rather than in `$lib/config`.
 */
export const PAGE_SIZE = 25;

/** The `offset` for a zero-based page number. A negative page is the first page. */
export function offsetFor(page: number): number {
	return Math.max(0, Math.floor(page)) * PAGE_SIZE;
}

/** Map one returned row to its display entry, coercing the bigint columns. */
export function rowToEntry(row: LeaderboardRow): LeaderboardEntry {
	return {
		rank: Number(row.rank),
		displayName: row.display_name,
		elapsedMs: Number(row.elapsed_ms),
		mistakes: row.mistakes,
		isYou: row.is_you
	};
}

/** One page of the board, and whether another page exists after it. */
export interface LeaderboardPage {
	readonly entries: LeaderboardEntry[];
	readonly hasNext: boolean;
}

/**
 * Turn a read of `pageSize + 1` rows into a page. Reading one row past the page is how
 * "is there a next page" is answered without a second count query over the whole board —
 * the probe row is reported, never displayed.
 */
export function toPage(
	rows: readonly LeaderboardRow[],
	pageSize: number = PAGE_SIZE
): LeaderboardPage {
	return {
		entries: rows.slice(0, pageSize).map(rowToEntry),
		hasNext: rows.length > pageSize
	};
}

/**
 * The player's own two times for the daily, and why they differ.
 *
 * "History takes the best result per day; ranked takes the first completed in-window
 * play" is the pair of rules the build spec insists must be visible rather than
 * mysterious, so a player who retried for practice sees both numbers with the rule that
 * separates them — and a player whose solve reached no board is told which rule kept it
 * off rather than being left to guess.
 */
export interface OwnStanding {
	/** The fastest completed attempt of the daily. */
	readonly bestMs: number;
	/** The ranked time — the one on the board — or null when nothing was eligible. */
	readonly rankedMs: number | null;
	/** The two times are different numbers, so the UI shows both. */
	readonly differ: boolean;
	/** Why they differ, or why nothing ranked. Null when there is nothing to explain. */
	readonly reason: string | null;
}

/**
 * Derive the player's standing from their history entry for the daily, or null when they
 * have not completed it. Takes the entry rather than raw records so the best/ranked rules
 * stay in `buildHistory` — their single home — and are not re-derived here.
 */
export function ownStanding(entry: HistoryEntry | null): OwnStanding | null {
	if (!entry) return null;

	const bestMs = entry.best.elapsedMs;
	const rankedMs = entry.ranked?.elapsedMs ?? null;
	const differ = rankedMs !== null && rankedMs !== bestMs;

	return { bestMs, rankedMs, differ, reason: reasonFor(entry, differ) };
}

function reasonFor(entry: HistoryEntry, differ: boolean): string | null {
	if (entry.ranked === null) {
		if (entry.assisted) return 'Assisted solves are not ranked — a hint was used.';
		if (entry.streakNeutral) return 'An archive play never reaches that daily’s board.';
		return 'This solve is not ranked.';
	}
	if (differ) return 'Only your first completed attempt is ranked; later attempts are practice.';
	return null;
}
