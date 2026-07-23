/**
 * Server hooks — the Vercel-hosted edge in front of the play proxy routes.
 *
 * Its one job today is the per-IP rate limits the spec puts on `start` and
 * `submit`. It runs before the `/api/play/*` routes resolve, so a flood through the
 * proxy is turned away with a 429 before it reaches the Supabase Edge Functions.
 * `heartbeat` is deliberately unlimited — it beats every 15–30s by design.
 *
 * Scope: this is a cheap per-IP FIRST PASS on the client's own path. It counts in
 * per-instance memory, and the Edge Functions are guest-capable (`verify_jwt =
 * false`) so a direct caller skips this hook — so it is deliberately NOT the
 * authoritative limit. The durable, path-independent cap is the per-identity limit
 * enforced inside the Edge Functions themselves (`check_play_rate_limit`), which
 * a direct call cannot skip and a cold start cannot forget. This hook stays as an
 * early, no-DB rejection for proxy floods.
 *
 * The limit values come from `$lib/config`, never inline here (see rate-limit.ts).
 */

import type { Handle } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/server/rate-limit';
import type { RateLimitName } from '$lib/config';

/** Play routes that carry a per-IP limit, mapped to their config entry. */
const RATE_LIMITED: Record<string, RateLimitName> = {
	'/api/play/start': 'start',
	'/api/play/submit': 'submit'
};

export const handle: Handle = async ({ event, resolve }) => {
	const limitName = RATE_LIMITED[event.url.pathname];
	if (limitName && event.request.method === 'POST') {
		const { allowed, retryAfterMs } = checkRateLimit(limitName, event.getClientAddress());
		if (!allowed) {
			return new Response(JSON.stringify({ error: 'rate limit exceeded' }), {
				status: 429,
				headers: {
					'content-type': 'application/json',
					'retry-after': String(Math.ceil(retryAfterMs / 1000))
				}
			});
		}
	}
	return resolve(event);
};
