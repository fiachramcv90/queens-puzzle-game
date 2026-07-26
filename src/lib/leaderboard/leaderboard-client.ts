/**
 * Reading the global board from the browser.
 *
 * The board is served ONLY by `global_leaderboard()` — never a direct select from
 * `plays`, which is select-own under RLS and would return the reader's own row and
 * nothing else even if a client tried. Calling the function is what makes a cross-player
 * board possible at all, and the function is what decides which columns exist.
 *
 * The publishable-key client carries no privilege of its own; if a session is present the
 * function sees it through `auth.uid()` and marks the player's own row.
 */

import { supabaseBrowserClient } from '$lib/supabase/browser';
import {
	PAGE_SIZE,
	offsetFor,
	toPage,
	type LeaderboardPage,
	type LeaderboardRow
} from './leaderboard';

/**
 * Fetch one page of the global board for a daily. `date` defaults to today's daily
 * server-side, so the client never computes the rollover itself.
 *
 * Reads one row past the page so {@link toPage} can report whether a next page exists
 * without a second count over the whole board.
 */
export async function fetchGlobalLeaderboard(opts: {
	date?: string;
	page?: number;
}): Promise<LeaderboardPage> {
	const { data, error } = await supabaseBrowserClient().rpc('global_leaderboard', {
		p_date: opts.date ?? null,
		p_limit: PAGE_SIZE + 1,
		p_offset: offsetFor(opts.page ?? 0)
	});
	if (error) throw error;
	return toPage((data ?? []) as LeaderboardRow[]);
}
