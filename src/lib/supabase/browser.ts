/**
 * The browser's session-persisting Supabase client.
 *
 * Distinct from `createSupabaseClient` in `client.ts`, which is the stateless
 * publishable-key client a guest uses to read the daily. Auth needs the opposite: a
 * single long-lived client that persists the session, refreshes tokens, and completes
 * the OAuth / magic-link redirect on load. It carries only the publishable key — RLS
 * is what protects every table — so holding it in the browser grants nothing on its
 * own.
 *
 * A module-level singleton: one client owns the session and its `onAuthStateChange`
 * subscribers for the tab's lifetime. It is created lazily and only in the browser, so
 * importing this module during SSR does not touch `localStorage`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { browser } from '$app/environment';
import { publicSupabaseEnv } from './env';

let client: SupabaseClient | null = null;

export function supabaseBrowserClient(): SupabaseClient {
	if (!browser) {
		throw new Error('supabaseBrowserClient() is browser-only; guard callers with `browser`.');
	}
	if (client) return client;

	const { url, publishableKey } = publicSupabaseEnv();
	client = createClient(url, publishableKey, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			// Complete the code exchange on the redirect back from Google or the magic
			// link, so a returning tab lands already signed in.
			detectSessionInUrl: true,
			flowType: 'pkce'
		}
	});
	return client;
}
