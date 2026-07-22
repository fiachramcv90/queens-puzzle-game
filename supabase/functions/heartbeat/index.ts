// heartbeat(token) — liveness only, sent every 15–30s while the tab is visible.
//
// It touches last_heartbeat_at and nothing else. It deliberately does NOT affect
// time: credited time is wall-clock at submit, and any client-triggerable time
// effect inverts into a cheat (go quiet, solve on paper, come back). Silence past
// the stale window is handled at submit, not here.
//
// An unknown or already-completed token is not an error the client should act on,
// so it returns 200 with `alive: false` rather than a failure.

import { adminClient } from '../_shared/admin.ts';
import { isUuid } from '../_shared/owner.ts';
import { json, preflight, readJsonBody } from '../_shared/http.ts';

interface HeartbeatBody {
	token?: unknown;
}

Deno.serve(async (req) => {
	const pre = preflight(req);
	if (pre) return pre;

	const body = await readJsonBody<HeartbeatBody>(req);
	if ('error' in body) return body.error;

	if (!isUuid(body.token)) {
		return json({ error: 'a token UUID is required' }, 400);
	}

	const admin = adminClient();
	const { data, error } = await admin.rpc('heartbeat_play', { p_token: body.token });
	if (error) {
		console.error('heartbeat_play failed', error);
		return json({ error: 'heartbeat failed' }, 500);
	}

	return json({ alive: data === true });
});
