/**
 * The network call behind the guest merge, kept apart from the orchestration in
 * `merge.ts` so that module stays a pure, Svelte-free state machine.
 *
 * It POSTs to the same-origin `/api/play/merge` proxy, which forwards the call to the
 * merge Edge Function carrying the session token. The user id the merge is keyed to
 * comes from that verified token on the server, never from this body — the guest id
 * is all the client supplies.
 */

import type { FetchLike } from '$lib/game/play-client';
import { PlayRequestError } from '$lib/game/play-client';

/**
 * Fold this guest's server-side play history onto the signed-in account. Resolves
 * with the number of plays re-keyed (0 when there was nothing to merge). Throws a
 * {@link PlayRequestError} on a non-2xx, which `syncGuestMerge` treats as "retry
 * next load".
 */
export async function mergeGuestPlays(
	guestId: string,
	accessToken: string,
	fetchImpl: FetchLike = fetch
): Promise<number> {
	const res = await fetchImpl('/api/play/merge', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${accessToken}`
		},
		body: JSON.stringify({ guestId })
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new PlayRequestError('merge', res.status, detail);
	}
	const body = (await res.json()) as { merged?: number };
	return body.merged ?? 0;
}
