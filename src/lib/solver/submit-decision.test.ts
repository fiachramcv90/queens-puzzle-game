import { describe, expect, test } from 'vitest';
import { decideSubmission } from './submit-decision';
import type { Board, CellState, MoveLog, RegionMap } from './types';

/**
 * The pure heart of the submit path: given a submitted board, its move log, and
 * the server's own clocks, decide whether the solve is accepted and with what
 * flags. No database, no network — so every rule the spec calls out can be pinned
 * exactly. Token validity is the caller's job; this assumes a real, open play.
 */

const REGIONS_4: RegionMap = [
	[0, 1, 2, 3],
	[0, 1, 2, 3],
	[0, 1, 2, 3],
	[0, 1, 2, 3]
];

// Unique legal solution for REGIONS_4: (0,1) (1,3) (2,0) (3,2).
const SOLUTION: ReadonlyArray<readonly [number, number]> = [
	[0, 1],
	[1, 3],
	[2, 0],
	[3, 2]
];

function boardFrom(queens: ReadonlyArray<readonly [number, number]>): Board {
	const board: CellState[][] = Array.from({ length: 4 }, () =>
		Array.from({ length: 4 }, (): CellState => 'empty')
	);
	for (const [r, c] of queens) board[r][c] = 'queen';
	return board;
}

function solveLog(): MoveLog {
	return SOLUTION.map(([r, c], i) => ({ t: i * 1000, row: r, col: c, to: 'queen' as CellState }));
}

const SOLVED_BOARD = boardFrom(SOLUTION);

/** A baseline accepted submission 60s long, fresh heartbeat, first attempt. */
function baseInput() {
	return {
		regionMap: REGIONS_4,
		finalBoard: SOLVED_BOARD,
		moveLog: solveLog(),
		startedAt: 1_000_000,
		submittedAt: 1_060_000, // 60s later
		lastActivityAt: 1_059_000, // beat 1s before submit
		staleAfterMs: 30 * 60 * 1000,
		priorCompletedExists: false
	};
}

describe('legality gate', () => {
	test('an illegal final board is rejected and records nothing', () => {
		const decision = decideSubmission({
			...baseInput(),
			finalBoard: boardFrom([
				[0, 0],
				[1, 1]
			]) // two queens in column 0, illegal
		});
		expect(decision.outcome).toBe('reject');
	});

	test('a legal complete board is accepted', () => {
		expect(decideSubmission(baseInput()).outcome).toBe('accept');
	});
});

describe('credited time is wall-clock, never client-influenced', () => {
	test('elapsed equals submittedAt - startedAt', () => {
		const decision = decideSubmission(baseInput());
		expect(decision.outcome === 'accept' && decision.elapsedMs).toBe(60_000);
	});

	test('a move log claiming a tiny final timestamp cannot lower the credited time', () => {
		const decision = decideSubmission({
			...baseInput(),
			// Every move claims t=0 — a client pretending it solved instantly.
			moveLog: SOLUTION.map(([r, c]) => ({ t: 0, row: r, col: c, to: 'queen' as CellState }))
		});
		expect(decision.outcome === 'accept' && decision.elapsedMs).toBe(60_000);
	});

	test('never negative even if clocks are odd', () => {
		const decision = decideSubmission({ ...baseInput(), submittedAt: 999_999 });
		expect(decision.outcome === 'accept' && decision.elapsedMs).toBe(0);
	});
});

describe('mistakes are server-derived', () => {
	test('a clean solve records zero mistakes', () => {
		const decision = decideSubmission(baseInput());
		expect(decision.outcome === 'accept' && decision.mistakes).toBe(0);
	});

	test('a mid-solve conflict is counted from the log, not from any client value', () => {
		// Place (0,0) [not in the solution], collide, remove it, then solve cleanly.
		const log: MoveLog = [
			{ t: 0, row: 0, col: 0, to: 'queen' },
			{ t: 1, row: 1, col: 0, to: 'queen' }, // column conflict → 1 mistake
			{ t: 2, row: 1, col: 0, to: 'empty' },
			{ t: 3, row: 0, col: 0, to: 'empty' },
			...SOLUTION.map(([r, c], i) => ({ t: 10 + i, row: r, col: c, to: 'queen' as CellState }))
		];
		const decision = decideSubmission({ ...baseInput(), moveLog: log });
		expect(decision.outcome === 'accept' && decision.mistakes).toBe(1);
	});
});

describe('unverified: replay mismatch still accepts the solve', () => {
	test('a log that does not reconstruct the submitted board flags unverified and nulls mistakes', () => {
		const decision = decideSubmission({
			...baseInput(),
			moveLog: [{ t: 0, row: 0, col: 0, to: 'queen' }] // reconstructs a different board
		});
		if (decision.outcome !== 'accept') throw new Error('expected accept');
		expect(decision.unverified).toBe(true);
		expect(decision.mistakes).toBeNull();
	});

	test('a matching log is verified with a real mistake count', () => {
		const decision = decideSubmission(baseInput());
		if (decision.outcome !== 'accept') throw new Error('expected accept');
		expect(decision.unverified).toBe(false);
		expect(decision.mistakes).toBe(0);
	});
});

describe('stale: long silence drops ranking but still completes', () => {
	test('no activity past the stale window flags stale', () => {
		const decision = decideSubmission({
			...baseInput(),
			lastActivityAt: 1_000_000, // last beat at start
			submittedAt: 1_000_000 + 31 * 60 * 1000 // 31 minutes of silence
		});
		expect(decision.outcome === 'accept' && decision.stale).toBe(true);
	});

	test('activity within the window is not stale', () => {
		const decision = decideSubmission(baseInput());
		if (decision.outcome !== 'accept') throw new Error('expected accept');
		expect(decision.stale).toBe(false);
	});
});

describe('first-play-only ranking', () => {
	test('with no prior completed play, replay is false', () => {
		const decision = decideSubmission(baseInput());
		if (decision.outcome !== 'accept') throw new Error('expected accept');
		expect(decision.replay).toBe(false);
	});

	test('a prior completed play flags this one as replay', () => {
		const decision = decideSubmission({ ...baseInput(), priorCompletedExists: true });
		expect(decision.outcome === 'accept' && decision.replay).toBe(true);
	});
});
