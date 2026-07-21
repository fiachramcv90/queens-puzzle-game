import { scoreDifficulty, type DifficultySignals, type DifficultyTier } from './difficulty';
import { boardHash } from './hash';
import { extractSignals } from './signals';
import { makeRng, randInt, shuffledRange, type Rng } from './rng';
import type { Cell, RegionMap } from './types';
import { GENERATOR_VERSION } from './version';

/**
 * The public half of a generated puzzle — everything, and only what, a client
 * needs to render and play the board. It carries no solution: a caller holding a
 * {@link PuzzlePublic} literally cannot know the answer. The whole product rests
 * on this half and {@link PuzzleSecret} never travelling together.
 */
export interface PuzzlePublic {
	readonly size: number;
	readonly regionMap: RegionMap;
	readonly tier: DifficultyTier;
}

/**
 * The server-only half: the hidden solution, the difficulty score and the raw
 * signals behind it, the canonical hash, and the provenance needed to replay or
 * recalibrate. This never reaches the client.
 */
export interface PuzzleSecret {
	/** The single legal full board, one queen per row, ordered by row. */
	readonly solution: readonly Cell[];
	/** The continuous hidden difficulty score. */
	readonly score: number;
	/** The raw signals the score was computed from — retained for post-launch recalibration. */
	readonly signals: DifficultySignals;
	/** The canonical hash over `(size, region_map, solution)` — the pool's uniqueness key. */
	readonly hash: string;
	/** Which generator produced this board (see {@link GENERATOR_VERSION}). */
	readonly generatorVersion: number;
	/** The RNG seed that reproduces this board via {@link generatePuzzle}. */
	readonly seed: number;
}

/**
 * A generated puzzle, split into its two halves by type so that nothing forces a
 * caller to hold {@link PuzzleSecret.solution} to render a board. Persist the two
 * halves to their two homes; never serialise them together to the client.
 */
export interface GeneratedPuzzle {
	readonly public: PuzzlePublic;
	readonly secret: PuzzleSecret;
}

/** Options for {@link generatePuzzle}. */
export interface GeneratePuzzleOptions {
	/** Seed for reproducible output. Defaults to a time-derived seed. */
	readonly seed?: number;
	/**
	 * How irregular to grow the regions, in `[0, 1]`: 0 grows compact, balanced
	 * blobs; 1 grows lopsided, interlocking regions. This is the difficulty tuning
	 * knob. Defaults to `0.5`.
	 */
	readonly irregularityBias?: number;
	/** How many placement restarts to try before giving up on uniqueness. */
	readonly maxRestarts?: number;
	/** How many region re-grows to try per placement before restarting placement. */
	readonly maxRegrowsPerPlacement?: number;
}

/** Options for {@link generate}. */
export interface GenerateOptions extends GeneratePuzzleOptions {
	/** How many boards to sample while chasing the target tier before reporting failure. */
	readonly maxTierAttempts?: number;
}

const DEFAULTS = {
	irregularityBias: 0.5,
	maxRestarts: 120,
	maxRegrowsPerPlacement: 16,
	maxTierAttempts: 40
} as const;

/** How many rival-breaking recolour steps to attempt per grown region map. */
const MAX_REPAIRS = 400;

/**
 * The region-growth irregularity each tier is grown at. Higher tiers grow more
 * irregular regions, which tend toward deeper deductions — irregularity is the
 * difficulty knob (see `docs/adr/0001-difficulty-scoring.md`). These only *aim*
 * at a tier; the produced board's tier is whatever {@link scoreDifficulty}
 * computes, which is why {@link generate} samples and checks.
 */
const TIER_BIAS: Record<DifficultyTier, number> = {
	Intro: 0.0,
	Easy: 0.2,
	Medium: 0.45,
	Hard: 0.7,
	Expert: 0.9
};

/**
 * Manufacture a guaranteed-unique Queens board at the given size.
 *
 * Solution-first (see the research note `docs/research/puzzle-generation-uniqueness.md`):
 * sample a valid queen placement, seed one region per queen, flood-fill the rest
 * into N contiguous regions, and gate on uniqueness. Solvability, one-queen-per-
 * region and contiguity hold **by construction**; only uniqueness is checked, via
 * {@link countSolutions} stopping at 2. When a second solution exists the regions
 * are re-grown against the same hidden solution (cheap); after enough failures the
 * placement is restarted.
 *
 * Always returns a valid unique board — it does not target a tier. Use
 * {@link generate} when you need a specific tier. Reproducible: the same `seed`
 * (and `irregularityBias`) replays the same board.
 */
