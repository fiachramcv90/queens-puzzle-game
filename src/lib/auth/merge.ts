/**
 * The client half of the silent guest merge.
 *
 * When a player who has been playing as a guest signs in, their server-side play
 * history — rows keyed by the guest UUID — has to fold onto the new account, with no
 * prompt and no wizard. This module drives that from an "unmerged" flag in the guest
 * blob: on each authenticated load it attempts the merge once, and only marks the
 * blob merged when the server confirms success. A failed or offline attempt leaves
 * the flag unset, so the next authenticated load simply tries again.
 *
 * The merge endpoint is idempotent (see `merge_guest_plays`), so the flag is a
 * cost-saver, not a correctness gate: running the merge twice equals running it once.
 *
 * Like the rest of the game's storage layer, this knows nothing about Svelte or the
 * network — it takes a `StorageLike` and a merge caller, so it is testable with
 * in-memory stand-ins.
 */

import { loadBlob, saveBlob, type StorageLike } from '$lib/game/persistence';
import type { GuestBlob } from '$lib/game/types';

/** The slice of an auth session the merge needs: the token that proves who to merge to. */
export interface MergeSession {
	readonly accessToken: string;
}

/** Performs the actual merge request for a guest id under a session token. */
export type MergeCaller = (guestId: string, accessToken: string) => Promise<void>;

/** The outcome of a sync attempt, so a caller can log or surface it if it wants. */
export type MergeOutcome = 'merged' | 'skipped' | 'failed';

/**
 * Whether this guest still has a pending merge. True while a guest blob exists and
 * has not yet been folded onto an account; a blob with no server history still counts
 * as needing merge, because the idempotent endpoint makes that a harmless no-op and
 * missing real history would be the worse failure.
 */
export function guestNeedsMerge(blob: GuestBlob | null): boolean {
	return blob !== null && blob.merged !== true;
}

/**
 * Re-arm the merge for this device, so the next authenticated load runs it again.
 *
 * The `merged` flag is set once and never cleared, which is only safe while a device
 * stops producing guest rows the moment it has an account. That is now true — `start`
 * keys a play to the session's user — with exactly one exception: playing signed OUT
 * on a device that has merged before. Those rows are real server plays that belong to
 * the account, and without this they would sit unmergeable forever, showing on the
 * board as "Guest". So the flag is cleared at the one moment a new guest play is
 * created, and nowhere else; the merge stays a once-per-pending-blob call rather than
 * a request on every load.
 */
export function armGuestMerge(storage: StorageLike): void {
	const blob = loadBlob(storage);
	if (blob === null || blob.merged !== true) return;
	saveBlob(storage, { ...blob, merged: false });
}

/**
 * Attempt the guest→account merge for the current session, at most once per pending
 * blob. Does nothing without a session (solo and guest play are never gated behind
 * one) and nothing once already merged. On success it records the `merged` flag; on
 * failure it leaves the blob untouched so the next authenticated load retries.
 */
export async function syncGuestMerge(
	storage: StorageLike,
	session: MergeSession | null,
	merge: MergeCaller
): Promise<MergeOutcome> {
	if (!session) return 'skipped';

	const blob = loadBlob(storage);
	if (!guestNeedsMerge(blob)) return 'skipped';

	try {
		await merge(blob!.guestId, session.accessToken);
	} catch {
		// Offline or a transient server error: leave the flag unset. The blob still
		// carries the guest id, so the next authenticated load tries again.
		return 'failed';
	}

	saveBlob(storage, { ...blob!, merged: true });
	return 'merged';
}
