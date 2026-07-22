import { afterEach, describe, expect, test } from 'vitest';
import { rateLimits } from '$lib/config';
import { __resetRateLimits, checkRateLimit } from './rate-limit';

/**
 * The per-IP fixed-window limiter behind the play endpoints. The numbers it
 * enforces come entirely from `$lib/config` (rate limits are guesses until there
 * is traffic, so they are config, not code) — these tests read the same config so
 * a re-tune never silently breaks them.
 */

afterEach(() => __resetRateLimits());

const START_LIMIT = rateLimits.start.limit;

describe('fixed-window per-IP limiting', () => {
	test('allows up to the configured limit, then blocks', () => {
		const now = 1_000_000;
		for (let i = 0; i < START_LIMIT; i++) {
			expect(checkRateLimit('start', '1.2.3.4', now).allowed).toBe(true);
		}
		const blocked = checkRateLimit('start', '1.2.3.4', now);
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterMs).toBeGreaterThan(0);
	});

	test('a different IP has its own budget', () => {
		const now = 1_000_000;
		for (let i = 0; i < START_LIMIT; i++) checkRateLimit('start', 'a', now);
		expect(checkRateLimit('start', 'a', now).allowed).toBe(false);
		expect(checkRateLimit('start', 'b', now).allowed).toBe(true);
	});

	test('the window resets once it has elapsed', () => {
		const now = 1_000_000;
		for (let i = 0; i < START_LIMIT; i++) checkRateLimit('start', 'x', now);
		expect(checkRateLimit('start', 'x', now).allowed).toBe(false);
		const later = now + rateLimits.start.windowMs;
		expect(checkRateLimit('start', 'x', later).allowed).toBe(true);
	});

	test('start and submit are independent budgets', () => {
		const now = 1_000_000;
		for (let i = 0; i < START_LIMIT; i++) checkRateLimit('start', 'ip', now);
		expect(checkRateLimit('start', 'ip', now).allowed).toBe(false);
		// submit has its own, larger budget and is untouched.
		expect(checkRateLimit('submit', 'ip', now).allowed).toBe(true);
	});
});
