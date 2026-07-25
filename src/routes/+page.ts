/**
 * Load today's daily for the guest board.
 *
 * The query leans entirely on RLS to pick the right row: `puzzle_schedule` only
 * exposes rows whose date has arrived in Europe/Dublin, so the most-recent visible
 * schedule row IS today's daily (or the latest past one if today is somehow
 * unscheduled). No date arithmetic on the client, and tomorrow's board stays
 * invisible — the pre-solve attack the schedule policy closes.
 *
 * A failure here (unconfigured env, or the network down) returns `daily: null`
 * rather than throwing: the page then falls back to the cached snapshot in
 * localStorage, so a returning player keeps solving offline.
 */

import type { PageLoad } from './$types';
import type { Daily } from '$lib/game/types';
import { scheduleRowToDaily, type ScheduleRow } from '$lib/game/daily-load';
import { createSupabaseClient } from '$lib/supabase/client';

export const load: PageLoad = async ({ fetch }) => {
	let daily: Daily | null = null;

	try {
		const supabase = createSupabaseClient(fetch);
		const { data, error } = await supabase
			.from('puzzle_schedule')
			.select('date, puzzles(id, board_size, region_map, tier)')
			.order('date', { ascending: false })
			.limit(1)
			.maybeSingle<ScheduleRow>();

		if (!error && data) daily = scheduleRowToDaily(data);
	} catch {
		daily = null;
	}

	return { daily };
};
