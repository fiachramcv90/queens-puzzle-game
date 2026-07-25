/**
 * The reactive auth state the UI binds to, and the place the silent guest merge is
 * triggered.
 *
 * On the first authenticated session after guest play it runs the merge — once,
 * idempotently, retrying on a later load if it fails — then pulls the player's profile
 * and pushes any local prefs up so they follow across devices. None of this gates
 * play: a guest with no session sees an unchanged board.
 *
 * Browser-only (it owns a Supabase auth subscription and touches localStorage), so it
 * is constructed and `start()`ed from a component's onMount, never during SSR.
 */

import type { Session } from '@supabase/supabase-js';
import { currentSession, onSessionChange } from './session';
import { fetchProfile, profileToPrefs, syncPrefsToProfile, type Profile } from './profile';
import { syncGuestMerge } from './merge';
import { mergeGuestPlays } from './merge-client';
import { loadBlob, writePrefs } from '$lib/game/persistence';

export class AuthState {
	/** The live session, or null while playing as a guest. */
	session: Session | null = $state(null);
	/** The signed-in player's profile, loaded after sign-in. Null when a guest. */
	profile: Profile | null = $state(null);

	/** True once signed in — what a "sign in / sign out" control reads. */
	readonly signedIn: boolean = $derived(this.session !== null);

	private stop: (() => void) | null = null;

	/**
	 * Begin tracking the session. Reacts to sign-in/out for the tab's lifetime and
	 * returns a teardown to call from onDestroy. Safe to await; the initial session is
	 * resolved before it returns.
	 */
	async start(): Promise<() => void> {
		this.session = await currentSession();
		await this.onSession(this.session);

		this.stop = onSessionChange((session) => {
			this.session = session;
			void this.onSession(session);
		});
		return () => this.stop?.();
	}

	/** React to a session becoming present or absent. */
	private async onSession(session: Session | null): Promise<void> {
		if (!session) {
			this.profile = null;
			return;
		}

		// Silently fold this guest's server history onto the account, at most once. The
		// outcome tells us whether this is the FIRST authenticated session after guest
		// play, which is the only moment we seed the guest's local prefs UP to the new
		// profile — "signing in feels like continuing". On every later session we do the
		// opposite (below): the profile is authoritative, so its prefs are pulled down.
		const outcome = await syncGuestMerge(
			localStorage,
			{ accessToken: session.access_token },
			(guestId, token) => mergeGuestPlays(guestId, token).then(() => undefined)
		);
		if (outcome === 'merged') {
			const blob = loadBlob(localStorage);
			if (blob?.prefs && Object.keys(blob.prefs).length > 0) {
				await syncPrefsToProfile(blob.prefs);
			}
		}

		// The profile is the source of truth for prefs once signed in. Pull them down
		// onto this device so palette and label settings follow the player across
		// devices, rather than the local blob overwriting the account on every load.
		this.profile = await fetchProfile();
		if (this.profile) {
			writePrefs(localStorage, profileToPrefs(this.profile));
		}
	}
}
