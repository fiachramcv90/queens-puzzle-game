// reveal(token, board) — hand back the next correct cell, and charge the play for it.
//
// A server round-trip rather than a client solver, for three reasons the spec is
// explicit about: the solution stays server-only, it works from ANY board state
// including a corrupted one, and it doubles as a validation seam.
//
// The order below is load → choose → mark, and it matters. `assisted` is charged
// only once a cell has actually been produced: a load that fails, or a board with
// nothing left to reveal, must never cost the player their ranking for a hint they
// did not receive.
//
// `assisted` is set HERE, server-side. That is the whole hinge of the ranked/assisted
// split — a client-confessed flag would make this oracle free, since a cheat would
// simply not confess.

import { nextReveal } from '../_shared/solver.bundle.js';
import type { Board, Cell } from '../_shared/solver.bundle.js';
import { adminClient } from '../_shared/admin.ts';
import { isUuid } from '../_shared/owner.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { json, preflight, readJsonBody } from '../_shared/http.ts';

interface RevealBody {
	token?: unknown;
	board?: unknown;
}

interface LoadedForReveal {
	status: 'ok' | 'unknown' | 'already-submitted';
	play_id: string | null;
	board_size: number | null;
	region_map: unknown;
	solution: readonly Cell[] | string | null;
}

/**
 * The DB→domain boundary for the solution. jsonb should arrive parsed, but a value
 * stored as a JSON string is parsed rather than trusted — the same anti-corruption
 * guard `submit` applies to the region map.
 */
function asSolution(value: readonly Cell[] | string): readonly Cell[] {
	return typeof value === 'string' ? (JSON.parse(value) as Cell[]) : value;
}

Deno.serve(async (req) => {
	const pre = preflight(req);
	if (pre) return pre;

	const body = await readJsonBody<RevealBody>(req);
	if ('error' in body) return body.error;

	if (!isUuid(body.token)) {
		return json({ error: 'a token UUID is required' }, 400);
	}
	if (!Array.isArray(body.board)) {
		return json({ error: 'board is required' }, 400);
	}

	const admin = adminClient();

	// ~1 per 2s per PLAY (not per identity): the cap exists to stop a script
	// walking the whole solution out of the oracle in one burst, and that attack is
	// per-play. Hints are unlimited once assisted, so this throttles, never refuses
	// outright — a player taking hints deliberately just waits a beat.
	const limited = await enforceRateLimit(admin, 'reveal', body.token);
	if (limited) return limited;

	const { data, error } = await admin.rpc('load_play_for_reveal', { p_token: body.token });
	if (error) {
		console.error('load_play_for_reveal failed', error);
		return json({ error: 'could not load the play' }, 500);
	}

	const loaded = (Array.isArray(data) ? data[0] : data) as LoadedForReveal | undefined;
	if (!loaded || loaded.status === 'unknown') {
		return json({ error: 'unknown play token' }, 404);
	}
	if (loaded.status === 'already-submitted') {
		return json({ error: 'that play is already submitted' }, 409);
	}
	if (loaded.solution === null) {
		console.error('reveal: play has no stored solution', loaded.play_id);
		return json({ error: 'could not load the play' }, 500);
	}

	const cell = nextReveal(body.board as Board, asSolution(loaded.solution));
	if (!cell) {
		// Every solution queen is already placed. Nothing to reveal, and — deliberately
		// — nothing charged: the player asked for help that did not exist.
		return json({ cell: null, assisted: false, hintsUsed: null });
	}

	const marked = await admin.rpc('mark_play_assisted', { p_token: body.token });
	if (marked.error) {
		// The flag is the thing that keeps the split honest, so a failure to set it
		// must NOT still hand over the cell — that would be a free oracle.
		console.error('mark_play_assisted failed', marked.error);
		return json({ error: 'could not record the hint' }, 500);
	}

	const flag = (Array.isArray(marked.data) ? marked.data[0] : marked.data) as {
		status: string;
		assisted: boolean;
		hints_used: number;
	};

	return json({ cell, assisted: flag.assisted, hintsUsed: flag.hints_used });
});
