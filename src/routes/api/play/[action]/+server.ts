/**
 * The same-origin proxy in front of the play Edge Functions.
 *
 * The client calls `/api/play/start|heartbeat|submit` on its own origin; this
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
const ACTIONS = new Set(['start', 'heartbeat', 'submit']);

export const POST: RequestHandler = async ({ params, request, fetch }) => {
	if (!ACTIONS.has(params.action)) {
		throw error(404, 'unknown play action');
	}

	const { url, publishableKey } = publicSupabaseEnv();
	const body = await request.text();

	const upstream = await fetch(`${url}/functions/v1/${params.action}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			apikey: publishableKey,
			authorization: `Bearer ${publishableKey}`
		},
		body
	});

	// Pass the Edge Function's status and JSON straight back to the client.
	return new Response(await upstream.text(), {
		status: upstream.status,
		headers: { 'content-type': 'application/json' }
	});
};
