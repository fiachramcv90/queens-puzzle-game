/**
 * Sign-in, sign-out and session access — the two auth methods the MVP ships.
 *
 * Both flow through Supabase Auth: Google OAuth in one tap, and an email magic link.
 * (Apple is deferred — it needs a paid developer account and native apps are out of
 * scope.) Signing in gates leaderboards, friends and cross-device sync only; nothing
 * here is ever on the path of solo or guest play, which run with no session at all.
 *
 * These are thin wrappers over the session-persisting browser client, so a component
 * never reaches into supabase-js directly and the redirect URLs are set in one place.
 */

import type { Session } from '@supabase/supabase-js';
import { supabaseBrowserClient } from '$lib/supabase/browser';

/** Where a provider or magic-link redirect returns to. Defaults to the current page. */
function defaultRedirect(): string | undefined {
	if (typeof window === 'undefined') return undefined;
	return window.location.origin;
}

/**
 * Start Google OAuth. Redirects the tab to Google and returns to `redirectTo` (the
 * current origin by default) already signed in, where the browser client completes
 * the code exchange.
 */
export async function signInWithGoogle(redirectTo: string | undefined = defaultRedirect()) {
	const { error } = await supabaseBrowserClient().auth.signInWithOAuth({
		provider: 'google',
		options: { redirectTo }
	});
	if (error) throw error;
}

/**
 * Email a magic link. The player clicks it and returns to `redirectTo` signed in — no
 * password. `shouldCreateUser` is left on: a first-time email is a sign-up, which is
 * how a brand-new player gets an account and a profile.
 */
export async function signInWithMagicLink(
	email: string,
	redirectTo: string | undefined = defaultRedirect()
) {
	const { error } = await supabaseBrowserClient().auth.signInWithOtp({
		email,
		options: { emailRedirectTo: redirectTo }
	});
	if (error) throw error;
}

/** End the session. Solo and guest play continue unaffected. */
export async function signOut() {
	const { error } = await supabaseBrowserClient().auth.signOut();
	if (error) throw error;
}

/** The current session, or null when playing as a guest. */
export async function currentSession(): Promise<Session | null> {
	const { data } = await supabaseBrowserClient().auth.getSession();
	return data.session;
}

/**
 * Subscribe to session changes (sign-in, sign-out, token refresh). Returns an
 * unsubscribe function. This is where a caller kicks off the silent guest merge on
 * the first authenticated session.
 */
export function onSessionChange(callback: (session: Session | null) => void): () => void {
	const {
		data: { subscription }
	} = supabaseBrowserClient().auth.onAuthStateChange((_event, session) => callback(session));
	return () => subscription.unsubscribe();
}
