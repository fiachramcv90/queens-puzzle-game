/**
 * A tiny seedable pseudo-random number generator, so generation is
 * reproducible: the same seed replays the exact same board. That is what lets a
 * property-test seed that trips an invariant be handed straight back to
 * {@link generate} to reproduce the failure (see the MVP build spec, issue #18).
 *
 * `Math.random` is deliberately *not* used anywhere in the generator — it cannot
 * be seeded, so a failing case could never be replayed. This module is the one
 * source of randomness the solver core draws from.
 *
 * The algorithm is mulberry32: a fast 32-bit generator that is more than good
 * enough to shuffle candidate columns and steer region growth. It is not
 * cryptographic and is never used where that matters.
 */

/** A seeded stream of floats in `[0, 1)`. Deterministic given its seed. */
export type Rng = () => number;

/** Build an {@link Rng} from a 32-bit integer seed. The same seed replays. */
export function makeRng(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A random integer in `[0, n)`. `n` must be a positive integer. */
export function randInt(rng: Rng, n: number): number {
	return Math.floor(rng() * n);
}

/**
 * The Fisher–Yates shuffle of `0 .. n-1`, drawing from `rng`. Returns a fresh
 * array; does not mutate anything the caller holds.
 */
export function shuffledRange(rng: Rng, n: number): number[] {
	const out = Array.from({ length: n }, (_, i) => i);
	for (let i = n - 1; i > 0; i--) {
		const j = randInt(rng, i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