export function generatePuzzle(size: number, options: GeneratePuzzleOptions = {}): GeneratedPuzzle {
	const seed = options.seed ?? defaultSeed();
	const bias = options.irregularityBias ?? DEFAULTS.irregularityBias;
	const maxRestarts = options.maxRestarts ?? DEFAULTS.maxRestarts;
	const maxRegrows = options.maxRegrowsPerPlacement ?? DEFAULTS.maxRegrowsPerPlacement;
	const rng = makeRng(seed);

	for (let restart = 0; restart < maxRestarts; restart++) {
		const placement = samplePlacement(size, rng);
		if (!placement) continue;

		for (let regrow = 0; regrow < maxRegrows; regrow++) {
			const regionMap = growRegions(size, placement, rng, bias);
			// A freshly-grown map almost always has rival solutions; drive it to a
			// unique one by breaking rivals against the fixed hidden solution.
			const unique = repairToUnique(size, placement, regionMap, rng);
			if (unique) return assemble(size, placement, unique, seed);
		}
	}

	throw new Error(
		`generatePuzzle: no unique board found for size ${size} within ${maxRestarts} restarts. ` +
			`This should not happen for sizes 7–11; treat it as a bug, not a tuning problem (issue #20).`
	);
}

/**
 * Generate a board whose computed tier matches `targetTier`, or return `null` for
 * the caller to re-sample.
 *
 * Samples boards (steering region irregularity toward the tier) and returns the
 * first whose {@link scoreDifficulty} tier equals `targetTier`. Exact-tier hits
 * are not guaranteed on any single draw, so this may exhaust its attempts and
 * report failure — that is the documented contract, not an error. Reproducible:
 * the same `(size, targetTier, seed)` replays the same result.
 */
export function generate(
	size: number,
	targetTier: DifficultyTier,
	options: GenerateOptions = {}
): GeneratedPuzzle | null {
	const baseSeed = options.seed ?? defaultSeed();
	const bias = options.irregularityBias ?? TIER_BIAS[targetTier];
	const maxAttempts = options.maxTierAttempts ?? DEFAULTS.maxTierAttempts;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// A distinct, deterministic sub-seed per attempt so the whole run replays.
		const subSeed = mixSeed(baseSeed, attempt);
		const puzzle = generatePuzzle(size, { ...options, seed: subSeed, irregularityBias: bias });
		if (puzzle.public.tier === targetTier) return puzzle;
	}

	return null;
}

/** Assemble the two-halved result from a placement and its vetted region map. */
function assemble(
	size: number,
	placement: readonly Cell[],
	regionMap: RegionMap,
	seed: number
): GeneratedPuzzle {
	const solution = placement.map((cell) => ({ row: cell.row, col: cell.col }));
	const signals = extractSignals(regionMap);
	const { score, tier } = scoreDifficulty(signals);
	const hash = boardHash(size, regionMap, solution);

	return {
		public: { size, regionMap, tier },
		secret: {
			solution,
			score,
			signals,
			hash,
			generatorVersion: GENERATOR_VERSION,
			seed
		}
	};
}

/**
 * Phase A — sample a valid queen placement by randomised backtracking over rows.
 * Each row takes a random column not sharing a column with, and not king-adjacent
 * to, the queen in the row above (a permutation makes non-consecutive rows always
 * safe). Returns one cell per row in row order, or `null` if the shuffle painted
 * itself into a corner — the caller restarts.
 */
function samplePlacement(size: number, rng: Rng): Cell[] | null {
	const cols = new Array<number>(size).fill(-1);
	const usedCol = new Array<boolean>(size).fill(false);

	const place = (row: number): boolean => {
		if (row === size) return true;
		for (const col of shuffledRange(rng, size)) {
			if (usedCol[col]) continue;
			if (row > 0 && Math.abs(col - cols[row - 1]) === 1) continue;
			cols[row] = col;
			usedCol[col] = true;
			if (place(row + 1)) return true;
			usedCol[col] = false;
			cols[row] = -1;
		}
		return false;
	};

	if (!place(0)) return null;
	return cols.map((col, row) => ({ row, col }));
}

