/**
 * The friends board (#31) — the same rows as the global board, a different
 * projection and a different filter.
 *
 * The difference that matters: ASSISTED PLAYS ARE INCLUDED HERE, with their hint
 * count and an explicit badge. On the global board they are absent entirely. Among
 * friends a fast assisted solve should be legible as exactly what it is rather than
 * hidden, and hiding it would make the fast time look unexplained.
 *
 * That asymmetry is why both boards are security-definer functions over an
 * RLS-locked `plays` rather than policies: one base table, two projections, two
 * filters — which no single permissive policy can express.
 */

import { supabaseBrowserClient } from '$lib/supabase/browser';

/** One row of the friends board. */
export interface FriendsEntry {
	readonly rank: number;
	readonly userId: string;
	readonly displayName: string;
	readonly elapsedMs: number;
	readonly mistakes: number | null;
	readonly hintsUsed: number;
	readonly assisted: boolean;
	/** Read through the time-aware helper, so a lapsed friend shows 0. */
	readonly currentStreak: number;
	readonly isYou: boolean;
}

interface FriendsEntryDto {
	readonly rank: number;
	readonly user_id: string;
	readonly display_name: string;
	readonly elapsed_ms: number;
	readonly mistakes: number | null;
	readonly hints_used: number;
	readonly assisted: boolean;
	readonly current_streak: number;
	readonly is_you: boolean;
}

export function toFriendsEntry(dto: FriendsEntryDto): FriendsEntry {
	return {
		rank: Number(dto.rank),
		userId: dto.user_id,
		displayName: dto.display_name,
		elapsedMs: Number(dto.elapsed_ms),
		mistakes: dto.mistakes,
		hintsUsed: dto.hints_used ?? 0,
		assisted: dto.assisted,
		currentStreak: dto.current_streak ?? 0,
		isYou: dto.is_you
	};
}

/**
 * Fetch today's friends board.
 *
 * As with the global board, the date is not sent: `dublin_today()` is the single
 * home of the rollover rule, and a date computed from a skewed browser clock would
 * ask for the wrong daily either side of midnight.
 */
export async function fetchFriendsLeaderboard(): Promise<FriendsEntry[]> {
	const { data, error } = await supabaseBrowserClient().rpc('friends_leaderboard', {
		p_date: null
	});
	if (error) throw error;
	return ((data ?? []) as FriendsEntryDto[]).map(toFriendsEntry);
}
