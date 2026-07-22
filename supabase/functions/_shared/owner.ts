// Resolving who a play belongs to.
//
// For now the app is guest-only (issue #22), so the owner is a guest UUID supplied
// in the request body. That UUID is not a secret — it lives in localStorage — and
// the posture here defends only against casual tampering, so trusting the body is
// acceptable. When signed-in play lands, the secure path is to derive user_id from
// a verified JWT instead; this is the one place that resolution will grow.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID_RE.test(value);
}
