import { env } from '$env/dynamic/public';

/**
 * The Supabase values the browser is allowed to hold.
 *
 * The anon key is public by design — it grants nothing on its own, because every
 * table is protected by RLS. The `service_role` key is the opposite of this and
 * lives in `$lib/server` only; see `src/lib/server/supabase-env.ts`.
 */
export interface PublicSupabaseEnv {
	url: string;
	anonKey: string;
}

export function publicSupabaseEnv(): PublicSupabaseEnv {
	const url = env.PUBLIC_SUPABASE_URL;
	const anonKey = env.PUBLIC_SUPABASE_ANON_KEY;

	if (!url || !anonKey) {
		throw new Error(
			'PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY must be set. Copy .env.example to .env — see README.md.'
		);
	}

	return { url, anonKey };
}
