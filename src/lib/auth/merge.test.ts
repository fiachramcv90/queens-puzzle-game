import { describe, expect, test, vi } from 'vitest';
import { guestNeedsMerge, syncGuestMerge, type MergeSession } from './merge';
import { GUEST_BLOB_KEY, loadBlob, saveBlob, type StorageLike } from '$lib/game/persistence';
import type { GuestBlob } from '$lib/game/types';

/** A Map-backed StorageLike, the same in-memory stand-in the persistence tests use. */
function memoryStorage(seed?: Record<string, string>): StorageLike {
	const map = new Map<string, string>(Object.entries(seed ?? {}));
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v)
	};
}

function withBlob(blob: GuestBlob): StorageLike {
	const storage = memoryStorage();
	saveBlob(storage, blob);
	return storage;
}

const SESSION: MergeSession = { accessToken: 'a-user-access-token' };
const GUEST = 'guest-uuid-1';

describe('guestNeedsMerge', () => {
	test('a guest blob that has never merged needs merging', () => {
		expect(guestNeedsMerge({ guestId: GUEST, prefs: {} })).toBe(true);
	});

	test('a blob already marked merged does not', () => {
		expect(guestNeedsMerge({ guestId: GUEST, prefs: {}, merged: true })).toBe(false);
	});

	test('no blob at all does not', () => {
		expect(guestNeedsMerge(null)).toBe(false);
	});
});

describe('syncGuestMerge', () => {
	test('with no session it does nothing — solo/guest play is never gated', async () => {
		const merge = vi.fn();
		const storage = withBlob({ guestId: GUEST, prefs: {} });
		expect(await syncGuestMerge(storage, null, merge)).toBe('skipped');
		expect(merge).not.toHaveBeenCalled();
	});

	test('on a first authenticated load it merges and records the flag', async () => {
		const merge = vi.fn().mockResolvedValue(undefined);
		const storage = withBlob({ guestId: GUEST, prefs: {} });

		expect(await syncGuestMerge(storage, SESSION, merge)).toBe('merged');
		expect(merge).toHaveBeenCalledWith(GUEST, SESSION.accessToken);
		expect(loadBlob(storage)?.merged).toBe(true);
	});

	test('a second authenticated load does not merge again (idempotent client-side)', async () => {
		const merge = vi.fn().mockResolvedValue(undefined);
		const storage = withBlob({ guestId: GUEST, prefs: {} });

		await syncGuestMerge(storage, SESSION, merge);
		merge.mockClear();

		expect(await syncGuestMerge(storage, SESSION, merge)).toBe('skipped');
		expect(merge).not.toHaveBeenCalled();
	});

	test('a failed merge leaves the flag unset so it retries on the next load', async () => {
		const merge = vi
			.fn()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce(undefined);
		const storage = withBlob({ guestId: GUEST, prefs: {} });

		expect(await syncGuestMerge(storage, SESSION, merge)).toBe('failed');
		expect(loadBlob(storage)?.merged).toBeUndefined();

		// The next authenticated load retries and this time succeeds.
		expect(await syncGuestMerge(storage, SESSION, merge)).toBe('merged');
		expect(loadBlob(storage)?.merged).toBe(true);
	});

	test('the merge flag is written without disturbing the rest of the blob', async () => {
		const merge = vi.fn().mockResolvedValue(undefined);
		const blob: GuestBlob = {
			guestId: GUEST,
			prefs: { autoMarkX: true },
			daily: { id: 'p1', date: '2026-07-24', boardSize: 5, tier: 'Easy', regionMap: [] },
			play: { puzzleId: 'p1', board: [], startedAt: 123 }
		};
		const storage = withBlob(blob);

		await syncGuestMerge(storage, SESSION, merge);

		const after = loadBlob(storage)!;
		expect(after.prefs).toEqual({ autoMarkX: true });
		expect(after.play?.startedAt).toBe(123);
		expect(after.daily?.id).toBe('p1');
		expect(after.merged).toBe(true);
	});

	test('with no stored blob there is nothing to merge', async () => {
		const merge = vi.fn();
		const storage = memoryStorage();
		expect(await syncGuestMerge(storage, SESSION, merge)).toBe('skipped');
		expect(merge).not.toHaveBeenCalled();
		expect(storage.getItem(GUEST_BLOB_KEY)).toBeNull();
	});
});
