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
import type { DifficultyTier, RegionMap } from '$lib/solver';
import type { Daily } from '$lib/game/types';
import { createSupabaseClient } from '$lib/supabase/client';

/** The shape the schedule→puzzle join comes back as (no generated types yet). */
interface ScheduleRow {
	date: string;
	puzzles: {
		id: string;
		board_size: number;
		// jsonb, so normally a parsed array — but tolerated as a JSON string too, so
		// a double-encoded column value can't take the board down. See asRegionMap.
		region_map: RegionMap | string;
		tier: DifficultyTier;
	} | null;
}

/**
 * The DB→domain boundary for the region map. jsonb should arrive already parsed,
 * but a value stored as a JSON string is parsed here rather than trusted to be an
 * array — the anti-corruption layer that keeps a storage quirk out of the game.
 */
function asRegionMap(value: RegionMap | string): RegionMap {
	return typeof value === 'string' ? (JSON.parse(value) as RegionMap) : value;
}

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

		if (!error && data?.puzzles) {
			daily = {
				id: data.puzzles.id,
				date: data.date,
				boardSize: data.puzzles.board_size,
				tier: data.puzzles.tier,
				regionMap: asRegionMap(data.puzzles.region_map)
			};
		}
	} catch {
		daily = null;
	}

	return { daily };
};
