// assist(token) — charge the play for a hint that computes on the client.
//
// Two of the three hints need no server help to RUN: the mistake check flags cells
// breaking a stated rule right now, and auto-mark-X fills cells ruled out by
// row/column/region/adjacency. Both work from the public region_map, so neither
// ships a solution and neither needs a round trip to do its job.
//
// They still need this round trip to be HONEST. The spec's hard constraint is that
// `assisted` is server-set, never client-confessed — otherwise a client simply
// takes the help and declines to mention it, and the ranked/assisted split is
// decorative. So the client computes the hint locally and calls this to record it.
//
// Yes, a modified client could take those two hints without calling this. That is
// the accepted posture: defend hard against casual tampering, and treat a determined
// paper-solve as unfixable while the board renders client-side. What this closes is
// the far cheaper hole where the UNMODIFIED app hands out help for free — and the
// reveal oracle, the one hint that genuinely cannot be had without the server, is
// charged in `reveal` where it cannot be dodged at all.

import { adminClient } from '../_shared/admin.ts';
import { isUuid } from '../_shared/owner.ts';
import { json, preflight, readJsonBody } from '../_shared/http.ts';

interface AssistBody {
	token?: unknown;
}

Deno.serve(async (req) => {
	const pre = preflight(req);
	if (pre) return pre;

	const body = await readJsonBody<AssistBody>(req);
	if ('error' in body) return body.error;

	if (!isUuid(body.token)) {
		return json({ error: 'a token UUID is required' }, 400);
	}

	const admin = adminClient();
	const { data, error } = await admin.rpc('mark_play_assisted', { p_token: body.token });
	if (error) {
		console.error('mark_play_assisted failed', error);
		return json({ error: 'could not record the hint' }, 500);
	}

	const flag = (Array.isArray(data) ? data[0] : data) as {
		status: string;
		assisted: boolean;
		hints_used: number;
	};

	if (flag.status === 'unknown') return json({ error: 'unknown play token' }, 404);
	if (flag.status === 'already-submitted') {
		return json({ error: 'that play is already submitted' }, 409);
	}

	return json({ assisted: flag.assisted, hintsUsed: flag.hints_used });
});
