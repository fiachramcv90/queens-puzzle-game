// GENERATED from src/lib/solver/index.ts by scripts/build-edge-bundles.mjs — do not edit.

// src/lib/solver/version.ts
var GENERATOR_VERSION = 1;
var MOVE_LOG_FORMAT_VERSION = 1;

// src/lib/solver/adjacency.ts
function isAdjacent(a, b) {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  return Math.max(dr, dc) === 1;
}

// src/lib/solver/check-rules.ts
function checkRules(board, regionMap) {
  const size = board.length;
  const queens = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (board[row][col] === "queen") queens.push({ row, col });
    }
  }
  const rowCounts = /* @__PURE__ */ new Map();
  const colCounts = /* @__PURE__ */ new Map();
  const regionCounts = /* @__PURE__ */ new Map();
  for (const { row, col } of queens) {
    rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
    colCounts.set(col, (colCounts.get(col) ?? 0) + 1);
    const region = regionMap[row][col];
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
  }
  const duplicatedKeys = (counts) => [...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key);
  const duplicateRows = duplicatedKeys(rowCounts).sort((a, b) => a - b);
  const duplicateColumns = duplicatedKeys(colCounts).sort((a, b) => a - b);
  const duplicateRegions = duplicatedKeys(regionCounts).sort((a, b) => a - b);
  const adjacentPairs = [];
  for (let i = 0; i < queens.length; i++) {
    for (let j = i + 1; j < queens.length; j++) {
      if (isAdjacent(queens[i], queens[j])) adjacentPairs.push([queens[i], queens[j]]);
    }
  }
  const conflictKeys = /* @__PURE__ */ new Set();
  const conflicts = [];
  const flag = (cell) => {
    const key = `${cell.row},${cell.col}`;
    if (conflictKeys.has(key)) return;
    conflictKeys.add(key);
    conflicts.push(cell);
  };
  for (const queen of queens) {
    const region = regionMap[queen.row][queen.col];
    if ((rowCounts.get(queen.row) ?? 0) > 1 || (colCounts.get(queen.col) ?? 0) > 1 || (regionCounts.get(region) ?? 0) > 1) {
      flag(queen);
    }
  }
  for (const [a, b] of adjacentPairs) {
    flag(a);
    flag(b);
  }
  const violations = {
    duplicateRows,
    duplicateColumns,
    duplicateRegions,
    adjacentPairs,
    queenCount: queens.length,
    requiredQueens: size
  };
  const solved = queens.length === size && duplicateRows.length === 0 && duplicateColumns.length === 0 && duplicateRegions.length === 0 && adjacentPairs.length === 0;
  return { solved, conflicts, violations };
}

// src/lib/solver/region-search.ts
function forEachSolution(regionMap, cap, visit) {
  const size = regionMap.length;
  if (size === 0 || cap <= 0) return;
  const regionCells = /* @__PURE__ */ new Map();
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const region = regionMap[row][col];
      let cells = regionCells.get(region);
      if (!cells) regionCells.set(region, cells = []);
      cells.push({ row, col });
    }
  }
  const regions = [...regionCells.keys()];
  const usedRows = new Array(size).fill(false);
  const usedCols = new Array(size).fill(false);
  const placed = [];
  const assigned = /* @__PURE__ */ new Set();
  let found = 0;
  const candidates = (region) => regionCells.get(region).filter(
    (cell) => !usedRows[cell.row] && !usedCols[cell.col] && placed.every((queen) => !isAdjacent(queen, cell))
  );
  const search = () => {
    if (found >= cap) return;
    if (assigned.size === regions.length) {
      found++;
      visit(placed);
      return;
    }
    let target = null;
    let targetCandidates = [];
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
      usedRows[cell.row] = true;
      usedCols[cell.col] = true;
      placed.push(cell);
      assigned.add(target);
      search();
      assigned.delete(target);
      placed.pop();
      usedCols[cell.col] = false;
      usedRows[cell.row] = false;
      if (found >= cap) return;
    }
  };
  search();
}
function collectSolutions(regionMap, cap) {
  const found = [];
  forEachSolution(regionMap, cap, (placed) => {
    found.push([...placed].sort((a, b) => a.row - b.row));
  });
  return found;
}

// src/lib/solver/count-solutions.ts
function countSolutions(regionMap, stopAt = 2) {
  let count = 0;
  forEachSolution(regionMap, stopAt, () => {
    count++;
  });
  return count;
}

