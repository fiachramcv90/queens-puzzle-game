import { describe, expect, test } from 'vitest';
import { appendRecord, localToPlayRecord, recordFromResult } from './records';
import type { LocalPlayRecord, PlayResult } from '$lib/game/types';

function local(overrides: Partial<LocalPlayRecord> = {}): LocalPlayRecord {
	return {
		puzzleDate: '2026-07-10',
		playedDate: '2026-07-10',
		attemptNo: 1,
		elapsedMs: 90_000,
		mistakes: 0,
		hintsUsed: 0,
		assisted: false,
		stale: false,
		unverified: false,
		replay: false,
		...overrides
	};
}

const result: PlayResult = {
	elapsedMs: 120_000,
	mistakes: 2,
	stale: false,
	unverified: false,
	replay: true,
	attemptNo: 3
};

describe('recordFromResult', () => {
	test('carries the server numbers and the two dates', () => {
		const r = recordFromResult(result, '2026-07-01', '2026-07-25');
		expect(r).toMatchObject({
			puzzleDate: '2026-07-01',
			playedDate: '2026-07-25',
			attemptNo: 3,
			elapsedMs: 120_000,
			mistakes: 2,
			replay: true
		});
	});
});

describe('localToPlayRecord', () => {
	test('a local record is a completed play record', () => {
		expect(localToPlayRecord(local()).completed).toBe(true);
	});
});

describe('appendRecord', () => {
	test('adds a record to an empty history', () => {
		expect(appendRecord(undefined, local())).toHaveLength(1);
	});

	test('keeps distinct attempts of the same daily', () => {
		const one = appendRecord(undefined, local({ attemptNo: 1 }));
		const two = appendRecord(one, local({ attemptNo: 2 }));
		expect(two).toHaveLength(2);
	});

	test('replaces an existing record for the same daily and attempt', () => {
		const one = appendRecord(undefined, local({ attemptNo: 1, elapsedMs: 90_000 }));
		const again = appendRecord(one, local({ attemptNo: 1, elapsedMs: 80_000 }));
		expect(again).toHaveLength(1);
		expect(again[0].elapsedMs).toBe(80_000);
	});
});
