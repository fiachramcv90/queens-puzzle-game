/**
 * The same-origin proxy in front of the play Edge Functions.
 *
 * The client calls `/api/play/start|heartbeat|submit|reveal|assist` on its own origin; this
 * forwards each to the matching Supabase Edge Function. Two reasons it exists
 * rather than the client calling Supabase directly:
 *
 *  - it puts the play requests on the Vercel edge, where the rate-limit hook can
 *    see them (see hooks.server.ts); and
 *  - same-origin means no CORS dance and no Supabase URL in the client's request
 *    path.
 *
 * It is a dumb pipe: it does not read or rewrite the body, and it does not hold the
 * service_role key — the Edge Function behind it does. It carries the publishable
 * key only so the Supabase gateway routes the call.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { publicSupabaseEnv } from '$lib/supabase/env';

/** The Edge Functions this proxy is willing to forward to. */
const ACTIONS = new Set(['start', 'heartbeat', 'submit', 'merge', 'reveal', 'assist']);

/**
 * The actions whose OWNER is the caller, so their real session token has to reach the
 * Edge Function rather than being replaced by the routing key.
 *
 * `merge` folds a guest's history onto the account the token names. `start` decides
 * whether the play it creates belongs to a user or to a guest, and that decision is
 * unrepeatable — nothing downstream re-keys a play, so a `start` that arrived without
 * the session produces a guest play for a signed-in player, permanently.
 *
 * The rest are keyed by the play TOKEN, which already carries its owner, so they have
 * no use for a session and are not given one.
 */
const SESSION_ACTIONS = new Set(['start', 'merge']);

export const POST: RequestHandler = async ({ params, request, fetch }) => {
	if (!ACTIONS.has(params.action)) {
		throw error(404, 'unknown play action');
	}

	const { url, publishableKey } = publicSupabaseEnv();
	const body = await request.text();

	// Forward the caller's own token for the session-owned actions, and the publishable
	// key for the rest. A guest sends no authorization header at all, so `start` falls
	// back to the key and stays guest-capable. apikey stays the publishable key
	// throughout: it is only how the Supabase gateway routes the call.
	const clientAuth = request.headers.get('authorization');
	const authorization =
		SESSION_ACTIONS.has(params.action) && clientAuth ? clientAuth : `Bearer ${publishableKey}`;

	const upstream = await fetch(`${url}/functions/v1/${params.action}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			apikey: publishableKey,
			authorization
		},
		body
	});

	// Pass the Edge Function's status and JSON straight back to the client.
	return new Response(await upstream.text(), {
		status: upstream.status,
		headers: { 'content-type': 'application/json' }
	});
};
