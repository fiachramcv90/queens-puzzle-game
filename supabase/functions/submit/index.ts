// submit(token, finalBoard, moveLog) — rule-check the solve and record the result.
//
// The single source of the *decision* is the shared solver core (decideSubmission):
// board legality against the public region_map, wall-clock credited time with no
// deduction path, mistakes replayed from the move log, and the stale / unverified /
// replay flags. This function is only the I/O around it — resolve the token, run
// the decision, and (on acceptance) close the play atomically with complete_play.
//
// Failure policy the spec is emphatic about: never let our bug eat a real solve.
//   - Hard-invalid (illegal board; unknown / already-submitted / wrong-puzzle
//     token) → reject, record nothing.
//   - Replay mismatch → still accept the solve, flag unverified, store mistakes
//     null. Board legality is checked directly against region_map and cannot skew,
//     so a legal final board always counts.

import { decideSubmission } from '../_shared/solver.bundle.js';
import { heartbeat } from '../_shared/config.bundle.js';
import type { Board, MoveLog, RegionMap } from '../_shared/solver.bundle.js';
import { MOVE_LOG_FORMAT_VERSION } from '../_shared/solver.bundle.js';
import { adminClient } from '../_shared/admin.ts';
import { isUuid } from '../_shared/owner.ts';
import { json, preflight, readJsonBody } from '../_shared/http.ts';

interface SubmitBody {
	token?: unknown;
	puzzleId?: unknown;
	finalBoard?: unknown;
	moveLog?: unknown;
}

interface LoadedPlay {
	status: 'ok' | 'unknown' | 'already-submitted' | 'wrong-puzzle';
	play_id: string | null;
	puzzle_date: string | null;
	started_at: string | null;
	last_heartbeat_at: string | null;
	region_map: RegionMap | string | null;
	prior_completed_exists: boolean | null;
}

/**
 * The DB→domain boundary for the region map. jsonb should arrive already parsed,
 * but a value stored as a JSON string is parsed here rather than trusted to be an
 * array — the same anti-corruption guard the page loader applies, so a storage
 * quirk can never reach the rule check.
 */
function asRegionMap(value: RegionMap | string): RegionMap {
	return typeof value === 'string' ? (JSON.parse(value) as RegionMap) : value;
}

Deno.serve(async (req) => {
	const pre = preflight(req);
	if (pre) return pre;

	const body = await readJsonBody<SubmitBody>(req);
	if ('error' in body) return body.error;

	if (!isUuid(body.token)) return json({ error: 'a token UUID is required' }, 400);
	if (!isUuid(body.puzzleId)) return json({ error: 'a puzzleId UUID is required' }, 400);
	if (!Array.isArray(body.finalBoard)) return json({ error: 'finalBoard is required' }, 400);
	if (!Array.isArray(body.moveLog)) return json({ error: 'moveLog is required' }, 400);

	const finalBoard = body.finalBoard as Board;
	const moveLog = body.moveLog as MoveLog;

	const admin = adminClient();

	const { data, error } = await admin.rpc('load_play_for_submit', {
		p_token: body.token,
		p_puzzle_id: body.puzzleId
	});
	if (error) {
		console.error('load_play_for_submit failed', error);
		return json({ error: 'could not load play' }, 500);
	}

	const loaded = (Array.isArray(data) ? data[0] : data) as LoadedPlay | undefined;
	if (!loaded) return json({ error: 'unknown token' }, 404);

	// Hard-invalid tokens: reject, record nothing.
	switch (loaded.status) {
		case 'unknown':
			return json({ error: 'unknown token' }, 404);
		case 'already-submitted':
			return json({ error: 'this play was already submitted' }, 409);
		case 'wrong-puzzle':
			return json({ error: 'token is for a different puzzle' }, 409);
	}

	const regionMap = asRegionMap(loaded.region_map as RegionMap | string);

	const decision = decideSubmission({
		regionMap,
		finalBoard,
		moveLog,
		startedAt: Date.parse(loaded.started_at as string),
		submittedAt: Date.now(),
		lastActivityAt: Date.parse(loaded.last_heartbeat_at as string),
		staleAfterMs: heartbeat.staleAfterMs,
		priorCompletedExists: loaded.prior_completed_exists === true
	});

	// Illegal board → reject, record nothing.
	if (decision.outcome === 'reject') {
		return json({ error: 'that board is not a legal solution' }, 422);
	}

	const { data: completed, error: completeError } = await admin.rpc('complete_play', {
		p_token: body.token,
		p_elapsed_ms: decision.elapsedMs,
		p_mistakes: decision.mistakes,
		p_stale: decision.stale,
		p_unverified: decision.unverified,
		p_replay: decision.replay,
		p_move_log: moveLog,
		p_format_version: MOVE_LOG_FORMAT_VERSION
	});
	if (completeError) {
		// A duplicate submit that raced the first lands here (already submitted).
		if (completeError.code === '23505' || /already submitted/i.test(completeError.message)) {
			return json({ error: 'this play was already submitted' }, 409);
		}
		console.error('complete_play failed', completeError);
		return json({ error: 'could not record the solve' }, 500);
	}

	const play = completed as {
		elapsed_ms: number;
		mistakes: number | null;
		stale: boolean;
		unverified: boolean;
		replay: boolean;
		attempt_no: number;
		completed_at: string;
	};

	// The result screen shows time and mistakes exactly as the server recorded them.
	return json({
		elapsedMs: Number(play.elapsed_ms),
		mistakes: play.mistakes,
		stale: play.stale,
		unverified: play.unverified,
		replay: play.replay,
		attemptNo: play.attempt_no,
		completedAt: play.completed_at
	});
});
