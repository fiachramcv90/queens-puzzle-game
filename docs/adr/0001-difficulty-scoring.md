# ADR 0001 — Difficulty scoring: signals, weighted formula, and tiers

**Status:** Accepted
**Ticket:** [#20 — Solver core: generator, difficulty score, canonical hash](https://github.com/fiachramcv90/queens-puzzle-game/issues/20)
**Related:** research note `docs/research/puzzle-generation-uniqueness.md`; implemented in `src/lib/solver/difficulty.ts` and `src/lib/solver/signals.ts`.

---

## Context

Every generated board needs a difficulty a player can trust: the five display
tiers **Intro · Easy · Medium · Hard · Expert**. Issue #20 locks three things and
leaves the rest tunable:

1. **The inputs** — which raw signals feed the score.
2. **The dominant term** — forced-deduction depth, the closest cheap proxy for
   human difficulty.
3. **That the raw signals are returned and retained** — so post-launch
   recalibration is a data question (re-fit the weights against observed solve
   times), never a migration to recover inputs we failed to store.

The exact weights and tier cut-points are explicitly a build-time detail. This
ADR records the ones we shipped and, more importantly, _why the shape is what it
is_, so a recalibration changes numbers without reopening the design.

## Decision

### The signals (all oriented so larger = harder)

Extracted by `extractSignals(regionMap)` and stored verbatim on the puzzle's
server-only half (`PuzzleSecret.signals`):

| Signal                     | Meaning                                                                                         | Why it belongs                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `forcedDeductionDepth`     | Levels of hypothesis-and-check needed before the board resolves; `0` = pure forced propagation. | **Dominant term.** How much guessing a human must do is the best cheap proxy for felt difficulty. |
| `size`                     | Board dimension N (7–11).                                                                       | Bigger boards are harder, all else equal.                                                         |
| `regionSizeVariance`       | Variance of region cell-counts.                                                                 | Uneven regions are harder to reason about.                                                        |
| `regionPerimeterAreaRatio` | Mean boundary-perimeter ÷ area across regions.                                                  | Jagged / elongated regions are harder than compact blobs.                                         |
| `regionRowColSpan`         | Mean of each region's `rowSpan + colSpan`.                                                      | Regions stretched across many rows/columns are harder.                                            |
| `solverNodes`              | Search nodes the uniqueness solver expanded.                                                    | Direct measure of search effort.                                                                  |
| `solverBacktracks`         | Backtracks the uniqueness solver made.                                                          | Search thrashing = harder.                                                                        |

The three region-irregularity signals are stored **separately, un-combined** on
purpose: a recalibration can re-weight them independently against real data
without regenerating a single board.

`forcedDeductionDepth`, `solverNodes` and `solverBacktracks` come from a
**propagate-then-branch** solve (see `analyzeSearch` in `signals.ts`).
Propagation places every forced move — a region, row, or column with a single
remaining candidate — before branching, so a board solvable by deduction alone
expands no nodes: depth 0, zero effort. This is sound only because it runs on a
board already proven **unique** (every forced move lies on the one true
solution).

### The formula

Each term is fed a value normalised to roughly `[0, 1]`, then weighted. The
**weights are also the terms' maximum contributions**, so the descending order
issue #20 mandates is real, not nominal:

```
score = 100 · nDepth      (forced-deduction depth — dominant)
      +  40 · nSize        (board size)
      +  15 · nIrregular   (mean of the three region-irregularity signals)
      +   8 · nEffort      (mean of solver nodes and backtracks)
```

**Term ordering (locked): depth ≫ size ≫ region irregularity ≳ solver effort.**

Normalisers, all monotone non-decreasing in their raw signal:

- `nDepth  = depth / (depth + 1.5)` — strictly increasing, saturating in `[0, 1)`.
- `nSize   = clamp01((size − 7) / 4)` — exactly `[0, 1]` across sizes 7–11.
- `nIrregular` = mean of `x / (x + k)` for the three irregularity signals, with
  half-saturation constants `k =` size-variance 2, perimeter/area 3, span 8.
- `nEffort` = mean of `x / (x + 50)` for nodes and backtracks.

The saturating form `x / (x + k)` keeps a single low-priority signal (a board
that happened to need thousands of nodes) from ever swamping a higher-priority
term. `k` is the raw value that maps to 0.5 — chosen near the middle of each
signal's observed range at these sizes.

Two guarantees the tests pin (`difficulty.test.ts`):

- **Deterministic** — a pure function of the signals; the same board always
  scores identically.
- **Monotone** — raising any single signal never lowers the score (over the valid
  size range). "Harder in a signal ⇒ not easier overall" is what keeps the tiers
  defensible.

### The tiers

`tierForScore(score)` buckets the continuous score by lower bounds:

| Tier   | Score ≥ |
| ------ | ------- |
| Intro  | 0       |
| Easy   | 20      |
| Medium | 45      |
| Hard   | 75      |
| Expert | 105     |

Because the weights blend rather than lexicographically sort, a large, irregular
depth-0 board can out-score a tiny depth-1 one — deliberately. Depth is
_dominant_ (largest weight), not absolute.

## Consequences

- **Recalibration is data, not migration.** All raw signals are retained, so
  re-fitting `WEIGHTS`, the `SAT` constants, `DEPTH_K`, or `TIER_LOWER_BOUNDS`
  against observed solve times touches only `difficulty.ts`. Bump
  `GENERATOR_VERSION` if a change alters stored scores.
- **Tier reachability is size-dependent.** The generator's rival-breaking repair
  (ADR context: `generate.ts`) tends to carve irregular regions that need
  guessing, so larger boards skew toward Hard/Expert and the easiest tiers may be
  unreachable at 10–11. `generate(size, targetTier)` therefore returns `null`
  when it cannot hit the target within its attempt budget — a documented outcome,
  not an error. The future pool builder should generate boards and bucket them by
  emergent tier rather than demanding a fixed tier at every size.
