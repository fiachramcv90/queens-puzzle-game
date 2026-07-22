// The service_role Supabase client the play-lifecycle functions use. service_role
// bypasses RLS, so this is the only write path to `plays` — and it must never leave
// the server. The edge runtime injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// into every function's environment, so nothing here is configured by hand.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function adminClient(): SupabaseClient {
	const url = Deno.env.get('SUPABASE_URL');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	if (!url || !serviceRoleKey) {
		throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the function env');
	}
	return createClient(url, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
}
