/**
 * The streak rule, client-side.
 *
 * A streak is CONSECUTIVE DAYS THE DAILY WAS SOLVED, measured against the global
 * Europe/Dublin rollover. The database owns a signed-in player's streak (the cache on
 * `profiles`, written by the play lifecycle and read through `effective_current_streak`);
 * this module is the guest's equivalent, deriving the same three numbers from the
 * dates a guest solved locally, and the shared READ rule both a guest and a signed-in
 * player display through.
 *
 * It is deliberately Svelte-free and clock-injectable so the whole rule — including
 * the at-risk read that "a player must never be told they've lost something they still
 * have all day to keep" — is unit-testable without a browser. `dublinDate` mirrors the
 * SQL `dublin_date`, computed in-zone so it is correct across DST.
 */

/** The three streak facts, matching the profile cache columns. Dates are `YYYY-MM-DD`. */
export interface StreakCache {
	readonly currentStreak: number;
	readonly longestStreak: number;
	/** The most recent Dublin date that counted, or null if the player has never solved. */
	readonly lastStreakDate: string | null;
}

/** The streak as the UI shows it: the time-aware current value, longest, and at-risk. */
export interface StreakView {
	/** The at-risk read: the cached streak while still live, 0 once a day has elapsed. */
	readonly current: number;
	readonly longest: number;
	/** Held from a previous day and not yet solved today — losable if today elapses. */
	readonly atRisk: boolean;
}

/**
 * The Europe/Dublin calendar date of an instant as `YYYY-MM-DD`. The client mirror of
 * SQL `dublin_date`: computed in-zone (the `en-CA` locale renders ISO `YYYY-MM-DD`), so
 * it is correct on both sides of a DST transition rather than off by an hour.
 */
export function dublinDate(instant: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(instant);
}

/** Today's Dublin date. The client mirror of SQL `dublin_today()`. */
export function dublinToday(): string {
	return dublinDate();
}

/**
 * The Dublin calendar date one day before `date`. Pure calendar arithmetic: the label
 * is parsed at UTC midnight and shifted a day, so it never depends on the runtime zone.
 */
export function previousDate(date: string): string {
	const [y, m, d] = date.split('-').map(Number);
	const shifted = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
	const yy = shifted.getUTCFullYear();
	const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(shifted.getUTCDate()).padStart(2, '0');
	return `${yy}-${mm}-${dd}`;
}

/**
 * Rebuild the three streak facts from the set of Dublin dates a player solved. The
 * client's `recompute_streaks`: the input is eligible solved dates (a guest only ever
 * plays today's daily, so every local solve is eligible), and the output is the run
 * ending at the most recent date, the longest run seen, and that most recent date.
 * Duplicates and order in the input do not matter.
 */
export function computeStreak(solvedDates: Iterable<string>): StreakCache {
	const unique = [...new Set(solvedDates)].sort();
	if (unique.length === 0) {
		return { currentStreak: 0, longestStreak: 0, lastStreakDate: null };
	}

	let longest = 1;
	let current = 1;
	for (let i = 1; i < unique.length; i++) {
		// Consecutive iff the previous day is exactly one Dublin day earlier.
		current = previousDate(unique[i]) === unique[i - 1] ? current + 1 : 1;
		if (current > longest) longest = current;
	}

	return {
		currentStreak: current,
		longestStreak: longest,
		lastStreakDate: unique[unique.length - 1]
	};
}

/**
 * The at-risk read, the client mirror of SQL `effective_current_streak`: the cached
 * current streak while `lastStreakDate >= today - 1` (solved today, or solved yesterday
 * and pending today), and 0 once a whole day has elapsed unsolved.
 */
export function effectiveStreak(cache: StreakCache, today: string = dublinToday()): number {
	if (cache.lastStreakDate === null) return 0;
	return cache.lastStreakDate >= previousDate(today) ? cache.currentStreak : 0;
}

/**
 * Whether the streak is held from a previous day and not yet extended today — the state
 * the player can still keep by solving before the day elapses. False once today is
 * solved (safe), and false once a day has already elapsed (nothing left to lose).
 */
export function isAtRisk(cache: StreakCache, today: string = dublinToday()): boolean {
	return cache.currentStreak > 0 && cache.lastStreakDate === previousDate(today);
}

/** Project a cache to what the UI renders: the time-aware current, longest, and at-risk. */
export function viewStreak(cache: StreakCache, today: string = dublinToday()): StreakView {
	return {
		current: effectiveStreak(cache, today),
		longest: cache.longestStreak,
		atRisk: isAtRisk(cache, today)
	};
}
