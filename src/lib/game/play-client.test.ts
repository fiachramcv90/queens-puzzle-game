import { describe, expect, test, vi } from 'vitest';
import { startPlay, sendHeartbeat, PlayRequestError } from './play-client';

/** A fetch stand-in that records its calls and returns a fixed JSON body. */
function fakeFetch(body: unknown = {}, status = 200) {
	return vi.fn(
		async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			})
	) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

/** The headers of the nth recorded call, normalised for lookup. */
function headersOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0): Headers {
	return new Headers((fetchImpl.mock.calls[call][1] as RequestInit).headers as HeadersInit);
}

function bodyOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0): unknown {
	return JSON.parse((fetchImpl.mock.calls[call][1] as RequestInit).body as string);
}

const STARTED = { token: 'play-token', startedAt: '2026-07-27T12:44:59.273Z' };

describe('startPlay', () => {
	// The identity a play is created under is decided once and never revisited, so
	// whether the session token rides along on THIS request is the whole difference
	// between a play that reaches the player's streak and leaderboard row and one
	// that is stranded as "Guest".
	test('carries the session token so the server keys the play to the user', async () => {
		const fetchImpl = fakeFetch(STARTED);

		await startPlay('2026-07-27', 'guest-uuid', 'a-user-access-token', fetchImpl);

		expect(headersOf(fetchImpl).get('authorization')).toBe('Bearer a-user-access-token');
	});

	test('sends no authorization header for a guest, keeping start guest-capable', async () => {
		const fetchImpl = fakeFetch(STARTED);

		await startPlay('2026-07-27', 'guest-uuid', null, fetchImpl);

		expect(headersOf(fetchImpl).has('authorization')).toBe(false);
	});

	test('omitting the token defaults to a guest start rather than throwing', async () => {
		const fetchImpl = fakeFetch(STARTED);

		await startPlay('2026-07-27', 'guest-uuid', undefined, fetchImpl);

		expect(headersOf(fetchImpl).has('authorization')).toBe(false);
	});

	test('posts the date and guest id, and returns the server’s token and start', async () => {
		const fetchImpl = fakeFetch(STARTED);

		const result = await startPlay('2026-07-27', 'guest-uuid', 'tok', fetchImpl);

		expect(fetchImpl.mock.calls[0][0]).toBe('/api/play/start');
		expect(bodyOf(fetchImpl)).toEqual({ puzzleDate: '2026-07-27', guestId: 'guest-uuid' });
		expect(result).toEqual(STARTED);
	});

	test('a non-2xx becomes a PlayRequestError carrying the status', async () => {
		const fetchImpl = fakeFetch({ error: 'rate limit exceeded' }, 429);

		await expect(startPlay('2026-07-27', 'guest-uuid', 'tok', fetchImpl)).rejects.toMatchObject({
			name: 'PlayRequestError',
			action: 'start',
			status: 429
		});
		await expect(startPlay('2026-07-27', 'guest-uuid', 'tok', fetchImpl)).rejects.toBeInstanceOf(
			PlayRequestError
		);
	});
});

describe('the token-keyed actions', () => {
	// These resolve their owner from the play token, which already carries it, so
	// they neither need nor send a session.
	test('heartbeat sends no authorization header', async () => {
		const fetchImpl = fakeFetch({});

		await sendHeartbeat('play-token', fetchImpl);

		expect(headersOf(fetchImpl).has('authorization')).toBe(false);
	});
});
