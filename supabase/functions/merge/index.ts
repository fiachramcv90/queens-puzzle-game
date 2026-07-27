// merge(guestId) — silently fold a guest's play history onto the signed-in account.
//
// Runs on the first authenticated session after guest play, with no prompt and no
// opt-in. The client POSTs the guest UUID from its localStorage blob; this function
// resolves the USER id from the verified session token (never from the body — that
// is what stops one account claiming another's), and calls merge_guest_plays, which
// does the transactional re-key and the ranked/replay bookkeeping.
//
// Idempotent: merge_guest_plays consumes the guest's rows, so a repeat call merges
// nothing and returns 0. That is what lets the client drive this from an "unmerged"
// flag and retry safely on the next authenticated load after a failure or an offline
// attempt — running it twice equals running it once.
//
// verify_jwt is ON for this function (see config.toml): unlike start/heartbeat/submit
// it is NOT guest-capable, so an anonymous call is rejected at the gateway before it
// arrives here.

import { adminClient } from '../_shared/admin.ts';
import { isUuid, resolveUserId } from '../_shared/owner.ts';
import { json, preflight, readJsonBody } from '../_shared/http.ts';

interface MergeBody {
	guestId?: unknown;
}

Deno.serve(async (req) => {
	const pre = preflight(req);
	if (pre) return pre;

	const body = await readJsonBody<MergeBody>(req);
	if ('error' in body) return body.error;

	if (!isUuid(body.guestId)) {
		return json({ error: 'a guestId UUID is required' }, 400);
	}

	// The one caller that cannot fall back to a guest: without an account there is
	// nothing to merge ONTO. verify_jwt has already rejected an anonymous call at the
	// gateway, so reaching this is a token that parsed but resolves to no user.
	const userId = await resolveUserId(req);
	if (!userId) {
		return json({ error: 'a valid session is required to merge' }, 401);
	}

	const admin = adminClient();
	const { data, error } = await admin.rpc('merge_guest_plays', {
		p_user_id: userId,
		p_guest_id: body.guestId
	});
	if (error) {
		console.error('merge_guest_plays failed', error);
		return json({ error: 'could not merge guest history' }, 500);
	}

	// The count of re-keyed plays. The client only needs to know the merge succeeded
	// so it can clear its "unmerged" flag; the number is returned for observability.
	return json({ merged: typeof data === 'number' ? data : 0 });
});
