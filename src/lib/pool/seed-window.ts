/**
 * The seed window: which dates to seed the pool for, and the board parameters each gets.
 *
 * Both seed scripts build from this one home — `scripts/seed-puzzles.ts` (local Postgres)
 * and `scripts/seed-remote.ts` (a hosted project over the REST API) — so the two cannot
 * drift, and the numeric rule that decides a board's identity is unit-testable rather
 * than buried in a script.
 *
 * The window is deliberately FORWARD-LOOKING. A backward-only window goes stale the
 * moment a real day passes: today outruns the last scheduled date, the daily falls back
 * to the latest past board, and that board then correctly reads as an archive play. So
 * the window spans a past run (for the archive) and a future run (for runway), gap-free,
 * always including today.
 *
 * This is the interim stand-in for the generation pipeline (issue #32), which will keep
 * the schedule ~90 days ahead on a cron; it is expected to consume this same window.
 */

/**
 * A gentle repeating size ramp so consecutive dailies vary rather than serving one board
 * size for a week. Sizes stay inside the 7–11 range the generator targets, and low enough
 * that seeding a whole window stays quick.
 */
export const SIZE_RAMP = [7, 7, 8, 8, 9, 9, 10] as const;

/**
 * The hand-picked seeds the original local seed script used, recorded so the window can be
 * proven never to reproduce one of their boards.
 *
 * This is not trivia. A seed plus a size fully determines a board, so reusing a legacy
 * pair regenerates that exact board — whose canonical hash matches a puzzle that is
 * already scheduled. `puzzle_schedule.puzzle_id` is unique (a puzzle is scheduled at most
 * once, so a returning player never gets a board they have already solved), so the insert
 * fails. That is precisely how the 2026-08-07 seed run broke.
 */
export const LEGACY_SEEDS: readonly number[] = [1001, 1002, 1003, 1004, 1005, 1006];

/** One date to seed, with the parameters that determine its board. */
export interface SeedEntry {
	/** The daily's date, `YYYY-MM-DD` (Europe/Dublin). */
	readonly date: string;
	readonly size: number;
	/** The generator's RNG seed — see {@link seedForDate}. */
	readonly seed: number;
}

/** How wide a window to build, and the Dublin date it is anchored on. */
export interface SeedWindowOptions {
	/** Today's Dublin date, `YYYY-MM-DD`. */
	readonly today: string;
	/** Days of archive to seed behind today. */
	readonly pastDays: number;
	/** Days of runway to seed ahead of today (hidden by RLS until each arrives). */
	readonly futureDays: number;
}

/**
 * The Dublin date `offset` days from `from` (negative = earlier). Pure calendar arithmetic
 * at UTC midnight, so it never depends on the runtime zone — the same approach
 * `previousDate` in `$lib/streak` uses.
 */
export function shiftDate(from: string, offset: number): string {
	const [year, month, day] = from.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1, day) + offset * 86_400_000);
	return shifted.toISOString().slice(0, 10);
}

/**
 * The RNG seed for a date: its own `YYYYMMDD` as an integer.
 *
 * Derived from the date rather than from a position in the window, for two reasons. It is
 * STABLE — the same date regenerates the same board whatever window it is seeded in, so a
 * re-run is genuinely idempotent — and it occupies a numeric range that cannot collide
 * with {@link LEGACY_SEEDS}.
 */
export function seedForDate(date: string): number {
	return Number(date.replaceAll('-', ''));
}

/**
 * The continuous window of dates to seed, oldest first, always including `today`. Each
 * date carries a size from {@link SIZE_RAMP} and its own date-derived seed.
 */
export function buildSeedWindow(options: SeedWindowOptions): SeedEntry[] {
	const { today, pastDays, futureDays } = options;
	return Array.from({ length: pastDays + futureDays + 1 }, (_unused, i): SeedEntry => {
		const date = shiftDate(today, -(pastDays - i));
		return {
			date,
			size: SIZE_RAMP[i % SIZE_RAMP.length],
			seed: seedForDate(date)
		};
	});
}
