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
	action: 'start' | 'heartbeat' | 'submit' | 'reveal' | 'assist',
	payload: unknown,
	accessToken: string | null = null
): Promise<T> {
	const res = await fetchImpl(`/api/play/${action}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
		},
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new PlayRequestError(action, res.status, detail);
	}
	return (await res.json()) as T;
}

/**
 * Begin (or resume) the play for a date. Idempotent server-side per identity and date.
 *
 * `accessToken` is what decides WHOSE play this is: with one, the server keys the play
 * to the signed-in user; without one, to `guestId`. Passing null for a player who is
 * in fact signed in does not merely mislabel the row — the play never reaches their
 * streak or the leaderboard under their name, and no later step re-keys it. Callers
 * must therefore resolve the session BEFORE calling, never fire this off and hope the
 * session arrives first.
 */
export function startPlay(
	puzzleDate: string,
	guestId: string,
	accessToken: string | null = null,
	fetchImpl: FetchLike = fetch
): Promise<StartResult> {
	return postJson<StartResult>(fetchImpl, 'start', { puzzleDate, guestId }, accessToken);
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

/** What a hint call returns: the server's flag and its own hint count. */
export interface AssistResult {
	readonly assisted: boolean;
	readonly hintsUsed: number | null;
}

/** What `reveal` returns — the next correct cell, or null when there is none left. */
export interface RevealResult extends AssistResult {
	readonly cell: { readonly row: number; readonly col: number } | null;
}

/**
 * Ask the server for the next correct cell. The solution never reaches the browser;
 * only the single cell does. The server flags the play `assisted` as part of
 * answering, so there is no separate "admit it" step the client could skip.
 */
export function revealCell(
	token: string,
	board: Board,
	fetchImpl: FetchLike = fetch
): Promise<RevealResult> {
	return postJson<RevealResult>(fetchImpl, 'reveal', { token, board });
}

/**
 * Record a hint that the client computed for itself (the mistake check, or
 * switching on auto-mark-X). The work happens locally; this is the charge.
 *
 * Callers must await this BEFORE showing the hint's output. Applying the help and
 * only then telling the server would leave a window in which a dropped request buys
 * a free hint — small, but it is exactly the hole `assisted` exists to close.
 */
export function recordAssist(token: string, fetchImpl: FetchLike = fetch): Promise<AssistResult> {
	return postJson<AssistResult>(fetchImpl, 'assist', { token });
}
