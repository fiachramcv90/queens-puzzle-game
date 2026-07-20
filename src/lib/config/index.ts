/**
 * Tunable operational numbers.
 *
 * These are values the build spec says must not be hard-coded into the code that
 * uses them: rate limits, retention windows and the pool horizon are guesses
 * until there is real traffic, and they are expected to be re-tuned without
 * touching logic. Anything with a rule behind it (the Chebyshev adjacency
 * definition, the ranked-play filter) is code, not config, and does not belong
 * here.
 *
 * Every duration is milliseconds unless the name says otherwise.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Edge rate limits. The numbers are guesses — see the "Anti-cheat and server
 * validation" section of the MVP build spec.
 */
export interface RateLimit {
	/** Maximum requests permitted inside `windowMs`. */
	readonly limit: number;
	readonly windowMs: number;
}

export const rateLimits = {
	/** `reveal` — roughly one hint per two seconds, per play. */
	reveal: { limit: 1, windowMs: 2 * SECOND },
	/** `start` — per IP. A DB constraint separately allows one open play per identity per date. */
	start: { limit: 30, windowMs: HOUR },
	/** `submit` — per IP. */
	submit: { limit: 60, windowMs: HOUR }
} as const satisfies Record<string, RateLimit>;

export type RateLimitName = keyof typeof rateLimits;

/** Liveness heartbeats sent by the client while the tab is visible. */
export const heartbeat = {
	/** How often the client beats while the tab is visible. */
	intervalMs: 20 * SECOND,
	/** Silence beyond this marks the play `stale`: it still saves and still counts for the streak. */
	staleAfterMs: 30 * MINUTE
} as const;

/** The offline puzzle pool — see "Generation pipeline" in the build spec. */
export const pool = {
	/** How far ahead `puzzle_schedule` is kept. */
	horizonDays: 90,
	/** Fall below this many scheduled days and the generation job fails loudly. */
	loudFailWatermarkDays: 30
} as const;

/** How long data we don't keep forever survives. */
export const retention = {
	/** Play rows belonging to a guest who never signed in. */
	guestPlaysDays: 90,
	/** Move logs are forensic data on their own clock; play rows are kept forever. */
	moveLogsDays: 30
} as const;

/** Abuse backstops that are deliberately generous rather than finely tuned. */
export const limits = {
	/** Soft cap on accepted friendships per account. */
	friendsPerAccount: 1000
} as const;
