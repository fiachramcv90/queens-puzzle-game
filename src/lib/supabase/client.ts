/**
 * The Supabase Data API client for guest reads.
 *
 * It carries only the publishable key, so it grants nothing on its own — every
 * table is protected by RLS (see `src/lib/server/supabase-env.ts` for the secret
 * key's separate, server-only path). A guest reading today's daily needs no
 * session, so auth persistence is off.
 *
 * The client accepts a `fetch` so a SvelteKit `load` can pass its instrumented
 * one (for SSR and dedup); it defaults to the platform `fetch` elsewhere.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicSupabaseEnv } from './env';

export function createSupabaseClient(fetchImpl: typeof fetch = fetch): SupabaseClient {
	const { url, publishableKey } = publicSupabaseEnv();
	return createClient(url, publishableKey, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: { fetch: fetchImpl }
	});
}
