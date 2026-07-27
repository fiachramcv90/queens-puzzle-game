// Resolving who a play belongs to.
//
// A play is owned by exactly one identity: a signed-in USER, or a guest UUID. Which
// one it is has to be decided HERE, at the moment the play is created, because
// `plays.user_id` is what every downstream rule reads — the leaderboard's display
// name, `recompute_streaks`, "is this you". A play written with the wrong owner is
// not cosmetically wrong, it is invisible to the account that earned it.
//
// The two identities are resolved from opposite places, and deliberately so:
//
//   - the USER id comes from the caller's verified session token, never from the
//     body — that is what stops one account claiming another's play;
//   - the GUEST UUID does come from the body. It is not a secret (it lives in
//     localStorage), and the posture there defends only against casual tampering.
//
// A session, when there is one, always wins: a signed-in caller's guest id is
// ignored rather than trusted, so a stale or borrowed one cannot redirect the play.

import { createClient } from 'npm:@supabase/supabase-js@2';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID_RE.test(value);
}

/** The bearer token on the request, or null when the header is absent or empty. */
function bearerToken(req: Request): string | null {
	const header = req.headers.get('Authorization') ?? '';
	const token = header.replace(/^Bearer\s+/i, '').trim();
	return token === '' ? null : token;
}

/**
 * The authenticated user id behind this request, or null when there is no session.
 *
 * Null is an ordinary answer, not a failure: the guest-capable functions are reached
 * with the PUBLISHABLE key in this header (that is how the Supabase gateway routes an
 * anonymous call), and an expired token is simply a caller who is no longer signed in.
 * Every one of those cases means "play as a guest", so callers branch on null rather
 * than treating it as an error. Only `merge`, which cannot work without an account,
 * turns null into a 401.
 */
export async function resolveUserId(req: Request): Promise<string | null> {
	const token = bearerToken(req);
	if (token === null) return null;

	const url = Deno.env.get('SUPABASE_URL');
	const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
	if (!url || !anonKey) {
		throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in the function env');
	}

	// A routing key is not a session. Recognising it here saves a round trip to the
	// auth server on every anonymous play; `getUser` would reject it anyway, so this
	// is an optimisation and not the check that keeps the two apart.
	if (token === anonKey || token.startsWith('sb_publishable_')) return null;

	// A short-lived client scoped to the caller's token, used only to read the user.
	const scoped = createClient(url, anonKey, {
		global: { headers: { Authorization: `Bearer ${token}` } },
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data, error } = await scoped.auth.getUser();
	if (error || !data.user) return null;
	return data.user.id;
}
