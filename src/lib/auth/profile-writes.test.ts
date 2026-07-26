import { describe, expect, test, vi, beforeEach } from 'vitest';

/**
 * Regression guard for the one thing these two writes must never lose: an explicit
 * `.eq('id', …)` filter.
 *
 * Supabase preloads `safeupdate` on the `authenticator` role, so an UPDATE through the
 * Data API with no WHERE clause is rejected outright — and an RLS policy does NOT
 * count as one. Both of these writes originally relied on `using (id = auth.uid())` to
 * scope themselves and were refused in production with `UPDATE requires a WHERE
 * clause`. `confirmDisplayName` surfaced it as "Could not save that name"; the prefs
 * sync swallowed it and simply never worked.
 *
 * So the filter IS the contract here, which is why this asserts on the query the
 * builder receives rather than on a return value. A local Supabase does not
 * necessarily load `safeupdate`, so the db suite cannot be relied on to catch a
 * regression — this can.
 */

const eq = vi.fn();
const update = vi.fn();
const from = vi.fn();
const getSession = vi.fn();

vi.mock('$lib/supabase/browser', () => ({
	supabaseBrowserClient: () => ({
		auth: { getSession },
		from
	})
}));

const { confirmDisplayName, syncPrefsToProfile } = await import('./profile');

beforeEach(() => {
	vi.clearAllMocks();
	getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
	const single = vi.fn().mockResolvedValue({ error: null });
	const select = vi.fn(() => ({ single }));
	eq.mockReturnValue({ select });
	update.mockReturnValue({ eq });
	from.mockReturnValue({ update });
});

describe('confirmDisplayName', () => {
	test('filters on the signed-in player’s own id', async () => {
		await confirmDisplayName('  Sam  ');
		expect(from).toHaveBeenCalledWith('profiles');
		expect(update).toHaveBeenCalledWith({ display_name: 'Sam', name_confirmed: true });
		expect(eq).toHaveBeenCalledWith('id', 'user-1');
	});

	test('refuses to write when there is no session', async () => {
		getSession.mockResolvedValue({ data: { session: null }, error: null });
		await expect(confirmDisplayName('Sam')).rejects.toThrow(/not signed in/i);
		expect(eq).not.toHaveBeenCalled();
	});
});

describe('syncPrefsToProfile', () => {
	test('filters on the signed-in player’s own id', async () => {
		await syncPrefsToProfile({ palette: 'cvd' });
		expect(update).toHaveBeenCalledWith({ palette: 'cvd' });
		expect(eq).toHaveBeenCalledWith('id', 'user-1');
	});

	// No columns means nothing to write, so it must not reach the network at all —
	// and must not demand a session it does not need.
	test('is a no-op when the guest set no prefs', async () => {
		await syncPrefsToProfile({});
		expect(from).not.toHaveBeenCalled();
		expect(getSession).not.toHaveBeenCalled();
	});
});
