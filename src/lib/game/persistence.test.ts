import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StorageLike } from './persistence';
import { loadBlob, saveBlob, getOrCreateGuestId, GUEST_BLOB_KEY } from './persistence';
import { createEmptyBoard, setCell } from './board';

/** A minimal in-memory localStorage stand-in for the tests. */
function memoryStorage(): StorageLike {
	const map = new Map<string, string>();
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => {
			map.set(k, v);
		}
	};
}

describe('getOrCreateGuestId', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('mints a UUID on first play and persists it', () => {
		const storage = memoryStorage();
		const id = getOrCreateGuestId(storage);
		expect(id).toMatch(/[0-9a-f-]{36}/);
		// Persisted: a second call returns the same id from storage.
		expect(getOrCreateGuestId(storage)).toBe(id);
	});

	it('reuses an already-minted id rather than minting a second', () => {
		const storage = memoryStorage();
		const first = getOrCreateGuestId(storage);
		const spy = vi.spyOn(crypto, 'randomUUID');
		const second = getOrCreateGuestId(storage);
		expect(second).toBe(first);
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('loadBlob / saveBlob', () => {
	it('returns null when nothing is stored', () => {
		expect(loadBlob(memoryStorage())).toBeNull();
	});

	it('round-trips a play so a refresh restores the in-progress board', () => {
		const storage = memoryStorage();
		let board = createEmptyBoard(4);
		board = setCell(board, 1, 2, 'queen');
		board = setCell(board, 0, 0, 'X');

		saveBlob(storage, {
			guestId: 'guest-1',
			prefs: {},
			play: { puzzleId: 'p1', board, startedAt: 1000 }
		});

		const restored = loadBlob(storage);
		expect(restored?.play?.puzzleId).toBe('p1');
		expect(restored?.play?.board[1][2]).toBe('queen');
		expect(restored?.play?.board[0][0]).toBe('X');
		expect(restored?.play?.startedAt).toBe(1000);
	});

	it('survives a corrupt blob by returning null rather than throwing', () => {
		const storage = memoryStorage();
		storage.setItem(GUEST_BLOB_KEY, '{ not json');
		expect(loadBlob(storage)).toBeNull();
	});
});
