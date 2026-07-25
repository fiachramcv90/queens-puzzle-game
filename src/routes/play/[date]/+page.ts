/**
 * Load a specific daily by its Dublin date, for archive play.
 *
 * The date comes from the URL, so this is the route a hand-crafted link would hit —
 * and it is exactly as safe as the home page, because it leans on the SAME RLS
 * predicate. `puzzle_schedule` only exposes rows whose date has arrived in Dublin, so
 * a query for a FUTURE date returns nothing and the page shows "not available". There
 * is no separate future-date check to keep in step: the pre-solve vector is closed by
 * the policy, not by client code, on every route that can reach a daily.
 *
 * A past date returns its frozen daily; an unschedulable or malformed date returns
 * `daily: null`.
 */

import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { Daily } from '$lib/game/types';
import { scheduleRowToDaily, type ScheduleRow } from '$lib/game/daily-load';
import { createSupabaseClient } from '$lib/supabase/client';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const load: PageLoad = async ({ params, fetch }) => {
	if (!DATE_RE.test(params.date)) {
		throw error(404, 'not a valid daily date');
	}

	let daily: Daily | null = null;
	try {
		const supabase = createSupabaseClient(fetch);
		const { data, error: queryError } = await supabase
			.from('puzzle_schedule')
			.select('date, puzzles(id, board_size, region_map, tier)')
			.eq('date', params.date)
			.maybeSingle<ScheduleRow>();

		if (!queryError && data) daily = scheduleRowToDaily(data);
	} catch {
		daily = null;
	}

	return { daily, requestedDate: params.date };
};
