import { env } from '$env/dynamic/public';

/**
 * The Supabase values the browser is allowed to hold.
 *
 * The publishable key is public by design — it grants nothing on its own,
 * because every table is protected by RLS. The secret key is the opposite of
 * this and lives in `$lib/server` only; see `src/lib/server/supabase-env.ts`.
 *
 * (Supabase used to call these the anon key and the `service_role` key. Same two
 * roles, current names.)
 */
export interface PublicSupabaseEnv {
	url: string;
	publishableKey: string;
}

export function publicSupabaseEnv(): PublicSupabaseEnv {
	const url = env.PUBLIC_SUPABASE_URL;
	const publishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

	if (!url || !publishableKey) {
		throw new Error(
			'PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set. Copy .env.example to .env — see README.md.'
		);
	}

	return { url, publishableKey };
}
