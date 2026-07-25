/**
 * The signed-in player's history, read from the server.
 *
 * A signed-in player's plays are the authority — RLS `select-own` on `plays` lets the
 * browser client read exactly their own rows and no one else's, so no Edge Function is
 * needed for a read. This module maps those rows to the shared {@link PlayRecord} the
 * history builder consumes, so the server and guest paths produce identical entries.
 *
 * `playedDate` is derived here the same way the database does — the Dublin date of
 * `started_at` — using the client mirror `dublinDate`, so an archive play (past
 * `puzzle_date`, today's `started_at`) reads as streak-neutral and unranked without a
 * stored flag.
 */

import { supabaseBrowserClient } from '$lib/supabase/browser';
import { dublinDate } from '$lib/streak/streak';
import type { PlayRecord } from './history';

/** The columns of `plays` history needs, as Supabase returns them (snake_case). */
interface PlayRow {
	puzzle_date: string;
	started_at: string;
	attempt_no: number;
	completed_at: string | null;
	elapsed_ms: number | null;
	mistakes: number | null;
	hints_used: number;
	assisted: boolean;
	stale: boolean;
	unverified: boolean;
	replay: boolean;
}

function rowToRecord(row: PlayRow): PlayRecord {
	return {
		puzzleDate: row.puzzle_date,
		playedDate: dublinDate(new Date(row.started_at)),
		attemptNo: row.attempt_no,
		completed: row.completed_at !== null,
		// elapsed_ms is null until completion; a completed row always carries a number.
		elapsedMs: Number(row.elapsed_ms ?? 0),
		mistakes: row.mistakes,
		hintsUsed: row.hints_used,
		assisted: row.assisted,
		stale: row.stale,
		unverified: row.unverified,
		replay: row.replay
	};
}

/**
 * Fetch the signed-in player's completed plays as history records. Reads only completed
 * rows (an in-progress play is not history yet) under select-own RLS. Returns an empty
 * list when signed out, so a caller can always fall back to local guest records.
 */
export async function fetchPlayHistory(): Promise<PlayRecord[]> {
	const { data, error } = await supabaseBrowserClient()
		.from('plays')
		.select(
			'puzzle_date, started_at, attempt_no, completed_at, elapsed_ms, mistakes, hints_used, assisted, stale, unverified, replay'
		)
		.not('completed_at', 'is', null)
		.order('puzzle_date', { ascending: false });
	if (error) throw error;
	return ((data ?? []) as PlayRow[]).map(rowToRecord);
}
