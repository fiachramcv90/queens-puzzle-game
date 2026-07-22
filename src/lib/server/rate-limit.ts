/**
 * A per-IP fixed-window rate limiter for the play endpoints.
 *
 * The limits themselves live in `$lib/config` — they are guesses until there is
 * real traffic, so the spec keeps them as config, not code, and this module only
 * enforces whatever config says. It runs in the SvelteKit server hook in front of
 * the `/api/play/*` proxy routes, which is the Vercel-hosted edge the spec means
 * by "Vercel middleware".
 *
 * The window is a simple in-memory fixed window. That is per-instance state, so
 * across several serverless instances the effective limit is looser than the
 * nominal one — acceptable for a casual-tampering backstop whose numbers are
 * admittedly guesses. A shared store (KV/Redis) is the upgrade when the numbers
 * start to matter.
 */

import { rateLimits, type RateLimitName } from '$lib/config';

interface Window {
	count: number;
	/** Epoch ms at which this window expires and the count resets. */
	resetAt: number;
}

/** Keyed by `name:ip`. Module-level so it survives across requests in one instance. */
const windows = new Map<string, Window>();

export interface RateLimitResult {
	readonly allowed: boolean;
	/** Milliseconds until the window resets; 0 when allowed. */
	readonly retryAfterMs: number;
}

/**
 * Record one request against `(name, ip)` and say whether it is allowed. The
 * budget and window come from `rateLimits[name]`. A request is allowed until the
 * configured `limit` is reached within `windowMs`, after which it is blocked until
 * the window rolls over.
 */
export function checkRateLimit(
	name: RateLimitName,
	ip: string,
	now: number = Date.now()
): RateLimitResult {
	const { limit, windowMs } = rateLimits[name];
	const key = `${name}:${ip}`;
	const existing = windows.get(key);

	if (!existing || now >= existing.resetAt) {
		windows.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true, retryAfterMs: 0 };
	}

	if (existing.count >= limit) {
		return { allowed: false, retryAfterMs: existing.resetAt - now };
	}

	existing.count += 1;
	return { allowed: true, retryAfterMs: 0 };
}

/** Clear all windows. For tests only. */
export function __resetRateLimits(): void {
	windows.clear();
}
