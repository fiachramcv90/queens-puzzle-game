/**
 * Load the archive: every past daily that is playable now.
 *
 * This is the whole archive falling out of one predicate — `puzzle_schedule` under RLS
 * exposes exactly the rows whose date has arrived in Dublin, so selecting the schedule
 * ordered by date descending IS the archive (today's daily first, back to launch).
 * A future daily has no visible row, so it can never appear here or be linked to.
 *
 * No date arithmetic on the client and no separate visibility rule: the same
 * `date <= dublin_today()` policy that closes the pre-solve vector delivers the list.
 */

import type { PageLoad } from './$types';
import type { DifficultyTier } from '$lib/solver';
import { createSupabaseClient } from '$lib/supabase/client';

/** One row of the archive list — a past (or current) daily's date and its display facts. */
export interface ArchiveDaily {
	readonly date: string;
	readonly boardSize: number;
	readonly tier: DifficultyTier;
}

interface ScheduleRow {
	date: string;
	puzzles: {
		board_size: number;
		tier: DifficultyTier;
	} | null;
}

export const load: PageLoad = async ({ fetch }) => {
	let dailies: ArchiveDaily[] = [];
	try {
		const supabase = createSupabaseClient(fetch);
		const { data, error } = await supabase
			.from('puzzle_schedule')
			.select('date, puzzles(board_size, tier)')
			.order('date', { ascending: false });

		if (!error && data) {
			// The join's inferred type models `puzzles` as an array; the FK makes it 0-or-1.
			// Cast through unknown as the single-row loaders do, then narrow on null.
			dailies = (data as unknown as ScheduleRow[])
				.filter(
					(row): row is ScheduleRow & { puzzles: NonNullable<ScheduleRow['puzzles']> } =>
						row.puzzles !== null
				)
				.map((row) => ({
					date: row.date,
					boardSize: row.puzzles.board_size,
					tier: row.puzzles.tier
				}));
		}
	} catch {
		dailies = [];
	}

	return { dailies };
};
