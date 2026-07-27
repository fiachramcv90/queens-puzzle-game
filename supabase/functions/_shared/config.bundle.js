// GENERATED from src/lib/config/index.ts by scripts/build-edge-bundles.mjs — do not edit.

// src/lib/config/index.ts
var SECOND = 1e3;
var MINUTE = 60 * SECOND;
var HOUR = 60 * MINUTE;
var rateLimits = {
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
};
var heartbeat = {
  /** How often the client beats while the tab is visible. */
  intervalMs: 20 * SECOND,
  /** Silence beyond this marks the play `stale`: it still saves and still counts for the streak. */
  staleAfterMs: 30 * MINUTE
};
var pool = {
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
  tierAttemptsByTier: { Intro: 320 },
  /**
   * How many distinct boards to try per date when the ones generated keep colliding with
   * the canonical hash of an already-scheduled puzzle. A puzzle is scheduled at most once
   * — the no-repeat guard — so a collision means generating a genuinely different board.
   */
  boardAttemptsPerDate: 8
};
var retention = {
  /** Play rows belonging to a guest who never signed in. */
  guestPlaysDays: 90,
  /** Move logs are forensic data on their own clock; play rows are kept forever. */
  moveLogsDays: 30
};
var limits = {
  /** Soft cap on accepted friendships per account. */
  friendsPerAccount: 1e3
};
export {
  heartbeat,
  limits,
  pool,
  rateLimits,
  retention
};
