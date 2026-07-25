/**
 * The history builder — everything the player has done, and everything they
 * missed, as one pure derivation.
 *
 * This is the single home of the two rules the build spec insists must be written
 * down explicitly, because otherwise the merge and the archive quietly become
 * retry-shopping mechanisms:
 *
 *   - **History takes the BEST result per day** — the fastest completed attempt,
 *     tie-broken by fewest mistakes. Nothing a player achieved is discarded.
 *   - **Ranked takes the FIRST completed IN-WINDOW play** — non-replay,
 *     non-assisted, non-stale, non-verified-mismatch, and played on the daily's
 *     own Dublin date. This is the leaderboard-eligible time, the one frozen onto
 *     that day's board.
 *
 * It is deliberately framework-free and identity-agnostic: the same function
 * builds a guest's history from local records and a signed-in player's from server
 * rows, so the two can never drift. `isRanked` mirrors the SQL `ranked_plays`
 * view — the one rule, expressed once per side of the wire.
 */

/**
 * One completed-or-in-progress attempt at a daily by one identity, flattened to
 * exactly what history needs. `puzzleDate` is which daily this is; `playedDate` is
 * the Dublin date it was actually played on (`dublin_date(started_at)`), so an
 * archive play is precisely one where the two disagree — no separate flag, matching
 * the server's two-dates model.
 */
export interface PlayRecord {
	/** The daily's Dublin date, `YYYY-MM-DD`. */
	readonly puzzleDate: string;
	/** The Dublin date the attempt was played on, `YYYY-MM-DD`. */
	readonly playedDate: string;
	/** 1 for the first attempt at this daily, incrementing per later attempt. */
	readonly attemptNo: number;
	/** Whether the attempt was submitted and recorded. In-progress plays are excluded. */
	readonly completed: boolean;
	/** Credited time in ms (the server's number for a signed-in player). */
	readonly elapsedMs: number;
	/** Server-derived mistakes, or null when the solve could not be verified. */
	readonly mistakes: number | null;
	readonly hintsUsed: number;
	readonly assisted: boolean;
	readonly stale: boolean;
	readonly unverified: boolean;
	/** A later completed attempt at an already-solved daily: practice, no ranking. */
	readonly replay: boolean;
}

/** The result of one attempt, projected for display. */
export interface ResultSummary {
	readonly elapsedMs: number;
	readonly mistakes: number | null;
	readonly hintsUsed: number;
	readonly assisted: boolean;
}

/** One day in the history list — the best result, the ranked time, and the flags that qualify them. */
export interface HistoryEntry {
	/** The daily's Dublin date, `YYYY-MM-DD`. */
	readonly puzzleDate: string;
	/** The best (fastest, then fewest-mistakes) completed attempt of the day. */
	readonly best: ResultSummary;
	/**
	 * The ranked time for the day, or null when no completed attempt was eligible
	 * (archived, assisted, stale, or a verify mismatch). When present and different
	 * from `best`, the UI shows both ("your best: 1:42 · ranked: 3:10").
	 */
	readonly ranked: ResultSummary | null;
	/** More than one completed attempt exists for the day. */
	readonly replayed: boolean;
	/** No ranked attempt for the day — nothing reached that day's leaderboard. */
	readonly unranked: boolean;
	/**
	 * No completed attempt was played within the daily's own window — an archive-only
	 * day, which never touched the streak or that day's board.
	 */
	readonly streakNeutral: boolean;
	/** Whether any completed attempt of the day used an assist. */
	readonly assisted: boolean;
}

/**
 * Whether a play is ranked-eligible — the leaderboard filter, expressed once. The
 * TypeScript mirror of the SQL `ranked_plays` view: a completed attempt that is not
 * a replay, not assisted, not stale, not a verify mismatch, AND played within the
 * daily's own window (`puzzleDate === playedDate`). The last clause is what freezes
 * an archived board: a play made after the day passed can never rank on it.
 */
export function isRanked(record: PlayRecord): boolean {
	return (
		record.completed &&
		!record.replay &&
		!record.assisted &&
		!record.stale &&
		!record.unverified &&
		record.puzzleDate === record.playedDate
	);
}

/** Whether `a` is a strictly better result than `b`: faster, then fewer mistakes. */
function isBetter(a: PlayRecord, b: PlayRecord): boolean {
	if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs < b.elapsedMs;
	// A null (unverified) mistake count is treated as worst, so a verified result wins.
	const am = a.mistakes ?? Number.POSITIVE_INFINITY;
	const bm = b.mistakes ?? Number.POSITIVE_INFINITY;
	return am < bm;
}

function summarize(record: PlayRecord): ResultSummary {
	return {
		elapsedMs: record.elapsedMs,
		mistakes: record.mistakes,
		hintsUsed: record.hintsUsed,
		assisted: record.assisted
	};
}

/**
 * Build the history list from a flat set of play records — one entry per daily the
 * player completed, most recent first. In-progress attempts are ignored; a day
 * enters the list only once something was solved on it.
 */
export function buildHistory(records: Iterable<PlayRecord>): HistoryEntry[] {
	const byDate = new Map<string, PlayRecord[]>();
	for (const record of records) {
		if (!record.completed) continue;
		const day = byDate.get(record.puzzleDate);
		if (day) day.push(record);
		else byDate.set(record.puzzleDate, [record]);
	}

	const entries: HistoryEntry[] = [];
	for (const [puzzleDate, plays] of byDate) {
		const best = plays.reduce((b, p) => (isBetter(p, b) ? p : b));
		// At most one non-replay in-window play exists per identity and daily, but
		// reduce over all ranked-eligible plays keeps it robust if that ever slips.
		const rankedPlays = plays.filter(isRanked);
		const rankedPlay =
			rankedPlays.length > 0 ? rankedPlays.reduce((b, p) => (isBetter(p, b) ? p : b)) : null;

		entries.push({
			puzzleDate,
			best: summarize(best),
			ranked: rankedPlay ? summarize(rankedPlay) : null,
			replayed: plays.length > 1,
			unranked: rankedPlay === null,
			streakNeutral: !plays.some((p) => p.puzzleDate === p.playedDate),
			assisted: plays.some((p) => p.assisted)
		});
	}

	return entries.sort((a, b) => (a.puzzleDate < b.puzzleDate ? 1 : -1));
}