/**
 * Phase B — grow N contiguous regions around the placement. Region `i` is seeded
 * on `placement[i]`, which is what makes "exactly one queen per region" true by
 * construction. The remaining cells are attached by multi-source flood fill,
 * always into an orthogonally-adjacent region so every region stays 4-connected.
 *
 * `bias` steers the growth: at each step, with probability `bias` a random
 * frontier cell is attached (lopsided, irregular regions); otherwise the smallest
 * region with a frontier grows (compact, balanced regions). More irregularity
 * tends toward harder boards.
 */
function growRegions(size: number, placement: readonly Cell[], rng: Rng, bias: number): RegionMap {
	const region: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(-1));
	const sizes = new Array<number>(size).fill(1);
	placement.forEach((cell, id) => {
		region[cell.row][cell.col] = id;
	});

	let unassigned = size * size - size;
	const neighbours = [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1]
	];

	while (unassigned > 0) {
		// Every (unassigned cell, adjacent region) pairing on the current frontier.
		const frontier: { row: number; col: number; region: number }[] = [];
		for (let row = 0; row < size; row++) {
			for (let col = 0; col < size; col++) {
				if (region[row][col] !== -1) continue;
				const seen = new Set<number>();
				for (const [dr, dc] of neighbours) {
					const nr = row + dr;
					const nc = col + dc;
					if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
					const id = region[nr][nc];
					if (id !== -1 && !seen.has(id)) {
						seen.add(id);
						frontier.push({ row, col, region: id });
					}
				}
			}
		}
		// The grid is connected and every region is seeded, so while cells remain
		// unassigned the frontier is never empty.

		let choice: { row: number; col: number; region: number };
		if (rng() < bias) {
			choice = frontier[randInt(rng, frontier.length)];
		} else {
			// Grow the smallest region that has a frontier — keeps regions balanced.
			const regionsWithFrontier = [...new Set(frontier.map((f) => f.region))];
			const minSize = Math.min(...regionsWithFrontier.map((r) => sizes[r]));
			const smallest = regionsWithFrontier.filter((r) => sizes[r] === minSize);
			const target = smallest[randInt(rng, smallest.length)];
			const options = frontier.filter((f) => f.region === target);
			choice = options[randInt(rng, options.length)];
		}

		region[choice.row][choice.col] = choice.region;
		sizes[choice.region]++;
		unassigned--;
	}

	return region;
}

/**
 * Phase C — drive a freshly-grown region map to a **unique** solution by
 * repeatedly breaking rival solutions against the fixed hidden solution.
 *
 * A random region growth almost always admits other legal placements besides the
 * seeded solution, so uniqueness is not free (contrary to a naive reading of the
 * spec — blind re-growth converges vanishingly rarely at these sizes). Instead,
 * each step finds a rival solution and kills it with a single recolour: take one
 * of the rival's queens that is *not* on its region's seed, and recolour that
 * boundary cell into an orthogonally-adjacent different region. That makes the
 * rival place two queens in one region (invalid) while leaving the hidden
 * solution untouched — its seeds are never recoloured, so every region keeps
 * exactly one seeded queen. Contiguity is preserved: the receiving region gains
 * an adjacent cell, and the losing region is re-checked and the move reverted if
 * it would split.
 *
 * Returns the unique region map, or `null` if no legal rival-breaking recolour
 * was available (the caller re-grows or restarts).
 */
function repairToUnique(
	size: number,
	placement: readonly Cell[],
	grown: RegionMap,
	rng: Rng
): RegionMap | null {
	const map: number[][] = grown.map((row) => [...row]);
	const seedKeys = new Set(placement.map((c) => `${c.row},${c.col}`));

	// The hidden solution as one column per row, for rival comparison.
	const hiddenCols = new Array<number>(size).fill(-1);
	for (const { row, col } of placement) hiddenCols[row] = col;

	for (let step = 0; step < MAX_REPAIRS; step++) {
		const solutions = findSolutions(map, 2);
		if (solutions.length <= 1) return map;

		const rival =
			solutions.find((sol) => sol.some((cell) => cell.col !== hiddenCols[cell.row])) ?? null;
		if (!rival) return map; // both solutions equal the hidden one — already unique.

		if (!breakRival(size, map, rival, seedKeys, rng)) return null;
	}

	return findSolutions(map, 2).length === 1 ? map : null;
}

