// start(puzzleDate) — the only way a play begins.
//
// Writes started_at from the SERVER clock (inside start_play), assigns attempt_no
// per identity and daily, and hands back an opaque play token. One open play per
// identity per date is enforced in the database, so a reload returns the same
// token and the same started_at rather than resetting the timer.
//
// Guest-capable but not guest-ONLY: the play is keyed to the signed-in user when the
// request carries a session, and to the guest UUID in the body when it does not. That
// choice is made here, at creation, because it is the only moment it is cheap. A play
// created under the wrong identity is not merely mislabelled — it is missing from the
// account's streak and shows on the leaderboard as "Guest" — and the merge that folds
// guest history onto an account runs at SIGN-IN, so it cannot reach anything created
// after it. See _shared/owner.ts for why the user id comes from the token alone.

import { adminClient } from '../_shared/admin.ts';
import { isUuid, resolveUserId } from '../_shared/owner.ts';
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

	// Whose play this is. A session wins outright: the guest id in the body is not
	// consulted at all for a signed-in caller, so a stale or borrowed one cannot
	// redirect the play onto another identity.
	const userId = await resolveUserId(req);
	if (userId === null && !isUuid(body.guestId)) {
		return json({ error: 'a guestId UUID is required' }, 400);
	}

	// start_play enforces `exactly one of user_id or guest_id`, so these two are a
	// pair: whichever identity did not resolve is passed as null.
	const guestId = userId === null ? (body.guestId as string) : null;

	const admin = adminClient();

	// Per-identity cap, enforced here so a direct call cannot skip it and a cold
	// start cannot forget it. Keyed on whichever identity actually owns the play, so
	// signing in neither resets a guest's budget nor inherits it. Numbers come from
	// config via the shared helper.
	const limited = await enforceRateLimit(admin, 'start', userId ?? (guestId as string));
	if (limited) return limited;

	const { data, error } = await admin.rpc('start_play', {
		p_puzzle_date: body.puzzleDate,
		p_user_id: userId,
		p_guest_id: guestId
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
