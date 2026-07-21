/**
 * Version constants the spec requires be carried from day one.
 *
 * Both are stored on the rows the pipeline produces so a deploy skew is
 * observable rather than silent. The `unverified` failure mode exists precisely
 * because these can drift across a deploy: a spike in it is a deploy alarm, not
 * a cheating wave (see the MVP build spec, issue #18).
 *
 * Bump a version whenever a change would make old rows replay or regenerate
 * differently under the new code.
 */

/**
 * Identifies the generator that produced a puzzle. Stored on `puzzle_solutions`
 * rows alongside the difficulty signals.
 */
export const GENERATOR_VERSION = 1;

/**
 * Identifies the move-log wire format. Stored on play rows so the server knows
 * how to replay a log it did not itself write.
 */
export const MOVE_LOG_FORMAT_VERSION = 1;
