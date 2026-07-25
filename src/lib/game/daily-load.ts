/**
 * The DB→domain boundary for a daily loaded from `puzzle_schedule`.
 *
 * Three routes read a daily from the same schedule→puzzle join — today's board, a
 * specific archive date, and the archive list — so the join shape, the anti-corruption
 * region-map parse, and the row→{@link Daily} mapping live here once rather than being
 * copied per route. Each loader still owns its own query (latest, by-date, or the whole
 * list); only the shape and the mapping are shared.
 */

import type { DifficultyTier, RegionMap } from '$lib/solver';
import type { Daily } from './types';

/** The shape the schedule→puzzle join comes back as (no generated types yet). */
export interface ScheduleRow {
	date: string;
	puzzles: {
		id: string;
		board_size: number;
		// jsonb, so normally a parsed array — but tolerated as a JSON string too, so a
		// double-encoded column value can't take the board down. See asRegionMap.
		region_map: RegionMap | string;
		tier: DifficultyTier;
	} | null;
}

/**
 * The DB→domain boundary for the region map. jsonb should arrive already parsed, but a
 * value stored as a JSON string is parsed here rather than trusted to be an array — the
 * anti-corruption layer that keeps a storage quirk out of the game.
 */
export function asRegionMap(value: RegionMap | string): RegionMap {
	return typeof value === 'string' ? (JSON.parse(value) as RegionMap) : value;
}

/** Map a joined schedule row to a {@link Daily}, or null when the puzzle side is absent. */
export function scheduleRowToDaily(row: ScheduleRow): Daily | null {
	if (!row.puzzles) return null;
	return {
		id: row.puzzles.id,
		date: row.date,
		boardSize: row.puzzles.board_size,
		tier: row.puzzles.tier,
		regionMap: asRegionMap(row.puzzles.region_map)
	};
}
