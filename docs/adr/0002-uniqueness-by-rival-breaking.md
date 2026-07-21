# ADR 0002 — Achieving a unique solution by breaking rivals, not blind re-growth

**Status:** Accepted
**Ticket:** [#20 — Solver core: generator, difficulty score, canonical hash](https://github.com/fiachramcv90/queens-puzzle-game/issues/20)
**Related:** research note `docs/research/puzzle-generation-uniqueness.md`; implemented in `src/lib/solver/generate.ts`.

---

## Context

Issue #20 specifies the uniqueness gate as: grow N contiguous regions around the
hidden solution, and _"when a second solution exists, re-grow the regions against
the same hidden solution and re-check; restart the placement after K failures."_

Measured against the actual generator, **blind re-growth converges vanishingly
rarely** at sizes 7–11: a randomly flood-filled region map almost always admits
several legal placements besides the seeded one. In a sweep over thousands of
grown maps across every size and a range of growth biases, the fraction that were
unique on their own was ~0% (a handful of hits at the most irregular bias). So
re-growing and re-checking, unchanged, would loop indefinitely.

## Decision

Keep the solution-first pipeline exactly as specified for phases A (sample
placement) and B (seed one region per queen, multi-source flood-fill), so
solvability, one-queen-per-region and contiguity remain true **by construction**.
Replace the _uniqueness convergence_ mechanism: instead of blindly re-growing,
**drive a grown map to uniqueness by breaking rival solutions one at a time.**

Each repair step (`repairToUnique` → `breakRival`):

1. Find a rival solution via the shared region backtracker (`collectSolutions`,
   the same search `countSolutions` counts with), stopping at 2.
2. Take one of the rival's queens that is **not** on its region's seed, and
   recolour that boundary cell into an orthogonally-adjacent different region.
   The rival now has two queens in one region → invalid.
3. The hidden solution is untouched: seeds are never recoloured, so every region
   keeps exactly its one seeded queen and stays solvable.
4. Contiguity is preserved: the receiving region gains an adjacent cell; the
   losing region is re-checked and the move reverted if it would split.
5. Re-run the search — any _new_ rival a recolour introduces is caught next
   iteration — bounded by `MAX_REPAIRS`.

Blind re-growth survives only as the outer `maxRegrowsPerPlacement` loop, with
placement restart as the last resort — matching the spec's "restart after K
failures" as the fallback rather than the primary path.

## Consequences

- **Deviation from the issue's literal mechanism**, documented here so the record
  isn't only in code comments. The spec's _intent_ — a unique, contiguous,
  one-queen-per-region, solvable, seedable/reproducible board — is fully met; the
  property test asserts every invariant (including uniqueness via the real
  `countSolutions`) over many seeds and all sizes.
- **The counter is shared, not forked.** `countSolutions`, `collectSolutions` and
  the repair loop all go through one backtracker (`region-search.ts`), so the
  uniqueness check the generator relies on is the same code the rest of the core
  trusts.
- **Repair carves irregular regions**, which is why generated boards skew toward
  the harder tiers and the easiest tiers can be unreachable at large sizes — see
  ADR 0001's closing note on size-dependent tier reachability.
- **Feasibility holds.** Generation stays offline and dependency-free; a week's
  pool generates in seconds-to-minutes on one core (slowest observed single
  11×11 board a few seconds, most far quicker).
