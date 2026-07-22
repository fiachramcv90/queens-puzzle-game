import { checkRules } from './check-rules';
import { replayMoveLog } from './replay';
import type { Board, MoveLog, RegionMap } from './types';

/**
 * Everything the server knows at submit time, from its own clocks and the
 * client's payload. The clocks (`startedAt`, `submittedAt`, `lastActivityAt`) are
 * all server-authoritative — no client-reported duration appears here, by design:
 * there is no field through which a client could lower its credited time.
 */
export interface SubmissionInput {
	readonly regionMap: RegionMap;
	/** The board the client submitted as its solve. */
	readonly finalBoard: Board;
	/** The client's move log, replayed to derive mistakes and to verify the board. */
	readonly moveLog: MoveLog;
	/** Epoch ms the play started, from the server clock at `start`. */
	readonly startedAt: number;
	/** Epoch ms the submit arrived, from the server clock now. */
	readonly submittedAt: number;
	/** Epoch ms of the last heartbeat (or the start, if none beat yet). */
	readonly lastActivityAt: number;
	/** Silence beyond this marks the play stale. From config, not code. */
	readonly staleAfterMs: number;
	/** Whether a completed play already exists for this identity and daily. */
	readonly priorCompletedExists: boolean;
}

/** The board was not a legal, complete solution — reject, record nothing. */
export interface SubmissionRejected {
	readonly outcome: 'reject';
	readonly reason: 'illegal-board';
}

/** The solve is accepted; these are the values to persist on the play row. */
export interface SubmissionAccepted {
	readonly outcome: 'accept';
	/** Credited time: wall-clock `submittedAt - startedAt`, floored at zero. */
	readonly elapsedMs: number;
	/** Server-derived mistake count, or null when the solve could not be verified. */
	readonly mistakes: number | null;
	/** No heartbeat within the stale window: still counts, drops out of ranking. */
	readonly stale: boolean;
	/** The move log did not reconstruct the submitted board — a deploy alarm as much as a cheat. */
	readonly unverified: boolean;
	/** A later attempt at a daily already solved once: practice, no ranking. */
	readonly replay: boolean;
}

export type SubmissionDecision = SubmissionRejected | SubmissionAccepted;

/**
 * Decide a submission's fate from server-authoritative inputs alone.
 *
 * The gate is board legality: because generation guarantees a unique solution, a
 * rules-legal complete board *is* the solution, checked directly against the
 * public region map (which cannot version-skew). An illegal board is rejected and
 * nothing is recorded. A legal board is always accepted — history and streak are
 * preserved even when replay can't verify it.
 *
 * On acceptance:
 * - **Credited time** is `submittedAt - startedAt`, floored at zero. There is no
 *   idle deduction and no client-supplied duration in the inputs, so nothing the
 *   client sends can lower it.
 * - **Mistakes** come from replaying the move log ({@link replayMoveLog}); the
 *   client's own count is never read. If the replayed board does not match the
 *   submitted one, the solve is flagged `unverified` and mistakes is null.
 * - **Stale** iff no activity within `staleAfterMs` of submit — the play still
 *   completes and still counts for the streak, it only leaves ranking.
 * - **Replay** iff a completed play already exists for this identity and daily.
 */
export function decideSubmission(input: SubmissionInput): SubmissionDecision {
	const { solved } = checkRules(input.finalBoard, input.regionMap);
	if (!solved) {
		return { outcome: 'reject', reason: 'illegal-board' };
	}

	const elapsedMs = Math.max(0, input.submittedAt - input.startedAt);
	const stale = input.submittedAt - input.lastActivityAt > input.staleAfterMs;

	const replayed = replayMoveLog(input.regionMap, input.moveLog);
	const unverified = !boardsEqual(replayed.finalBoard, input.finalBoard);

	return {
		outcome: 'accept',
		elapsedMs,
		mistakes: unverified ? null : replayed.mistakes,
		stale,
		unverified,
		replay: input.priorCompletedExists
	};
}

/** Cell-by-cell board equality; the boards are always the same N×N here. */
function boardsEqual(a: Board, b: Board): boolean {
	if (a.length !== b.length) return false;
	for (let row = 0; row < a.length; row++) {
		if (a[row].length !== b[row].length) return false;
		for (let col = 0; col < a[row].length; col++) {
			if (a[row][col] !== b[row][col]) return false;
		}
	}
	return true;
}
