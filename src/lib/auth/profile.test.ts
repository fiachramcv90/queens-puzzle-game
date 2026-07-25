import { describe, expect, test } from 'vitest';
import { shouldPromptNameConfirm, profileToPrefs, prefsToColumns, type Profile } from './profile';

function profile(overrides: Partial<Profile> = {}): Profile {
	return {
		id: 'u1',
		displayName: 'Sam',
		nameConfirmed: false,
		friendCode: null,
		currentStreak: 0,
		longestStreak: 0,
		lastStreakDate: null,
		palette: 'classic',
		regionLabels: false,
		autoMarkX: false,
		...overrides
	};
}

describe('shouldPromptNameConfirm — the one-time confirm gate', () => {
	test('prompts on a social action when the name is unconfirmed', () => {
		expect(shouldPromptNameConfirm(profile({ nameConfirmed: false }), 'social')).toBe(true);
	});

	test('never during solo or guest play, even when unconfirmed', () => {
		expect(shouldPromptNameConfirm(profile({ nameConfirmed: false }), 'play')).toBe(false);
	});

	test('does not prompt once the name has been confirmed', () => {
		expect(shouldPromptNameConfirm(profile({ nameConfirmed: true }), 'social')).toBe(false);
	});

	test('a guest (no profile) is never prompted', () => {
		expect(shouldPromptNameConfirm(null, 'social')).toBe(false);
	});
});

describe('prefs mapping — the profile is the cross-device source once signed in', () => {
	test('profileToPrefs projects only the pref columns', () => {
		const p = profile({ palette: 'high-contrast', regionLabels: true, autoMarkX: true });
		expect(profileToPrefs(p)).toEqual({
			palette: 'high-contrast',
			regionLabels: true,
			autoMarkX: true
		});
	});

	test('prefsToColumns maps a full set of guest prefs to profile columns', () => {
		expect(
			prefsToColumns({ palette: 'high-contrast', regionLabels: true, autoMarkX: false })
		).toEqual({ palette: 'high-contrast', region_labels: true, auto_mark_x: false });
	});

	test('prefsToColumns omits fields the guest never set, so a sync never clobbers with a default', () => {
		expect(prefsToColumns({ autoMarkX: true })).toEqual({ auto_mark_x: true });
		expect(prefsToColumns({})).toEqual({});
	});
});