// src/lib/solver/difficulty.ts
var DIFFICULTY_TIERS = [
  "Intro",
  "Easy",
  "Medium",
  "Hard",
  "Expert"
];
var WEIGHTS = {
  depth: 100,
  size: 40,
  irregularity: 15,
  effort: 8
};
var HALF_SATURATION = {
  sizeVariance: 2,
  perimeterArea: 3,
  rowColSpan: 8,
  nodes: 50,
  backtracks: 50
};
var DEPTH_K = 1.5;
var MIN_SIZE = 7;
var MAX_SIZE = 11;
var TIER_LOWER_BOUNDS = [
  { tier: "Expert", min: 105 },
  { tier: "Hard", min: 75 },
  { tier: "Medium", min: 45 },
  { tier: "Easy", min: 20 }
];
function saturate(x, k) {
  return x / (x + k);
}
function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}
function scoreDifficulty(signals) {
  const nDepth = signals.forcedDeductionDepth / (signals.forcedDeductionDepth + DEPTH_K);
  const nSize = clamp01((signals.size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE));
  const nIrregularity = (saturate(signals.regionSizeVariance, HALF_SATURATION.sizeVariance) + saturate(signals.regionPerimeterAreaRatio, HALF_SATURATION.perimeterArea) + saturate(signals.regionRowColSpan, HALF_SATURATION.rowColSpan)) / 3;
  const nEffort = (saturate(signals.solverNodes, HALF_SATURATION.nodes) + saturate(signals.solverBacktracks, HALF_SATURATION.backtracks)) / 2;
  const score = WEIGHTS.depth * nDepth + WEIGHTS.size * nSize + WEIGHTS.irregularity * nIrregularity + WEIGHTS.effort * nEffort;
  return { score, tier: tierForScore(score), signals };
}
function tierForScore(score) {
  for (const { tier, min } of TIER_LOWER_BOUNDS) {
    if (score >= min) return tier;
  }
  return "Intro";
}

// src/lib/solver/hash.ts
function boardHash(size, regionMap, solution) {
  const regions = canonicalRegionIds(regionMap);
  const regionPart = regions.map((row) => row.join(",")).join(";");
  const cols = new Array(size).fill(-1);
  for (const { row, col } of solution) cols[row] = col;
  const solutionPart = cols.join(",");
  return fnv1a64Hex(`${size}|${regionPart}|${solutionPart}`);
}
function canonicalRegionIds(regionMap) {
  const remap = /* @__PURE__ */ new Map();
  return regionMap.map(
    (row) => row.map((region) => {
      let id = remap.get(region);
      if (id === void 0) {
        id = remap.size;
        remap.set(region, id);
      }
      return id;
    })
  );
}
function fnv1a64Hex(input) {
  const mask = (1n << 64n) - 1n;
  const prime = 0x100000001b3n;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = hash * prime & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

// src/lib/solver/signals.ts
function extractSignals(regionMap) {
  const size = regionMap.length;
  const geometry = regionGeometry(regionMap);
  const search = analyzeSearch(regionMap);
  return {
    forcedDeductionDepth: search.depth,
    size,
    regionSizeVariance: geometry.sizeVariance,
    regionPerimeterAreaRatio: geometry.perimeterAreaRatio,
    regionRowColSpan: geometry.rowColSpan,
    solverNodes: search.nodes,
    solverBacktracks: search.backtracks
  };
}
function regionGeometry(regionMap) {
  const size = regionMap.length;
  const cells = /* @__PURE__ */ new Map();
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const region = regionMap[row][col];
      let list = cells.get(region);
      if (!list) cells.set(region, list = []);
      list.push({ row, col });
    }
  }
  const regions = [...cells.values()];
  const sizes = regions.map((r) => r.length);
  const meanSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const sizeVariance = sizes.reduce((acc, s) => acc + (s - meanSize) ** 2, 0) / sizes.length;
  let perimeterAreaSum = 0;
  let spanSum = 0;
  for (const region of regions) {
    let perimeter = 0;
    let minRow = size;
    let maxRow = -1;
    let minCol = size;
    let maxCol = -1;
    for (const { row, col } of region) {
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1]
      ]) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size || regionMap[nr][nc] !== regionMap[row][col]) {
          perimeter++;
        }
      }
    }
    perimeterAreaSum += perimeter / region.length;
    spanSum += maxRow - minRow + 1 + (maxCol - minCol + 1);
  }
  return {
    sizeVariance,
    perimeterAreaRatio: perimeterAreaSum / regions.length,
    rowColSpan: spanSum / regions.length
  };
}
function analyzeSearch(regionMap) {
  const size = regionMap.length;
  let nodes = 0;
  let backtracks = 0;
  const candidatesAt = (placed) => {
    const usedRow = new Array(size).fill(false);
    const usedCol = new Array(size).fill(false);
    const usedRegion = /* @__PURE__ */ new Set();
    for (const q of placed) {
      usedRow[q.row] = true;
      usedCol[q.col] = true;
      usedRegion.add(regionMap[q.row][q.col]);
    }
    const possible = Array.from(
      { length: size },
      () => new Array(size).fill(false)
    );
    for (let row = 0; row < size; row++) {
      if (usedRow[row]) continue;
      for (let col = 0; col < size; col++) {
        if (usedCol[col] || usedRegion.has(regionMap[row][col])) continue;
        if (placed.some((q) => isAdjacent(q, { row, col }))) continue;
        possible[row][col] = true;
      }
    }
    return possible;
  };
  const solve = (start, depth2) => {
    const placed = [...start];
    for (; ; ) {
      if (placed.length === size) return depth2;
      const possible2 = candidatesAt(placed);
      const usedRow = new Array(size).fill(false);
      const usedCol = new Array(size).fill(false);
      const usedRegion2 = /* @__PURE__ */ new Set();
      for (const q of placed) {
        usedRow[q.row] = true;
        usedCol[q.col] = true;
        usedRegion2.add(regionMap[q.row][q.col]);
      }
      let forced = null;
      let dead = false;
      const regionCells = /* @__PURE__ */ new Map();
      for (let row = 0; row < size && !dead; row++) {
        for (let col = 0; col < size; col++) {
          if (!possible2[row][col]) continue;
          const region = regionMap[row][col];
          let list = regionCells.get(region);
          if (!list) regionCells.set(region, list = []);
          list.push({ row, col });
        }
      }
      for (let region = 0; region < size; region++) {
        if (usedRegion2.has(region)) continue;
        const list = regionCells.get(region);
        if (!list || list.length === 0) {
          dead = true;
          break;
        }
        if (list.length === 1 && !forced) forced = list[0];
      }
      for (let row = 0; row < size && !dead; row++) {
        if (usedRow[row]) continue;
        let count = 0;
        let only = null;
        for (let col = 0; col < size; col++) {
          if (possible2[row][col]) {
            count++;
            only = { row, col };
          }
        }
        if (count === 0) dead = true;
        else if (count === 1 && !forced) forced = only;
      }
      for (let col = 0; col < size && !dead; col++) {
        if (usedCol[col]) continue;
        let count = 0;
        let only = null;
        for (let row = 0; row < size; row++) {
          if (possible2[row][col]) {
            count++;
            only = { row, col };
          }
        }
        if (count === 0) dead = true;
        else if (count === 1 && !forced) forced = only;
      }
      if (dead) return null;
      if (forced) {
        placed.push(forced);
        continue;
      }
      break;
    }
    nodes++;
    const possible = candidatesAt(placed);
    const usedRegion = new Set(placed.map((q) => regionMap[q.row][q.col]));
    let target = null;
    for (let region = 0; region < size; region++) {
      if (usedRegion.has(region)) continue;
      const cells = [];
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          if (possible[row][col] && regionMap[row][col] === region) cells.push({ row, col });
        }
      }
      if (target === null || cells.length < target.length) target = cells;
    }
    if (target === null) return null;
    for (const cell of target) {
      const result = solve([...placed, cell], depth2 + 1);
      if (result !== null) return result;
      backtracks++;
    }
    return null;
  };
  const depth = solve([], 0);
  return { depth: depth ?? 0, nodes, backtracks };
}

