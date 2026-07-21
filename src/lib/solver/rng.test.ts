import { describe, expect, it } from 'vitest';
import { makeRng, randInt, shuffledRange } from './rng';

describe('makeRng', () => {
	it('replays the same stream for the same seed', () => {
		const a = makeRng(42);
		const b = makeRng(42);
		const streamA = Array.from({ length: 10 }, () => a());
		const streamB = Array.from({ length: 10 }, () => b());
		expect(streamA).toEqual(streamB);
	});

	it('produces different streams for different seeds', () => {
		const a = makeRng(1);
		const b = makeRng(2);
		expect(a()).not.toBe(b());
	});

	it('stays within [0, 1)', () => {
		const rng = makeRng(7);
		for (let i = 0; i < 1000; i++) {
			const x = rng();
			expect(x).toBeGreaterThanOrEqual(0);
			expect(x).toBeLessThan(1);
		}
	});
});

describe('randInt', () => {
	it('stays within [0, n)', () => {
		const rng = makeRng(99);
		for (let i = 0; i < 1000; i++) {
			const x = randInt(rng, 5);
			expect(x).toBeGreaterThanOrEqual(0);
			expect(x).toBeLessThan(5);
			expect(Number.isInteger(x)).toBe(true);
		}
	});
});

describe('shuffledRange', () => {
	it('is a permutation of 0..n-1', () => {
		const shuffled = shuffledRange(makeRng(3), 8);
		expect([...shuffled].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
	});

	it('replays for the same seed', () => {
		expect(shuffledRange(makeRng(5), 12)).toEqual(shuffledRange(makeRng(5), 12));
	});
});
