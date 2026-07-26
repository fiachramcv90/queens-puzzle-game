import { describe, it, expect } from 'vitest';
import {
	groupFriends,
	inviteLink,
	looksLikeCode,
	normaliseCode,
	toFriendRow,
	type FriendRow
} from './friends';

function row(over: Partial<FriendRow>): FriendRow {
	return {
		userId: crypto.randomUUID(),
		displayName: 'Sam',
		status: 'accepted',
		direction: 'friend',
		currentStreak: 0,
		...over
	};
}

describe('toFriendRow', () => {
	it('maps the wire shape to the domain shape', () => {
		expect(
			toFriendRow({
				user_id: 'u1',
				display_name: 'Sam',
				status: 'accepted',
				direction: 'friend',
				current_streak: 4
			})
		).toEqual({
			userId: 'u1',
			displayName: 'Sam',
			status: 'accepted',
			direction: 'friend',
			currentStreak: 4
		});
	});

	// The wire values are strings from Postgres, so an unexpected one must land
	// somewhere safe rather than rendering as an unhandled state.
	it('falls back to pending/incoming for an unrecognised value', () => {
		const mapped = toFriendRow({
			user_id: 'u1',
			display_name: 'Sam',
			status: 'weird',
			direction: 'weird',
			current_streak: 0
		});
		expect(mapped.status).toBe('pending');
		expect(mapped.direction).toBe('incoming');
	});

	it('treats a null streak as 0', () => {
		const mapped = toFriendRow({
			user_id: 'u1',
			display_name: 'Sam',
			status: 'accepted',
			direction: 'friend',
			current_streak: null as unknown as number
		});
		expect(mapped.currentStreak).toBe(0);
	});
});

describe('groupFriends', () => {
	it('splits the one list into the three sections the page renders', () => {
		const incoming = row({ direction: 'incoming', status: 'pending' });
		const friend = row({ direction: 'friend' });
		const outgoing = row({ direction: 'outgoing', status: 'pending' });

		const grouped = groupFriends([outgoing, friend, incoming]);
		expect(grouped.incoming).toEqual([incoming]);
		expect(grouped.friends).toEqual([friend]);
		expect(grouped.outgoing).toEqual([outgoing]);
	});

	it('returns empty sections for an empty list', () => {
		expect(groupFriends([])).toEqual({ incoming: [], friends: [], outgoing: [] });
	});
});

describe('normaliseCode / looksLikeCode', () => {
	it('upper-cases and trims, because codes get read aloud and retyped', () => {
		expect(normaliseCode('  qns-4f2k ')).toBe('QNS-4F2K');
	});

	it('accepts a well-formed code in any case', () => {
		expect(looksLikeCode('QNS-4F2K')).toBe(true);
		expect(looksLikeCode('qns-4f2k')).toBe(true);
	});

	it('rejects anything that is not the code shape', () => {
		expect(looksLikeCode('')).toBe(false);
		expect(looksLikeCode('QNS-')).toBe(false);
		expect(looksLikeCode('QNS-4F2')).toBe(false);
		expect(looksLikeCode('QNS-4F2KX')).toBe(false);
		expect(looksLikeCode('ABC-4F2K')).toBe(false);
		expect(looksLikeCode('QNS_4F2K')).toBe(false);
	});
});

describe('inviteLink', () => {
	// The code IS the payload. That is what makes regenerating a code invalidate
	// every link already shared, with no separate link registry to expire.
	it('embeds the code and nothing else', () => {
		expect(inviteLink('https://queens.example', 'QNS-4F2K')).toBe(
			'https://queens.example/friends?code=QNS-4F2K'
		);
	});

	it('escapes the code rather than trusting it into the URL', () => {
		expect(inviteLink('https://queens.example', 'A&B=C')).toBe(
			'https://queens.example/friends?code=A%26B%3DC'
		);
	});
});
