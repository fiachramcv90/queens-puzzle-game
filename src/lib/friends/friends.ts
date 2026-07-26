/**
 * The friends vocabulary, and the few rules that are worth stating once.
 *
 * Everything security-shaped — who may resolve a code, who may accept, who appears
 * on the board — lives in the security-definer functions in the friends migration,
 * because those are the only rules a modified client cannot skip. What is here is
 * presentation logic: sorting, grouping, and building an invite link.
 */

/** One row of the friends list, as `my_friends()` returns it. */
export interface FriendRow {
	readonly userId: string;
	readonly displayName: string;
	readonly status: 'pending' | 'accepted';
	/** `incoming` — they asked and you decide. `outgoing` — you asked. */
	readonly direction: 'incoming' | 'outgoing' | 'friend';
	readonly currentStreak: number;
}

/** The shape `my_friends()` returns over the wire. */
export interface FriendRowDto {
	readonly user_id: string;
	readonly display_name: string;
	readonly status: string;
	readonly direction: string;
	readonly current_streak: number;
}

export function toFriendRow(dto: FriendRowDto): FriendRow {
	return {
		userId: dto.user_id,
		displayName: dto.display_name,
		status: dto.status === 'accepted' ? 'accepted' : 'pending',
		direction:
			dto.direction === 'friend' || dto.direction === 'outgoing' || dto.direction === 'incoming'
				? dto.direction
				: 'incoming',
		currentStreak: dto.current_streak ?? 0
	};
}

/** The three sections the friends page renders, split from one list. */
export interface FriendSections {
	readonly incoming: readonly FriendRow[];
	readonly friends: readonly FriendRow[];
	readonly outgoing: readonly FriendRow[];
}

/**
 * Split the list into the three groups the page shows.
 *
 * Incoming requests come first everywhere they appear, because they are the only
 * group that is waiting on the player to do something. An outgoing request needs no
 * action and a friend needs none either.
 */
export function groupFriends(rows: readonly FriendRow[]): FriendSections {
	return {
		incoming: rows.filter((r) => r.direction === 'incoming'),
		friends: rows.filter((r) => r.direction === 'friend'),
		outgoing: rows.filter((r) => r.direction === 'outgoing')
	};
}

/**
 * The invite link for a code. The code is the whole payload — that is what makes
 * regenerating a code invalidate every link ever shared, with no separate link
 * registry to expire.
 */
export function inviteLink(origin: string, code: string): string {
	return `${origin}/friends?code=${encodeURIComponent(code)}`;
}

/**
 * Normalise a code as typed. Players read these off a screenshot or hear them out
 * loud, so case and stray whitespace are noise; the server normalises identically,
 * and this only spares a round trip on an obviously-fixable typo.
 */
export function normaliseCode(input: string): string {
	return input.trim().toUpperCase();
}

/** Whether a code is plausibly complete, to gate the submit before a round trip. */
export function looksLikeCode(input: string): boolean {
	return /^QNS-[A-Z0-9]{4}$/.test(normaliseCode(input));
}

/** What `request_friendship` can answer, and what to tell the player about each. */
export const REQUEST_MESSAGES: Record<string, string> = {
	requested: 'Request sent. They’ll see it next time they open Friends.',
	// The two people asked each other independently — both have said yes, so there is
	// nothing left to confirm.
	accepted: 'You’re now friends — they had already sent you a request.',
	'already-friends': 'You’re already friends.',
	'already-pending': 'You’ve already sent them a request.',
	self: 'That’s your own friend code.',
	// Deliberately the same message a genuinely unknown code gets. A distinct reply
	// would confirm both that the account exists and that they blocked you.
	'unknown-code': 'No player has that friend code. Check it and try again.',
	'limit-reached': 'You’ve reached the friend limit.'
};
