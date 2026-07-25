/**
 * Shared display formatting for solve times.
 *
 * One home for the `m:ss` rendering the timer, the result screen, the history list and
 * the archive all use, so they never drift into three slightly different clocks.
 */

/** Render a millisecond duration as `m:ss` (e.g. 102000 → "1:42"). */
export function formatTime(ms: number): string {
	const total = Math.floor(ms / 1000);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
