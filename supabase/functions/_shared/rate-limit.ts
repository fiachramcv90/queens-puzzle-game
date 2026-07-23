// Per-identity rate limiting for the play Edge Functions.
//
// This is the authoritative cap the spec puts on `start` and `submit`. Unlike the
// SvelteKit proxy hook — which only sees traffic on the client's own path and
// counts in per-instance memory — this runs INSIDE the function, so a caller who
// hits the Edge Function directly cannot skip it, and the counter is durable in
// Postgres across serverless cold starts. It closes both gaps hooks.server.ts
// flagged as follow-ups.
//
// The budget and window come from the config bundle (rateLimits) — the numbers
// live in src/lib/config, never inline here — and the atomic check lives in the
// check_play_rate_limit SECURITY DEFINER function this calls as service_role.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { rateLimits } from './config.bundle.js';
import { json } from './http.ts';

/** The actions that carry a per-identity cap. `heartbeat` is unlimited by design. */
export type LimitedAction = 'start' | 'submit';

/**
 * Charge one request against `(action, identity)` and, if it is over the configured
 * cap, return a ready-to-send 429 Response with a `retry-after` header. Returns null
 * when the request is within budget, so callers guard with `if (limited) return limited;`.
 *
 * On any RPC error the request is allowed through (fail-open): a rate limiter must
 * never be the reason a real solve cannot be recorded.
 */
export async function enforceRateLimit(
	admin: SupabaseClient,
	action: LimitedAction,
	identity: string
): Promise<Response | null> {
	const { limit, windowMs } = rateLimits[action];

	const { data, error } = await admin.rpc('check_play_rate_limit', {
		p_action: action,
		p_identity: identity,
		p_limit: limit,
		p_window_ms: windowMs
	});
	if (error) {
		console.error('check_play_rate_limit failed', error);
		return null;
	}

	const result = (Array.isArray(data) ? data[0] : data) as
		{ allowed: boolean; retry_after_ms: number } | undefined;
	if (!result || result.allowed) return null;

	const retryAfterSeconds = Math.ceil(Number(result.retry_after_ms) / 1000);
	const response = json({ error: 'rate limit exceeded' }, 429);
	response.headers.set('retry-after', String(retryAfterSeconds));
	return response;
}
