/**
 * Guest identity and offline persistence.
 *
 * A guest UUID is minted on first play and, together with the in-progress board
 * and lightweight prefs, lives in a single localStorage blob. A refresh, a closed
 * tab or a dropped connection must not end the puzzle — this module is what makes
 * that true. It knows nothing about Svelte: it takes a `StorageLike`, so the
 * round-trip is testable with an in-memory stand-in and no jsdom.
 */

import type { GuestBlob } from './types';

/** The one localStorage key the whole guest blob lives under. */
export const GUEST_BLOB_KEY = 'queens:guest:v1';

/**
 * The slice of the `localStorage` API we depend on. Narrowed to two methods so a
 * test can supply a Map-backed fake and so a caller can pass a null-object when
 * storage is unavailable (private mode, disabled) without a crash.
 */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** Read and parse the guest blob, or `null` if absent or unreadable. */
export function loadBlob(storage: StorageLike): GuestBlob | null {
	const raw = storage.getItem(GUEST_BLOB_KEY);
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as GuestBlob;
	} catch {
		// A corrupt blob must not brick the game; start clean instead.
		return null;
	}
}

/** Write the guest blob back, replacing whatever was there. */
export function saveBlob(storage: StorageLike, blob: GuestBlob): void {
	storage.setItem(GUEST_BLOB_KEY, JSON.stringify(blob));
}

/**
 * The guest UUID, minted and persisted on first play and reused ever after. If a
 * blob already exists its id is returned untouched; otherwise a fresh blob is
 * written with a new UUID.
 */
export function getOrCreateGuestId(storage: StorageLike): string {
	const existing = loadBlob(storage);
	if (existing) return existing.guestId;
	const guestId = crypto.randomUUID();
	saveBlob(storage, { guestId, prefs: {} });
	return guestId;
}
