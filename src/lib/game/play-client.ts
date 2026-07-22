/**
 * The browser's view of the server-authoritative play lifecycle.
 *
 * Thin wrappers over the same-origin `/api/play/*` routes (which the rate-limit
 * hook fronts and which forward to the Supabase Edge Functions). Everything that
 * matters — credited time, mistakes, the accept/reject decision — is the server's;
 * this module only carries the token out and the result back.
 *
 * It knows nothing about Svelte, so it is testable with a fetch stand-in.
 */

import type { Board, MoveLog } from '$lib/solver';
import type { PlayResult } from './types';

/** What `start` returns: the token to hold and the server's authoritative start. */
export interface StartResult {
	readonly token: string;
	/** ISO timestamp the server clocked the play as starting. */
	readonly startedAt: string;
}

/** The fetch surface these calls need — the platform `fetch`, or a test's fake. */
export type FetchLike = typeof fetch;

async function postJson<T>(
	fetchImpl: FetchLike,
	action: 'start' | 'heartbeat' | 'submit',
	payload: unknown
): Promise<T> {
	const res = await fetchImpl(`/api/play/${action}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new PlayRequestError(action, res.status, detail);
	}
	return (await res.json()) as T;
}

/** Begin (or resume) today's play for a guest. Idempotent server-side per date. */
export function startPlay(
	puzzleDate: string,
	guestId: string,
	fetchImpl: FetchLike = fetch
): Promise<StartResult> {
	return postJson<StartResult>(fetchImpl, 'start', { puzzleDate, guestId });
}

/** Report liveness. Best-effort: an unknown or completed token is not an error. */
export async function sendHeartbeat(token: string, fetchImpl: FetchLike = fetch): Promise<void> {
	await postJson(fetchImpl, 'heartbeat', { token });
}

/** Submit the solve. Returns the server-recorded result the screen displays. */
export function submitPlay(
	token: string,
	puzzleId: string,
	finalBoard: Board,
	moveLog: MoveLog,
	fetchImpl: FetchLike = fetch
): Promise<PlayResult> {
	return postJson<PlayResult>(fetchImpl, 'submit', { token, puzzleId, finalBoard, moveLog });
}

/** A non-2xx from a play endpoint, carrying the status so callers can branch. */
export class PlayRequestError extends Error {
	constructor(
		readonly action: string,
		readonly status: number,
		readonly detail: string
	) {
		super(`play ${action} failed with ${status}`);
		this.name = 'PlayRequestError';
	}
}
