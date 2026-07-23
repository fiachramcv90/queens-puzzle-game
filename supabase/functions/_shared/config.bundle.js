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
  /** How far ahead `puzzle_schedule` is kept. */
  horizonDays: 90,
  /** Fall below this many scheduled days and the generation job fails loudly. */
  loudFailWatermarkDays: 30
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
