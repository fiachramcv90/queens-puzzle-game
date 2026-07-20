import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { heartbeat, limits, pool, rateLimits, retention, type RateLimitName } from './index';

describe('rate limits', () => {
	const names = Object.keys(rateLimits) as RateLimitName[];

	it('covers the three throttled endpoints', () => {
		expect(names.sort()).toEqual(['reveal', 'start', 'submit']);
	});

	it('permits at least one request in a window of real time', () => {
		fc.assert(
			fc.property(fc.constantFrom(...names), (name) => {
				const { limit, windowMs } = rateLimits[name];
				expect(limit).toBeGreaterThanOrEqual(1);
				expect(windowMs).toBeGreaterThan(0);
			})
		);
	});
});

describe('pool', () => {
	it('warns while there is still runway', () => {
		expect(pool.loudFailWatermarkDays).toBeLessThan(pool.horizonDays);
		expect(pool.loudFailWatermarkDays).toBeGreaterThan(0);
	});
});

describe('heartbeat', () => {
	it('allows many beats before a play goes stale', () => {
		expect(heartbeat.intervalMs).toBeLessThan(heartbeat.staleAfterMs);
	});
});

describe('retention', () => {
	it('drops move logs no later than the guest plays that carry them', () => {
		expect(retention.moveLogsDays).toBeLessThanOrEqual(retention.guestPlaysDays);
	});
});

describe('limits', () => {
	it('caps friendships generously', () => {
		expect(limits.friendsPerAccount).toBeGreaterThan(0);
	});
});
