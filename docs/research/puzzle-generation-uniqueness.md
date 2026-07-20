# Puzzle Generation & Unique-Solution Guarantee

**Ticket:** [#3 — Puzzle generation & unique-solution guarantee](https://github.com/fiachramcv90/queens-puzzle-game/issues/3) (part of wayfinder map #1)
**Status:** Research findings for human review. No decision locked.
**Date:** 2026-07-18

---

## 0. Problem restatement (the "LinkedIn Queens" variant)

This is **not** classic N-queens. The rules we must generate for:

- `N×N` board, partitioned into **N contiguous colored regions**.
- Place exactly **one queen per row**, **one per column**, and **one per colored region**.
- **No two queens adjacent, including diagonally** — this is **king-move adjacency** (Chebyshev distance = 1 is forbidden). Queens do **not** attack along full rows/diagonals in the chess sense; only the 8 immediate neighbours are forbidden. (Row/column exclusivity is enforced separately by the one-per-row/one-per-column rule.)
- Target sizes: **7×7 through 11×11**.

A solution is therefore a **permutation** `q(row) → col` (one per row and column) such that (a) each region is hit exactly once and (b) no two chosen cells are king-adjacent. Because it is a permutation, two queens can only ever be king-adjacent if they sit in **consecutive rows** with columns differing by exactly 1 — a useful simplification for both the solver and the checker.

> Adjacency precision note: a common shortcut in solver code is the Manhattan test `abs(dx)+abs(dy) > 2` to mark "safe" ([mathspp](https://mathspp.com/blog/beating-linkedin-queens-with-python)). Given row/column uniqueness this is _equivalent_ to the true king-move rule for this puzzle, but the canonical rule to implement and document is **Chebyshev: forbid `max(|dr|,|dc|) == 1`**.

---

## 1. Generation approach

### Recommended: **solution-first, then grow regions around it, gated by a uniqueness check**

Three phases, wrapped in a retry loop:

**Phase A — sample a valid queen placement (the hidden solution).**
Randomised backtracking over rows: for each row pick a random column not sharing a column with, and not king-adjacent to, the queen in the previous row; backtrack on dead ends. This yields a uniformly-ish random valid permutation with the no-touch property. Cost is negligible at N ≤ 11 (the no-touch constraint only couples consecutive rows).

**Phase B — grow N contiguous regions, one seed per queen.**
Seed each of the N regions on its queen's cell (this **guarantees each region contains exactly one queen**, so the "one queen per region" rule is satisfied _by construction_). Then assign the remaining `N² − N` cells by **multi-source flood fill / region growing**:

- Maintain a frontier per region; repeatedly pick an unassigned cell orthogonally adjacent to an existing region and attach it to that region.
- Randomise the growth order (and optionally weight it) to control region shape/balance. Orthogonal-only adjacency during growth keeps every region **4-connected (contiguous)** by construction.
- Keep growing until every cell is assigned. Optionally cap/steer region sizes for aesthetics.

This "seed-on-the-solution then flood-fill the colors" pattern is exactly how region-based Queens boards are reasoned about in the wild — solvers _read_ the board as "a list of sets, where each set contains the grid coordinates belonging to one colored region" ([mathspp](https://mathspp.com/blog/beating-linkedin-queens-with-python)); generation is the inverse of that parse. Contiguous-region identification via flood fill of same-color cells is the standard primitive ([SebiCoroian solver](https://github.com/SebiCoroian/LinkedInQueensGameSolver), [Oscar-sandbox solver](https://github.com/Oscar-sandbox/linkedin-queens-solver)).

**Phase C — uniqueness gate (see §2).**
Run a solution counter on `(board partition, rules)`. If exactly one solution → keep. If more than one → either **re-grow the regions** (cheap, keep the same hidden solution) or perturb region boundaries to break the alternate solution, then re-check. If after K attempts it won't converge, discard the placement and restart from Phase A.

Why gate-and-retry rather than "prove unique by construction": region growth does **not** by itself guarantee uniqueness — a different permutation may also satisfy all four constraints on the same coloring. There is no cheap constructive invariant that forces uniqueness for this puzzle, so the **generate-and-verify loop is the pragmatic standard**, mirroring how Sudoku generators work (build a full grid, then dig/verify, "each removal must be validated to ensure the puzzle retains exactly one solution" — [Final Sudoku](https://finalsudoku.com/sudoku-generator), [101 Computing](https://www.101computing.net/sudoku-generator-algorithm/)).

### Alternatives considered

| Approach                                          | How it works                                                                            | Verdict                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Solution-first + region growing (recommended)** | Sample valid placement, seed regions on queens, flood-fill colors, verify uniqueness    | Best fit. Guarantees solvability and one-queen-per-region by construction; regions trivially contiguous; only uniqueness needs verifying.                                  |
| **Regions-first, then check solvability**         | Randomly partition board into N contiguous regions, _then_ search for a valid placement | Wasteful: many partitions have zero or many solutions; you pay a full solve just to discover the board is unusable. Loses the free "solvable + one-per-region" guarantee.  |
| **Pure CP/SAT synthesis**                         | Encode "exists placement, and it is unique" as constraints; let solver emit a board     | Elegant but heavier to implement; uniqueness is a meta-constraint (∀ second-solution ¬valid) that CP handles awkwardly. Better used as the _checker_ than the _generator_. |
| **Carve/dig analogy from a full board**           | (Sudoku-style clue removal)                                                             | Doesn't map cleanly — the "clues" here are the coloring, not removable digits. The region-growth phase is the natural analogue.                                            |

**Tuning knob that matters:** region _irregularity_. Compact, blob-like regions tend to leave more freedom → more likely multiple solutions → more retries but easier puzzles. More elongated/interlocking regions tend toward uniqueness and harder deductions. The growth policy is where difficulty is dialed in (see §4).

---

## 2. Uniqueness verification

**Recommended primary: a backtracking solution-counter that stops at 2 ("second-solution search").**

- Standard, reliable technique for every unique-solution puzzle generator: run a solver that _counts_ solutions instead of returning the first, and **abort the moment a second solution is found** — you never need the full count, only "is it ≥ 2?" ([Final Sudoku](https://finalsudoku.com/sudoku-generator), [Sudoku generator write-up](https://dsasse07.medium.com/generating-solving-sudoku-puzzles-9ee1305ced01)).
- Reuse the same DFS/backtracking core used to solve LinkedIn Queens ([mathspp](https://mathspp.com/blog/beating-linkedin-queens-with-python), [SebiCoroian](https://github.com/SebiCoroian/LinkedInQueensGameSolver), [mei128/Queens](https://github.com/mei128/Queens) which "solves recursively, depth-first, using a list of positions per color"). Model as **exact-cover-ish CSP**: variable = which cell in each region holds the queen; prune remaining regions after each placement by removing same-row, same-column and king-adjacent cells; backtrack when any region is emptied. Iterate over regions in **most-constrained-first** order (fewest legal cells) to fail fast.
- Early termination makes this near-free: "most of the time, the solver either finds exactly one solution or quickly discovers a second one" ([Final Sudoku](https://finalsudoku.com/sudoku-generator)).

**Recommended cross-check / oracle: CP-SAT (Google OR-Tools) with `enumerate_all_solutions`.**

- Model the four constraints and set `enumerate_all_solutions = true`, using a `CpSolverSolutionCallback` that increments a counter and _stops the search at 2 solutions_ ([OR-Tools N-Queens](https://developers.google.com/optimization/cp/queens), [OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver)). CP-SAT does constraint-propagation + backtracking under the hood and is battle-tested.
- Scale sanity from the official N-queens benchmark (plain n-queens, _no_ color/king constraints, which has vastly more solutions than our variant): N=12 → 14,200 solutions in ~2.2 s; N=14 → 365,596 in ~62 s ([OR-Tools N-Queens](https://developers.google.com/optimization/cp/queens)). Our variant is far more constrained (target = exactly 1 solution), so enumeration terminates almost immediately. These numbers are an **upper bound on how hard enumeration could ever get** at these sizes — reassuringly small.

**SAT (DIMACS CNF + a solver like Clasp/MiniSat)** is a viable third option ([sat-nqueens encoder](https://github.com/bglezseoane/sat-nqueens), [N-Queens with SAT](https://jxtopher.github.io/Jxtopher/curiosity/n-queens-with-sat-solver.html)); uniqueness = add the negation of the found model as a clause and check for UNSAT. More encoding overhead than CP-SAT for no practical gain here.

**Verdict:** ship the **hand-rolled counting backtracker** as the in-loop gate (fastest, zero deps, stops at 2), and keep **CP-SAT enumerate-all** as an offline validation oracle / test cross-check to trust the hand-rolled counter.

---

## 3. Cost / feasibility (sizes 7–11)

- **Board scale is tiny:** 7×7 = 49 cells up to 11×11 = 121 cells; only N regions (7–11).
- **Solving/counting cost:** LinkedIn Queens solvers report sub-second, typically **tens of milliseconds**, solves on real boards ("every puzzle solved in under a second, average 0.08 s" backtracking-at-depth-2 style figures reported across solver write-ups). Counting-to-2 is the same order of magnitude. CP-SAT enumeration upper bounds (§2) confirm even the unconstrained problem stays cheap through these sizes.
- **Generation loop cost:** Phase A (placement) and Phase B (flood fill of ≤121 cells) are microsecond-to-millisecond. The dominant cost is Phase C × retries. With most-constrained-first counting and stop-at-2, each check is milliseconds; expected retries per accepted board are small (single digits) with a sensible growth policy.
- **Verdict: comfortably practical.** A **daily pool** (even hundreds of vetted boards per size, per day) can be pre-generated in **seconds to low minutes** of CPU on one core. Generation can run offline/batch; nothing here needs to happen at request time. No GPU, no external solver required for the core path.

---

## 4. Difficulty signal (light touch — flag only; #9 owns the model)

Measurable signals the generator can expose cheaply, for downstream difficulty calibration (#9):

- **Solver effort:** node/backtrack count and elapsed time from the counting solver — a direct proxy for search hardness.
- **Deduction depth:** whether the board is solvable by **forced-move propagation alone** (rows/regions/columns that collapse to a single legal cell) vs. requiring hypothetical/guess-and-check. Count the number of "naked single" style forced steps before any branch is needed.
- **Region irregularity / shape metrics:** region size variance, perimeter-to-area ratio, bounding-box fill, number of regions spanning many rows/columns. Irregular, elongated, interlocking regions correlate with harder deduction; compact blobs with easier.
- **Constraint tightness:** how close the board was to having multiple solutions (e.g. number of retries needed, or how many extra candidate placements survive propagation) — near-degenerate boards often feel easier.
- **Adjacency pressure:** how often the king-move rule (vs. row/column) is the binding constraint that eliminates candidates.

Recommendation: **log these at generation time** and store them alongside each board so #9 can regress them against observed human solve times without regenerating. Do not design the difficulty model here.

---

## 5. Prior art (cited)

- **LinkedIn Queens itself** — one queen per row, column, and colored region; no two queens touch, including diagonally; board size varies. Solved as a CSP via DFS + backtracking. ([mathspp: Beating LinkedIn Queens with Python](https://mathspp.com/blog/beating-linkedin-queens-with-python))
- **Open-source solvers (define the board model & region parsing we invert for generation):**
  - [SebiCoroian/LinkedInQueensGameSolver](https://github.com/SebiCoroian/LinkedInQueensGameSolver) — backtracking; contiguous color regions via flood fill, each assigned a unique ID.
  - [mei128/Queens](https://github.com/mei128/Queens) — recursive DFS over per-color candidate position lists.
  - [Oscar-sandbox/linkedin-queens-solver](https://github.com/Oscar-sandbox/linkedin-queens-solver) — backtracking + computer-vision board parse (cells → color → region id).
  - [RebeccaTadesse/LinkedIn-Queens-Solver](https://github.com/RebeccaTadesse/LinkedIn-Queens-Solver) — backtracking variant.
- **Alternative solve formulations** (useful as uniqueness oracles): Integer Programming ([Rihot Gusron, Medium](https://medium.com/@rihot_gusron/an-integer-programming-approach-to-linkedins-new-queen-puzzle-17fe27a5e2ed)); Z3/SMT and linear-equation formulations ([Ali Masri, Towards Data Engineering](https://medium.com/towards-data-engineering/solving-linkedins-queens-puzzle-with-code-6f1c3aa23a40)); SAS PROC OPTMODEL ([SAS Communities](https://communities.sas.com/t5/SAS-Communities-Library/Solving-the-LinkedIn-Queens-Puzzle-with-PROC-OPTMODEL/ta-p/957025)).
- **Constraint/SAT tooling (recommended checker stack):**
  - [Google OR-Tools — The N-Queens Problem](https://developers.google.com/optimization/cp/queens) — `enumerate_all_solutions` + `CpSolverSolutionCallback`; official scaling benchmark table.
  - [Google OR-Tools — CP-SAT Solver](https://developers.google.com/optimization/cp/cp_solver).
  - [CP-SAT Primer (d-krupke)](https://github.com/d-krupke/cpsat-primer).
  - SAT encodings: [bglezseoane/sat-nqueens](https://github.com/bglezseoane/sat-nqueens), [N-Queens with SAT solver](https://jxtopher.github.io/Jxtopher/curiosity/n-queens-with-sat-solver.html).
- **Generate-and-verify uniqueness pattern (from Sudoku generation, the closest well-documented analogue):** build a complete valid grid, then modify while **re-verifying exactly-one-solution after every change**, using a counting solver that stops at the second solution. ([Final Sudoku — How Sudoku Puzzles Are Generated](https://finalsudoku.com/sudoku-generator), [101 Computing — Sudoku Generator Algorithm](https://www.101computing.net/sudoku-generator-algorithm/), [Daniel Sasse — Generating & Solving Sudoku](https://dsasse07.medium.com/generating-solving-sudoku-puzzles-9ee1305ced01))

---

## TL;DR recommendation

1. **Generate:** sample a valid queen placement first → seed one region per queen → multi-source flood-fill the remaining cells into N contiguous colored regions → **gate on uniqueness**, re-growing regions (cheap) when a second solution exists.
2. **Verify uniqueness:** most-constrained-first **backtracking solution-counter that aborts at the 2nd solution**; keep **OR-Tools CP-SAT `enumerate_all_solutions`** as an offline cross-check oracle.
3. **Feasibility 7–11:** trivial. Boards are ≤121 cells; checks are milliseconds; a full daily pool pre-generates offline in seconds-to-minutes on one core.
4. **Difficulty:** log solver effort, forced-deduction depth, and region-irregularity metrics at generation time for #9; don't model difficulty here.