// src/lib/solver/rng.ts
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randInt(rng, n) {
  return Math.floor(rng() * n);
}
function shuffledRange(rng, n) {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// src/lib/solver/generate.ts
var DEFAULTS = {
  irregularityBias: 0.5,
  maxRestarts: 120,
  maxRegrowsPerPlacement: 16,
  maxTierAttempts: 40
};
var MAX_REPAIRS = 400;
var TIER_BIAS = {
  Intro: 0,
  Easy: 0.2,
  Medium: 0.45,
  Hard: 0.7,
  Expert: 0.9
};
function generatePuzzle(size, options = {}) {
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
      const unique = repairToUnique(size, placement, regionMap, rng);
      if (unique) return assemble(size, placement, unique, seed);
    }
  }
  throw new Error(
    `generatePuzzle: no unique board found for size ${size} within ${maxRestarts} restarts. This should not happen for sizes 7\u201311; treat it as a bug, not a tuning problem (issue #20).`
  );
}
function generate(size, targetTier, options = {}) {
  const baseSeed = options.seed ?? defaultSeed();
  const bias = options.irregularityBias ?? TIER_BIAS[targetTier];
  const maxAttempts = options.maxTierAttempts ?? DEFAULTS.maxTierAttempts;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const subSeed = mixSeed(baseSeed, attempt);
    const puzzle = generatePuzzle(size, { ...options, seed: subSeed, irregularityBias: bias });
    if (puzzle.public.tier === targetTier) return puzzle;
  }
  return null;
}
function assemble(size, placement, regionMap, seed) {
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
function samplePlacement(size, rng) {
  const cols = new Array(size).fill(-1);
  const usedCol = new Array(size).fill(false);
  const place = (row) => {
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
function growRegions(size, placement, rng, bias) {
  const region = Array.from({ length: size }, () => new Array(size).fill(-1));
  const sizes = new Array(size).fill(1);
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
    const frontier = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (region[row][col] !== -1) continue;
        const seen = /* @__PURE__ */ new Set();
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
    let choice;
    if (rng() < bias) {
      choice = frontier[randInt(rng, frontier.length)];
    } else {
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
function repairToUnique(size, placement, grown, rng) {
  const map = grown.map((row) => [...row]);
  const seedKeys = new Set(placement.map((c) => `${c.row},${c.col}`));
  const hiddenCols = new Array(size).fill(-1);
  for (const { row, col } of placement) hiddenCols[row] = col;
  for (let step = 0; step < MAX_REPAIRS; step++) {
    const solutions = collectSolutions(map, 2);
    if (solutions.length <= 1) return map;
    const rival = solutions.find((sol) => sol.some((cell) => cell.col !== hiddenCols[cell.row])) ?? null;
    if (!rival) return map;
    if (!breakRival(size, map, rival, seedKeys, rng)) return null;
  }
  return collectSolutions(map, 2).length === 1 ? map : null;
}
function breakRival(size, map, rival, seedKeys, rng) {
  const neighbours = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
  ];
  for (const idx of shuffledRange(rng, rival.length)) {
    const { row, col } = rival[idx];
    if (seedKeys.has(`${row},${col}`)) continue;
    const from = map[row][col];
    const adjacent = /* @__PURE__ */ new Set();
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
      if (regionIsContiguous(size, map, from)) return true;
      map[row][col] = from;
    }
  }
  return false;
}
function regionIsContiguous(size, map, region) {
  const cells = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (map[row][col] === region) cells.push({ row, col });
    }
  }
  if (cells.length === 0) return false;
  const key = (c) => c.row * size + c.col;
  const all = new Set(cells.map(key));
  const seen = /* @__PURE__ */ new Set([key(cells[0])]);
  const stack = [cells[0]];
  while (stack.length) {
    const { row, col } = stack.pop();
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
function defaultSeed() {
  return (Date.now() ^ Math.random() * 4294967296) >>> 0;
}
function mixSeed(seed, attempt) {
  let x = (seed ^ attempt * 2654435769) >>> 0;
  x = Math.imul(x ^ x >>> 16, 73244475) >>> 0;
  x = Math.imul(x ^ x >>> 16, 73244475) >>> 0;
  return (x ^ x >>> 16) >>> 0;
}

// src/lib/solver/replay.ts
function replayMoveLog(regionMap, moveLog) {
  const size = regionMap.length;
  const board = Array.from(
    { length: size },
    () => Array.from({ length: size }, () => "empty")
  );
  let mistakes = 0;
  for (const move of moveLog) {
    if (!inBounds(move.row, move.col, size)) continue;
    board[move.row][move.col] = move.to;
    if (move.to === "queen" && placedIntoConflict(board, regionMap, move.row, move.col)) {
      mistakes++;
    }
  }
  return { finalBoard: board, mistakes };
}
function inBounds(row, col, size) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < size && col >= 0 && col < size;
}
function placedIntoConflict(board, regionMap, row, col) {
  return checkRules(board, regionMap).conflicts.some((c) => c.row === row && c.col === col);
}

// src/lib/solver/submit-decision.ts
function decideSubmission(input) {
  const { solved } = checkRules(input.finalBoard, input.regionMap);
  if (!solved) {
    return { outcome: "reject", reason: "illegal-board" };
  }
  const elapsedMs = Math.max(0, input.submittedAt - input.startedAt);
  const stale = input.submittedAt - input.lastActivityAt > input.staleAfterMs;
  const replayed = replayMoveLog(input.regionMap, input.moveLog);
  const unverified = !boardsEqual(replayed.finalBoard, input.finalBoard);
  return {
    outcome: "accept",
    elapsedMs,
    mistakes: unverified ? null : replayed.mistakes,
    stale,
    unverified,
    replay: input.priorCompletedExists
  };
}
function boardsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let row = 0; row < a.length; row++) {
    if (a[row].length !== b[row].length) return false;
    for (let col = 0; col < a[row].length; col++) {
      if (a[row][col] !== b[row][col]) return false;
    }
  }
  return true;
}
export {
  DIFFICULTY_TIERS,
  GENERATOR_VERSION,
  MOVE_LOG_FORMAT_VERSION,
  boardHash,
  checkRules,
  countSolutions,
  decideSubmission,
  extractSignals,
  generate,
  generatePuzzle,
  isAdjacent,
  replayMoveLog,
  scoreDifficulty,
  tierForScore
};
