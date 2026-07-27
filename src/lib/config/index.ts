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

import type { DifficultyTier } from '$lib/solver';

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
	/**
	 * `start` — per identity, enforced durably inside the Edge Function
	 * (`check_play_rate_limit`), so a direct call cannot skip it and a cold start
	 * cannot forget it. A DB constraint separately allows one open play per
	 * identity per date. The proxy hook also applies this as a cheap per-IP first
	 * pass; the per-identity limit is the authoritative backstop.
	 */
	start: { limit: 30, windowMs: HOUR },
	/** `submit` — per identity, enforced durably in the Edge Function (see `start`). */
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

/**
 * The offline puzzle pool — see "Generation pipeline" in the build spec.
 *
 * The horizon and the watermark are the operator-facing numbers; the two retry budgets
 * are the generator-facing ones. All four are tunable: none of them encodes a *rule*
 * (which tier a date targets is the ramp, in `$lib/pool/ramp.ts`, and that is code).
 */
export const pool = {
	/** How far ahead `puzzle_schedule` is kept, counting today. */
	horizonDays: 90,
	/** Fall below this many scheduled days of runway and the generation job fails loudly. */
	loudFailWatermarkDays: 30,
	/**
	 * How many boards to reject-sample per date while chasing its ramp tier. Generation
	 * targets a tier but cannot guarantee one on any single draw, so the pipeline samples
	 * and checks; this bounds that search before the date falls back to an off-tier board.
	 */
	tierAttemptsPerDate: 24,
	/**
	 * Per-tier override of that budget, for tiers whose boards are genuinely rare.
	 *
	 * `Intro` is the only entry and it is not a tuning whim: a 7×7 falls to pure forced
	 * propagation (deduction depth 0) in roughly **one draw in a hundred**, so the shared
	 * budget of 24 lands Monday's slot only about a quarter of the time. At 320 it lands
	 * ~98%, and because the budget is a CAP rather than a fixed count — the search stops
	 * at the first hit — the cost is only paid on the rare miss: ~0.6s per Monday, a few
	 * seconds across a whole 90-day horizon.
	 *
	 * A number, not a rule: which tier a date targets is the ramp (`$lib/pool/ramp.ts`),
	 * and that is code. This only says how hard to look before giving up (#52).
	 */
	tierAttemptsByTier: { Intro: 320 } as Partial<Record<DifficultyTier, number>>,
	/**
	 * How many distinct boards to try per date when the ones generated keep colliding with
	 * the canonical hash of an already-scheduled puzzle. A puzzle is scheduled at most once
	 * — the no-repeat guard — so a collision means generating a genuinely different board.
	 */
	boardAttemptsPerDate: 8
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