/**
 * Recolour one boundary cell to invalidate `rival` while keeping every region
 * contiguous and the seeded solution intact. Returns whether a recolour was made.
 */
function breakRival(
	size: number,
	map: number[][],
	rival: readonly Cell[],
	seedKeys: Set<string>,
	rng: Rng
): boolean {
	const neighbours = [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1]
	];

	for (const idx of shuffledRange(rng, rival.length)) {
		const { row, col } = rival[idx];
		// Never touch a seed: seeds anchor the hidden solution's one-per-region.
		if (seedKeys.has(`${row},${col}`)) continue;
		const from = map[row][col];

		const adjacent = new Set<number>();
		for (const [dr, dc] of neighbours) {
			const nr = row + dr;
			const nc = col + dc;
			if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
			const id = map[nr][nc];
			if (id !== from) adjacent.add(id);
		}

		const targets = [...adjacent];
		for (const j of shuffledRange(rng, targets.length)) {
			map[row][col] = targets[j];
			// Recolouring can only split the losing region; the receiving region
			// gained an adjacent cell and stays contiguous.
			if (regionIsContiguous(size, map, from)) return true;
			map[row][col] = from; // revert and try another target.
		}
	}
	return false;
}

/** Whether the cells coloured `region` form a single 4-connected blob. */
function regionIsContiguous(size: number, map: number[][], region: number): boolean {
	const cells: Cell[] = [];
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			if (map[row][col] === region) cells.push({ row, col });
		}
	}
	if (cells.length === 0) return false;

	const key = (c: Cell) => c.row * size + c.col;
	const all = new Set(cells.map(key));
	const seen = new Set<number>([key(cells[0])]);
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
			if (n.row < 0 || n.row >= size || n.col < 0 || n.col >= size) continue;
			const k = key(n);
			if (all.has(k) && !seen.has(k)) {
				seen.add(k);
				stack.push(n);
			}
		}
	}
	return seen.size === cells.length;
}

/**
 * Find up to `cap` full solutions of a region map, each as one queen per row in
 * row order. The same most-constrained-region search {@link countSolutions} uses,
 * but returning the placements themselves so a rival can be broken.
 */
function findSolutions(regionMap: RegionMap, cap: number): Cell[][] {
	const size = regionMap.length;
	const regionCells = new Map<number, Cell[]>();
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			const region = regionMap[row][col];
			let cells = regionCells.get(region);
			if (!cells) regionCells.set(region, (cells = []));
			cells.push({ row, col });
		}
	}
	const regions = [...regionCells.keys()];
	const usedRow = new Array<boolean>(size).fill(false);
	const usedCol = new Array<boolean>(size).fill(false);
	const placed: Cell[] = [];
	const assigned = new Set<number>();
	const found: Cell[][] = [];

	const candidates = (region: number): Cell[] =>
		regionCells
			.get(region)!
			.filter(
				(cell) =>
					!usedRow[cell.row] &&
					!usedCol[cell.col] &&
					placed.every(
						(q) => Math.max(Math.abs(q.row - cell.row), Math.abs(q.col - cell.col)) !== 1
					)
			);

	const search = (): void => {
		if (found.length >= cap) return;
		if (assigned.size === regions.length) {
			found.push([...placed].sort((a, b) => a.row - b.row));
			return;
		}
		let target: number | null = null;
		let targetCandidates: Cell[] = [];
		for (const region of regions) {
			if (assigned.has(region)) continue;
			const cells = candidates(region);
			if (target === null || cells.length < targetCandidates.length) {
				target = region;
				targetCandidates = cells;
				if (cells.length === 0) break;
			}
		}
		if (target === null) return;

		for (const cell of targetCandidates) {
			usedRow[cell.row] = true;
			usedCol[cell.col] = true;
			placed.push(cell);
			assigned.add(target);
			search();
			assigned.delete(target);
			placed.pop();
			usedCol[cell.col] = false;
			usedRow[cell.row] = false;
			if (found.length >= cap) return;
		}
	};

	search();
	return found;
}

/** A time-derived seed for when the caller does not supply one. */
function defaultSeed(): number {
	return (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
}

/** Deterministically mix an attempt index into a base seed. */
function mixSeed(seed: number, attempt: number): number {
	let x = (seed ^ (attempt * 0x9e3779b9)) >>> 0;
	x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
	x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
	return (x ^ (x >>> 16)) >>> 0;
}
