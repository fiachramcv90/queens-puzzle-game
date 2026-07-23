// start(puzzleDate) — the only way a play begins.
//
// Writes started_at from the SERVER clock (inside start_play), assigns attempt_no
// per identity and daily, and hands back an opaque play token. One open play per
// identity per date is enforced in the database, so a reload returns the same
// token and the same started_at rather than resetting the timer. Guest-capable:
// no session required, keyed by the guest UUID in the body.

import { adminClient } from '../_shared/admin.ts';
import { isUuid } from '../_shared/owner.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { json, preflight, readJsonBody } from '../_shared/http.ts';

interface StartBody {
	puzzleDate?: unknown;
	guestId?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
	const pre = preflight(req);
	if (pre) return pre;

	const body = await readJsonBody<StartBody>(req);
	if ('error' in body) return body.error;

	if (typeof body.puzzleDate !== 'string' || !DATE_RE.test(body.puzzleDate)) {
		return json({ error: 'puzzleDate (YYYY-MM-DD) is required' }, 400);
	}
	if (!isUuid(body.guestId)) {
		return json({ error: 'a guestId UUID is required' }, 400);
	}

	const admin = adminClient();

	// Per-identity cap, enforced here so a direct call cannot skip it and a cold
	// start cannot forget it. Numbers come from config via the shared helper.
	const limited = await enforceRateLimit(admin, 'start', body.guestId);
	if (limited) return limited;

	const { data, error } = await admin.rpc('start_play', {
		p_puzzle_date: body.puzzleDate,
		p_user_id: null,
		p_guest_id: body.guestId
	});

	if (error) {
		// No visible daily for that date is the one expected failure — a future or
		// unscheduled date. Everything else is a 500.
		if (error.code === 'P0002' || /no daily scheduled/i.test(error.message)) {
			return json({ error: 'no daily is available for that date' }, 404);
		}
		console.error('start_play failed', error);
		return json({ error: 'could not start play' }, 500);
	}

	// start_play returns the plays row (composite). The client needs only the token
	// to hold and the server's authoritative start for its display timer; attempt_no
	// surfaces on the result screen from `submit`, so it is not echoed here.
	const play = data as { token: string; started_at: string };
	return json({
		token: play.token,
		startedAt: play.started_at
	});
});
