/**
 * The shared TypeScript solver core.
 *
 * A pure library — no I/O, no framework, no Supabase import — consumed by the
 * offline generator, the client's live conflict highlighting and the server's
 * submission replay. This module is the single import surface; consumers import
 * from `$lib/solver`, not the files behind it.
 *
 * This ticket (#19) delivers the shared vocabulary plus the two rule-level
 * functions: {@link checkRules} and {@link countSolutions}. The generation and
 * replay halves land later against these same types.
 */

export type { Board, Cell, CellState, Move, MoveLog, RegionMap } from './types';
export { GENERATOR_VERSION, MOVE_LOG_FORMAT_VERSION } from './version';
export { isAdjacent } from './adjacency';
export { checkRules, type RuleCheck, type Violations } from './check-rules';
export { countSolutions } from './count-solutions';
