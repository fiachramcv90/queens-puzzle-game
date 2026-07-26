/**
 * The browser's view of the friends surface.
 *
 * Every call is an RPC to a security-definer function — there is no direct select
 * against `friendships`, `blocks` or `profiles` here, and there could not usefully
 * be one: `friendships` is participant-read-only with no client write policy, and
 * resolving a code deliberately is not a table read at all, so that a code can never
 * become a way to enumerate players.
 */

import { supabaseBrowserClient } from '$lib/supabase/browser';
import { normaliseCode, toFriendRow, type FriendRow, type FriendRowDto } from './friends';

/** Mint this player's friend code, or return the one they already hold. */
export async function ensureFriendCode(): Promise<string> {
	const { data, error } = await supabaseBrowserClient().rpc('ensure_friend_code');
	if (error) throw error;
	return data as string;
}

/** Retire the current code. Every outstanding invite link stops working. */
export async function regenerateFriendCode(): Promise<string> {
	const { data, error } = await supabaseBrowserClient().rpc('regenerate_friend_code');
	if (error) throw error;
	return data as string;
}

/** The friends list plus pending requests in both directions, in one read. */
export async function fetchFriends(): Promise<FriendRow[]> {
	const { data, error } = await supabaseBrowserClient().rpc('my_friends');
	if (error) throw error;
	return ((data ?? []) as FriendRowDto[]).map(toFriendRow);
}

/** Who a friend code belongs to, or null when it resolves to nobody. */
export async function resolveFriendCode(code: string): Promise<{
	userId: string;
	displayName: string;
	alreadyFriends: boolean;
	requestPending: boolean;
} | null> {
	const { data, error } = await supabaseBrowserClient().rpc('resolve_friend_code', {
		p_code: normaliseCode(code)
	});
	if (error) throw error;
	const row = (data ?? [])[0] as
		| {
				user_id: string;
				display_name: string;
				already_friends: boolean;
				request_pending: boolean;
		  }
		| undefined;
	if (!row) return null;
	return {
		userId: row.user_id,
		displayName: row.display_name,
		alreadyFriends: row.already_friends,
		requestPending: row.request_pending
	};
}

/** Send a friend request. Returns the server's outcome code (see REQUEST_MESSAGES). */
export async function requestFriendship(code: string): Promise<string> {
	const { data, error } = await supabaseBrowserClient().rpc('request_friendship', {
		p_code: normaliseCode(code)
	});
	if (error) throw error;
	return data as string;
}

/** Accept or decline an incoming request. Only the non-requester may do either. */
export async function respondToRequest(otherId: string, accept: boolean): Promise<string> {
	const { data, error } = await supabaseBrowserClient().rpc('respond_to_request', {
		p_other: otherId,
		p_accept: accept
	});
	if (error) throw error;
	return data as string;
}

/** Remove a friend. Symmetric — one row, one delete, no half state. */
export async function unfriend(otherId: string): Promise<void> {
	const { error } = await supabaseBrowserClient().rpc('unfriend', { p_other: otherId });
	if (error) throw error;
}

/** Block someone. Also clears any friendship, in the same transaction. */
export async function blockUser(otherId: string): Promise<void> {
	const { error } = await supabaseBrowserClient().rpc('block_user', { p_other: otherId });
	if (error) throw error;
}
