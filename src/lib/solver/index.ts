/**
 * The shared TypeScript solver core.
 *
 * A pure library — no I/O, no framework, no Supabase import — consumed by the
 * offline generator, the client's live conflict highlighting and the server's
 * submission replay. This module is the single import surface; consumers import
 * from `$lib/solver`, not the files behind it.
 *
 * Ticket #19 delivered the shared vocabulary plus the two rule-level functions,
 * {@link checkRules} and {@link countSolutions}. Ticket #20 adds the generation
 * half: {@link generate}/{@link generatePuzzle}, difficulty scoring, and the
 * canonical {@link boardHash}. Ticket #23 adds the server's replay half:
 * {@link replayMoveLog} and {@link decideSubmission}, which the submit Edge
 * Function runs against these same types.
 */

export type { Board, Cell, CellState, Move, MoveLog, RegionMap } from './types';
export { GENERATOR_VERSION, MOVE_LOG_FORMAT_VERSION } from './version';
export { isAdjacent } from './adjacency';
export { checkRules, type RuleCheck, type Violations } from './check-rules';
export { countSolutions } from './count-solutions';
export {
	generate,
	generatePuzzle,
	type GeneratedPuzzle,
	type PuzzlePublic,
	type PuzzleSecret,
	type GenerateOptions,
	type GeneratePuzzleOptions
} from './generate';
export {
	scoreDifficulty,
	tierForScore,
	DIFFICULTY_TIERS,
	type DifficultyTier,
	type DifficultySignals,
	type DifficultyResult
} from './difficulty';
export { extractSignals } from './signals';
export { boardHash } from './hash';
export { replayMoveLog, type ReplayResult } from './replay';
export {
	decideSubmission,
	type SubmissionInput,
	type SubmissionDecision,
	type SubmissionAccepted,
	type SubmissionRejected
} from './submit-decision';
