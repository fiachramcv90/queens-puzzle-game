/**
 * Difficulty scoring: the weighted formula that turns a board's raw signals into
 * a continuous hidden score and buckets it into the five display tiers.
 *
 * The full rationale — which signals, why forced-deduction depth dominates, the
 * term ordering, and why the *raw* signals are retained rather than a
 * pre-combined number — is written up in `docs/adr/0001-difficulty-scoring.md`.
 * Read that before touching the weights; the exact numbers here are a build-time
 * detail, but the inputs, the dominant term, and "raw signals are returned and
 * retained" are locked by issue #20.
 *
 * This module is pure and board-blind: it scores a bag of signals and nothing
 * more. Extracting those signals from a board lives in `signals.ts`, so the
 * scoring contract can be tested — and, post-launch, recalibrated against real
 * solve times — without ever regenerating a board.
 */

/**
 * The five display tiers, easiest to hardest. These are the only difficulty
 * words the product uses — the domain language is fixed.
 */
export type DifficultyTier = 'Intro' | 'Easy' | 'Medium' | 'Hard' | 'Expert';

/** The tiers in ascending order of difficulty. */
export const DIFFICULTY_TIERS: readonly DifficultyTier[] = [
	'Intro',
	'Easy',
	'Medium',
	'Hard',
	'Expert'
] as const;

/**
 * The raw signals a board exposes, all oriented so that **larger means harder**.
 * Every one is retained verbatim on the generated puzzle: recalibrating the model
 * post-launch must be a data question (re-fit weights against observed solve
 * times), never a migration to recover lost inputs.
 */
export interface DifficultySignals {
	/**
	 * How deep hypothesis-and-check must go before the board resolves: `0` means
	 * it falls to pure forced propagation, higher means N-deep guessing. The
	 * dominant term and the closest cheap proxy for human difficulty.
	 */
	readonly forcedDeductionDepth: number;
	/** Board size N. Larger boards are harder, all else equal. */
	readonly size: number;
	/** Variance of the region sizes. Uneven regions are harder. */
	readonly regionSizeVariance: number;
	/** Mean boundary-perimeter-to-area ratio across regions. Jagged/elongated regions are harder. */
	readonly regionPerimeterAreaRatio: number;
	/** Mean of each region's `(rowSpan + colSpan)`. Regions spanning many rows/columns are harder. */
	readonly regionRowColSpan: number;
	/** Search nodes the uniqueness solver expanded. More effort, harder board. */
	readonly solverNodes: number;
	/** Backtracks the uniqueness solver made. More thrashing, harder board. */
	readonly solverBacktracks: number;
}

/** The output of {@link scoreDifficulty}: the score, its tier, and the signals it came from. */
export interface DifficultyResult {
	/** The continuous hidden score. Monotone non-decreasing in every signal. */
	readonly score: number;
	/** The display tier {@link score} buckets into. */
	readonly tier: DifficultyTier;
	/** The exact signals scored — echoed back so callers retain them alongside the score. */
	readonly signals: DifficultySignals;
}

/**
 * Term weights, in the descending order issue #20 locks:
 * forced-deduction depth ≫ board size ≫ region irregularity ≳ solver effort.
 * Each term is fed a normalised value in roughly `[0, 1]` (see below), so these
 * weights are also the terms' maximum contributions — the ordering is real, not
 * just nominal.
 */
const WEIGHTS = {
	depth: 100,
	size: 40,
	irregularity: 15,
	effort: 8
} as const;

/**
 * Half-saturation constants for the saturating normaliser `x / (x + k)`: the raw
 * signal value that maps to 0.5. Picked to sit near the middle of each signal's
 * observed range at sizes 7–11. Tunable; see the ADR.
 */
const HALF_SATURATION = {
	sizeVariance: 2,
	perimeterArea: 3,
	rowColSpan: 8,
	nodes: 50,
	backtracks: 50
} as const;

/** Depth's soft normaliser constant: `depth / (depth + k)`, strictly increasing in depth. */
const DEPTH_K = 1.5;

const MIN_SIZE = 7;
const MAX_SIZE = 11;

/**
 * Lower score bounds for each tier above Intro, ascending. A score at or above a
 * threshold lands in that tier or higher. Tunable build-time cut points — the
 * ADR records why they sit where they do.
 */
const TIER_LOWER_BOUNDS: readonly { readonly tier: DifficultyTier; readonly min: number }[] = [
	{ tier: 'Expert', min: 105 },
	{ tier: 'Hard', min: 75 },
	{ tier: 'Medium', min: 45 },
	{ tier: 'Easy', min: 20 }
];

/** `x / (x + k)` — a monotone map from `[0, ∞)` into `[0, 1)`. `x` must be ≥ 0. */
function saturate(x: number, k: number): number {
	return x / (x + k);
}

function clamp01(x: number): number {
	return Math.min(1, Math.max(0, x));
}

/**
 * Score a board's difficulty signals.
 *
 * Returns the continuous score, its display tier, and the signals themselves.
 * Two guarantees the tests pin down:
 *
 * - **Deterministic** — a pure function of the signals, so the same board scores
 *   identically every time.
 * - **Monotone** — the score never *decreases* when any single signal increases
 *   (over the valid board-size range for {@link DifficultySignals.size}). That is
 *   what "harder in a signal ⇒ not-easier overall" means, and it is what keeps
 *   the tiers defensible.
 */
export function scoreDifficulty(signals: DifficultySignals): DifficultyResult {
	const nDepth = signals.forcedDeductionDepth / (signals.forcedDeductionDepth + DEPTH_K);
	const nSize = clamp01((signals.size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE));
	const nIrregularity =
		(saturate(signals.regionSizeVariance, HALF_SATURATION.sizeVariance) +
			saturate(signals.regionPerimeterAreaRatio, HALF_SATURATION.perimeterArea) +
			saturate(signals.regionRowColSpan, HALF_SATURATION.rowColSpan)) /
		3;
	const nEffort =
		(saturate(signals.solverNodes, HALF_SATURATION.nodes) +
			saturate(signals.solverBacktracks, HALF_SATURATION.backtracks)) /
		2;

	const score =
		WEIGHTS.depth * nDepth +
		WEIGHTS.size * nSize +
		WEIGHTS.irregularity * nIrregularity +
		WEIGHTS.effort * nEffort;

	return { score, tier: tierForScore(score), signals };
}

/** The tier a continuous score buckets into. */
export function tierForScore(score: number): DifficultyTier {
	for (const { tier, min } of TIER_LOWER_BOUNDS) {
		if (score >= min) return tier;
	}
	return 'Intro';
}
