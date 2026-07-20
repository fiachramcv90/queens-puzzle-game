import { env } from '$env/dynamic/private';

/**
 * The `service_role` key bypasses RLS entirely, so it must never reach the
 * browser and must never be committed.
 *
 * Two things keep it out of the bundle. SvelteKit refuses to import anything
 * under `$lib/server` into client-reachable code, and `$env/dynamic/private`
 * refuses to expose variables without the `PUBLIC_` prefix. Either alone would
 * do; both together mean a mistake is a build error rather than a leak.
 *
 * It is supplied as a Vercel environment variable (server-side scope) and as a
 * GitHub Actions secret for the offline pool generator. Nothing else holds it.
 */
export function serviceRoleKey(): string {
	const key = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!key) {
		throw new Error(
			'SUPABASE_SERVICE_ROLE_KEY is not set. It is a server-side secret — see README.md.'
		);
	}

	return key;
}
