import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	DIFFICULTY_TIERS,
	scoreDifficulty,
	tierForScore,
	type DifficultySignals
} from './difficulty';

const baseSignals: DifficultySignals = {
	forcedDeductionDepth: 0,
	size: 7,
	regionSizeVariance: 0,
	regionPerimeterAreaRatio: 0,
	regionRowColSpan: 0,
	solverNodes: 0,
	solverBacktracks: 0
};

/** fast-check arbitrary over the whole signal space at valid board sizes. */
const signalArb = (): fc.Arbitrary<DifficultySignals> =>
	fc.record({
		forcedDeductionDepth: fc.integer({ min: 0, max: 6 }),
		size: fc.integer({ min: 7, max: 11 }),
		regionSizeVariance: fc.double({ min: 0, max: 20, noNaN: true }),
		regionPerimeterAreaRatio: fc.double({ min: 0, max: 6, noNaN: true }),
		regionRowColSpan: fc.double({ min: 0, max: 22, noNaN: true }),
		solverNodes: fc.integer({ min: 0, max: 5000 }),
		solverBacktracks: fc.integer({ min: 0, max: 5000 })
	});

describe('scoreDifficulty', () => {
	it('echoes the signals it was given', () => {
		const signals = { ...baseSignals, forcedDeductionDepth: 2 };
		expect(scoreDifficulty(signals).signals).toEqual(signals);
	});

	it('is deterministic — the same signals score identically', () => {
		fc.assert(
			fc.property(signalArb(), (signals) => {
				expect(scoreDifficulty(signals).score).toBe(scoreDifficulty(signals).score);
			})
		);
	});

	it('returns a tier consistent with the standalone tierForScore', () => {
		fc.assert(
			fc.property(signalArb(), (signals) => {
				const { score, tier } = scoreDifficulty(signals);
				expect(tier).toBe(tierForScore(score));
			})
		);
	});

	it('bottoms out at Intro for the minimal board', () => {
		const { score, tier } = scoreDifficulty(baseSignals);
		expect(score).toBe(0);
		expect(tier).toBe('Intro');
	});

	it('makes forced-deduction depth the dominant term', () => {
		// One extra level of depth must outweigh maxing out every other signal.
		const shallowButExtreme = scoreDifficulty({
			forcedDeductionDepth: 0,
			size: 11,
			regionSizeVariance: 1000,
			regionPerimeterAreaRatio: 1000,
			regionRowColSpan: 1000,
			solverNodes: 1_000_000,
			solverBacktracks: 1_000_000
		});
		const deepButPlain = scoreDifficulty({ ...baseSignals, forcedDeductionDepth: 3 });
		expect(deepButPlain.score).toBeGreaterThan(shallowButExtreme.score);
	});

	describe('monotonicity — raising any one signal never lowers the score', () => {
		const bump: Record<keyof DifficultySignals, number> = {
			forcedDeductionDepth: 1,
			size: 1,
			regionSizeVariance: 1,
			regionPerimeterAreaRatio: 0.5,
			regionRowColSpan: 1,
			solverNodes: 10,
			solverBacktracks: 10
		};

		for (const key of Object.keys(bump) as (keyof DifficultySignals)[]) {
			it(`is non-decreasing in ${key}`, () => {
				fc.assert(
					fc.property(signalArb(), (signals) => {
						// Keep size within its valid range so the comparison stays meaningful.
						if (key === 'size' && signals.size >= 11) return;
						const raised = { ...signals, [key]: signals[key] + bump[key] };
						expect(scoreDifficulty(raised).score).toBeGreaterThanOrEqual(
							scoreDifficulty(signals).score
						);
					})
				);
			});
		}
	});
});

describe('tierForScore', () => {
	it('is monotone in the score', () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 200, noNaN: true }),
				fc.double({ min: 0, max: 200, noNaN: true }),
				(a, b) => {
					const [lo, hi] = a <= b ? [a, b] : [b, a];
					const rank = (t: (typeof DIFFICULTY_TIERS)[number]) => DIFFICULTY_TIERS.indexOf(t);
					expect(rank(tierForScore(hi))).toBeGreaterThanOrEqual(rank(tierForScore(lo)));
				}
			)
		);
	});

	it('covers every tier across the score range', () => {
		const seen = new Set(Array.from({ length: 200 }, (_, s) => tierForScore(s)));
		for (const tier of DIFFICULTY_TIERS) expect(seen).toContain(tier);
	});
});
