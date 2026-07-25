/**
 * Resolve the player's history records from the right source: the server for a
 * signed-in player (their authoritative `plays` rows under select-own RLS), local
 * records for a guest. Both come back as the shared {@link PlayRecord}, so the history
 * and archive views never branch on identity beyond this one call.
 *
 * A guest's local records are their mirror until they sign in; once signed in the
 * server rows are authoritative (the merge has folded the guest's plays onto the
 * account), so we read those and ignore the now-redundant local mirror.
 */

import { loadBlob, type StorageLike } from '$lib/game/persistence';
import type { PlayRecord } from './history';
import { fetchPlayHistory } from './history-server';
import { localToPlayRecord } from './records';

/** Read local guest records from storage, mapped to {@link PlayRecord}. */
export function localHistoryRecords(storage: StorageLike): PlayRecord[] {
	const blob = loadBlob(storage);
	return (blob?.plays ?? []).map(localToPlayRecord);
}

/** Read the player's history records — server rows if signed in, local records otherwise. */
export async function loadHistoryRecords(opts: {
	signedIn: boolean;
	storage: StorageLike;
}): Promise<PlayRecord[]> {
	if (opts.signedIn) return fetchPlayHistory();
	return localHistoryRecords(opts.storage);
}
