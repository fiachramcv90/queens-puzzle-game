/**
 * The signed-in player's profile: reading it, editing the display name, confirming it
 * once, and keeping prefs in step across devices.
 *
 * The pure rules here — when the one-time name prompt fires, and how guest prefs map
 * to profile columns — are separated from the Supabase I/O so they can be unit-tested
 * without a client. The reads and writes go through the session-persisting browser
 * client under RLS: a player only ever sees or edits their own row.
 */

import { supabaseBrowserClient } from '$lib/supabase/browser';
import type { GuestPrefs } from '$lib/game/types';

/** The profile row as the client uses it (camelCase over the snake_case columns). */
export interface Profile {
	readonly id: string;
	readonly displayName: string;
	/** True once the player has confirmed the seeded name on their first social action. */
	readonly nameConfirmed: boolean;
	/** Unique, regenerable. Minted by the friends feature (#30); null until then. */
	readonly friendCode: string | null;
	readonly currentStreak: number;
	readonly longestStreak: number;
	readonly lastStreakDate: string | null;
	readonly palette: string;
	readonly regionLabels: boolean;
	readonly autoMarkX: boolean;
}

/**
 * Where the player is when we consider prompting for the name. `social` is opening
 * friends or the leaderboard — the only places the one-time confirm may appear.
 * `play` is solo or guest play, where it must NEVER appear.
 */
export type NameConfirmContext = 'social' | 'play';

/**
 * Whether to show the one-time display-name confirm/edit prompt. Only for a signed-in
 * player whose seeded name is still unconfirmed, and only on a social action — never
 * during play, and never for a guest (who has no profile).
 */
export function shouldPromptNameConfirm(
	profile: Profile | null,
	context: NameConfirmContext
): boolean {
	return profile !== null && !profile.nameConfirmed && context === 'social';
}

/** Project the pref-bearing columns of a profile into the client's `GuestPrefs` shape. */
export function profileToPrefs(profile: Profile): GuestPrefs {
	return {
		palette: profile.palette,
		regionLabels: profile.regionLabels,
		autoMarkX: profile.autoMarkX
	};
}

/** The pref columns of the profiles table, as an update payload. */
interface PrefColumns {
	palette?: string;
	region_labels?: boolean;
	auto_mark_x?: boolean;
}

/**
 * Map guest prefs to profile columns for an update, including only the fields the
 * guest actually set. Omitting the rest means a sync-up never overwrites a value the
 * player has on another device with a local default they never chose.
 */
export function prefsToColumns(prefs: GuestPrefs): PrefColumns {
	const columns: PrefColumns = {};
	if (prefs.palette !== undefined) columns.palette = prefs.palette;
	if (prefs.regionLabels !== undefined) columns.region_labels = prefs.regionLabels;
	if (prefs.autoMarkX !== undefined) columns.auto_mark_x = prefs.autoMarkX;
	return columns;
}

/** The raw profiles row, as Supabase returns it. */
interface ProfileRow {
	id: string;
	display_name: string;
	name_confirmed: boolean;
	friend_code: string | null;
	current_streak: number;
	longest_streak: number;
	last_streak_date: string | null;
	palette: string;
	region_labels: boolean;
	auto_mark_x: boolean;
}

function rowToProfile(row: ProfileRow): Profile {
	return {
		id: row.id,
		displayName: row.display_name,
		nameConfirmed: row.name_confirmed,
		friendCode: row.friend_code,
		currentStreak: row.current_streak,
		longestStreak: row.longest_streak,
		lastStreakDate: row.last_streak_date,
		palette: row.palette,
		regionLabels: row.region_labels,
		autoMarkX: row.auto_mark_x
	};
}

/** Read the signed-in player's own profile (RLS select-own), or null if not signed in. */
export async function fetchProfile(): Promise<Profile | null> {
	const { data, error } = await supabaseBrowserClient()
		.from('profiles')
		.select(
			'id, display_name, name_confirmed, friend_code, current_streak, longest_streak, last_streak_date, palette, region_labels, auto_mark_x'
		)
		.maybeSingle();
	if (error) throw error;
	return data ? rowToProfile(data as ProfileRow) : null;
}

/**
 * Confirm (and optionally edit) the display name — the one-time action that dismisses
 * the prompt for good. Sets name_confirmed true so it never appears again.
 */
export async function confirmDisplayName(displayName: string): Promise<void> {
	const trimmed = displayName.trim();
	const { error } = await supabaseBrowserClient()
		.from('profiles')
		.update({ display_name: trimmed, name_confirmed: true })
		.select('id')
		.single();
	if (error) throw error;
}

/**
 * Push local prefs up to the profile so they follow the player across devices. A
 * no-op when the guest set nothing. Called once a session is established.
 */
export async function syncPrefsToProfile(prefs: GuestPrefs): Promise<void> {
	const columns = prefsToColumns(prefs);
	if (Object.keys(columns).length === 0) return;
	const { error } = await supabaseBrowserClient()
		.from('profiles')
		.update(columns)
		.select('id')
		.single();
	if (error) throw error;
}
