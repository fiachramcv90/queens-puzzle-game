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

	it('gives the generator room to reject-sample and to dodge a hash collision', () => {
		expect(pool.tierAttemptsPerDate).toBeGreaterThan(1);
		expect(pool.boardAttemptsPerDate).toBeGreaterThan(1);
	});

	it('looks harder for a rare tier than for the common ones', () => {
		// The override exists because a depth-0 board is roughly a one-in-a-hundred draw
		// (#52); a budget at or below the shared one would defeat the point of having it.
		for (const attempts of Object.values(pool.tierAttemptsByTier)) {
			expect(attempts).toBeGreaterThan(pool.tierAttemptsPerDate);
		}
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
