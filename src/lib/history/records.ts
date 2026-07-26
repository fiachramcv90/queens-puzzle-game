/**
 * Adapters between the two record sources the history view unifies — the guest's
 * local records and the signed-in player's server rows — and the shared
 * {@link PlayRecord} the builder consumes.
 *
 * Keeping the append/dedupe rule here (rather than inline in the play page) makes it
 * testable without a browser and keeps "one record per (daily, attempt)" true even if
 * a solve effect fires twice on a flaky reload.
 */

import type { LocalPlayRecord } from '$lib/game/types';
import type { PlayResult } from '$lib/game/types';
import type { PlayRecord } from './history';

/** A completed local record is, by construction, a completed {@link PlayRecord}. */
export function localToPlayRecord(record: LocalPlayRecord): PlayRecord {
	return { ...record, completed: true };
}

/**
 * Build the local record for a just-submitted play from the server's result and the
 * daily it belongs to. `playedDate` is today's Dublin date — an archive play's daily
 * date is in the past, so the two diverge exactly when the play is streak-neutral.
 */
export function recordFromResult(
	result: PlayResult,
	puzzleDate: string,
	playedDate: string
): LocalPlayRecord {
	return {
		puzzleDate,
		playedDate,
		attemptNo: result.attemptNo,
		elapsedMs: result.elapsedMs,
		mistakes: result.mistakes,
		// Both are the server's numbers, echoed from the submit response. A local
		// record that disagreed with the row would show a player a clean history for a
		// play the leaderboard had already excluded.
		hintsUsed: result.hintsUsed,
		assisted: result.assisted,
		stale: result.stale,
		unverified: result.unverified,
		replay: result.replay
	};
}

/**
 * Append a record to the guest's local history, replacing any existing record for the
 * same (daily, attempt) so a re-submitted or re-restored solve never doubles a row.
 */
export function appendRecord(
	existing: readonly LocalPlayRecord[] | undefined,
	record: LocalPlayRecord
): LocalPlayRecord[] {
	const kept = (existing ?? []).filter(
		(r) => !(r.puzzleDate === record.puzzleDate && r.attemptNo === record.attemptNo)
	);
	return [...kept, record];
}
