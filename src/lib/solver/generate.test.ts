import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { generate, generatePuzzle, type GeneratedPuzzle } from './generate';
import { checkRules } from './check-rules';
import { countSolutions } from './count-solutions';
import { boardWithQueens } from './test-fixtures';
import { DIFFICULTY_TIERS } from './difficulty';
import type { Cell, RegionMap } from './types';

const SIZES = [7, 8, 9, 10, 11] as const;

/** Every region is 4-connected (orthogonally contiguous). */
function regionsAreContiguous(regionMap: RegionMap): boolean {
	const size = regionMap.length;
	const byRegion = new Map<number, Cell[]>();
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			const id = regionMap[row][col];
			let list = byRegion.get(id);
			if (!list) byRegion.set(id, (list = []));
			list.push({ row, col });
		}
	}
	for (const cells of byRegion.values()) {
		const key = (c: Cell) => `${c.row},${c.col}`;
		const all = new Set(cells.map(key));
		const seen = new Set<string>([key(cells[0])]);
		const stack = [cells[0]];
		while (stack.length) {
			const { row, col } = stack.pop()!;
			for (const [dr, dc] of [
				[-1, 0],
				[1, 0],
				[0, -1],
				[0, 1]
			]) {
				const n = { row: row + dr, col: col + dc };
				const k = key(n);
				if (all.has(k) && !seen.has(k)) {
					seen.add(k);
					stack.push(n);
				}
			}
		}
		if (seen.size !== cells.length) return false;
	}
	return true;
}

/** Assert every invariant the whole product rests on, for a generated puzzle. */
function expectValidPuzzle(puzzle: GeneratedPuzzle, size: number): void {
	const { regionMap } = puzzle.public;
	const { solution } = puzzle.secret;

	// N contiguous regions, ids 0..N-1.
	const regionIds = new Set<number>();
	for (const row of regionMap) for (const id of row) regionIds.add(id);
	expect(regionIds.size).toBe(size);
	expect(regionsAreContiguous(regionMap)).toBe(true);

	// Exactly one queen per row, column and region, and no king-adjacency: the
	// solution is a legal, complete board.
	const board = boardWithQueens(size, [...solution]);
	const check = checkRules(board, regionMap);
	expect(check.solved).toBe(true);
	expect(solution).toHaveLength(size);

	// Exactly one solution — the invariant the product rests on.
	expect(countSolutions(regionMap, 2)).toBe(1);

	// The public half never carries the answer.
	expect(puzzle.public).not.toHaveProperty('solution');
	// The hash is present and stable-shaped.
	expect(puzzle.secret.hash).toMatch(/^[0-9a-f]{16}$/);
}

describe('generatePuzzle', () => {
	it('produces a board for every size 7×7 through 11×11', () => {
		for (const size of SIZES) {
			const puzzle = generatePuzzle(size, { seed: 12345 });
			expect(puzzle.public.size).toBe(size);
			expectValidPuzzle(puzzle, size);
		}
	});

	it('property: over many seeds and all sizes, the invariants always hold', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...SIZES),
				fc.integer({ min: 1, max: 2 ** 31 - 1 }),
				(size, seed) => {
					const puzzle = generatePuzzle(size, { seed });
					expectValidPuzzle(puzzle, size);
				}
			),
			{ numRuns: 60 }
		);
	}, 120000);

	it('is reproducible — the same seed replays the same board', () => {
		const a = generatePuzzle(9, { seed: 777 });
		const b = generatePuzzle(9, { seed: 777 });
		expect(a).toEqual(b);
	});

	it('produces different boards for different seeds', () => {
		const a = generatePuzzle(9, { seed: 1 });
		const b = generatePuzzle(9, { seed: 2 });
		expect(a.secret.hash).not.toBe(b.secret.hash);
	});

	it('returns both the score and the raw signals', () => {
		const { secret } = generatePuzzle(8, { seed: 55 });
		expect(typeof secret.score).toBe('number');
		expect(secret.signals.size).toBe(8);
		expect(secret.generatorVersion).toBeGreaterThanOrEqual(1);
	});

	it('grows more irregular regions at higher bias', () => {
		// Averaged over seeds, high bias should yield greater region-size variance.
		const meanVariance = (bias: number) => {
			let sum = 0;
			for (let seed = 1; seed <= 12; seed++) {
				sum += generatePuzzle(9, { seed, irregularityBias: bias }).secret.signals
					.regionSizeVariance;
			}
			return sum / 12;
		};
		expect(meanVariance(0.95)).toBeGreaterThan(meanVariance(0.0));
	});
});

describe('generate (tier-targeted)', () => {
	it('never returns a board of the wrong tier — a match or null, nothing else', () => {
		for (const tier of DIFFICULTY_TIERS) {
			const puzzle = generate(7, tier, { seed: 4242, maxTierAttempts: 20 });
			if (puzzle !== null) {
				// The contract: a returned board's computed tier equals the target.
				expect(puzzle.public.tier).toBe(tier);
				expectValidPuzzle(puzzle, 7);
			}
		}
	});

	it('reaches a tier known to be producible at this size', () => {
		// Whatever tier an untargeted draw lands in is, by definition, reachable —
		// so a targeted request for it must succeed. This proves the steering path
		// end to end without assuming a fixed tier is reachable at every size.
		const emergent = generatePuzzle(9, { seed: 2024 }).public.tier;
		const targeted = generate(9, emergent, { seed: 2024 });
		expect(targeted).not.toBeNull();
		expect(targeted?.public.tier).toBe(emergent);
	});

	it('is reproducible — the same (size, tier, seed) replays the same result', () => {
		const emergent = generatePuzzle(9, { seed: 31337 }).public.tier;
		const a = generate(9, emergent, { seed: 31337 });
		const b = generate(9, emergent, { seed: 31337 });
		expect(a).toEqual(b);
	});
});
