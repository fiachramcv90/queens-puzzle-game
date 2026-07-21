import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, type Sql } from './client';

/**
 * The rollover rule lives in one function, and its bugs are seasonal: a fixed-UTC-
 * offset implementation would be right for half the year and wrong for the other
 * half, surfacing twice a year in production. So `dublin_date` is pinned at fixed
 * instants on BOTH sides of BOTH Dublin DST transitions.
 *
 * Dublin runs GMT (UTC+0) in winter and IST (UTC+1) in summer. Every instant below
 * was chosen so the naive bug — a fixed offset — would compute the wrong calendar
 * date, so the test actually catches it rather than passing by coincidence.
 */

let sql: Sql;

beforeAll(() => {
	sql = connect();
});

afterAll(async () => {
	await sql.end();
});

async function dublinDate(instant: string): Promise<string> {
	const [{ d }] = await sql<{ d: string }[]>`
    select public.dublin_date(${instant}::timestamptz)::text as d
  `;
	return d;
}

describe('dublin_date — the rollover rule, computed in-zone', () => {
	test('winter (GMT, UTC+0): 23:30 UTC is still the same Dublin day', async () => {
		// Under a fixed +1 offset this would wrongly roll to 2026-01-16.
		expect(await dublinDate('2026-01-15 23:30:00+00')).toBe('2026-01-15');
	});

	test('summer (IST, UTC+1): 23:30 UTC has already rolled to the next Dublin day', async () => {
		// Under a fixed +0 offset this would wrongly stay 2026-07-15. The winter/summer
		// pair together is the proof the offset is not hard-coded.
		expect(await dublinDate('2026-07-15 23:30:00+00')).toBe('2026-07-16');
	});

	test('summer rollover boundary: 22:59 UTC vs 23:00 UTC straddle midnight Dublin', async () => {
		expect(await dublinDate('2026-07-20 22:59:00+00')).toBe('2026-07-20');
		expect(await dublinDate('2026-07-20 23:00:00+00')).toBe('2026-07-21');
	});

	describe('spring-forward transition (2026-03-29, GMT→IST at 01:00 UTC)', () => {
		test('just before, still GMT (+0)', async () => {
			// A fixed +1 offset would wrongly report 2026-03-29.
			expect(await dublinDate('2026-03-28 23:30:00+00')).toBe('2026-03-28');
		});

		test('just after, now IST (+1)', async () => {
			// A fixed +0 offset would wrongly report 2026-03-29.
			expect(await dublinDate('2026-03-29 23:30:00+00')).toBe('2026-03-30');
		});
	});

	describe('fall-back transition (2026-10-25, IST→GMT at 01:00 UTC)', () => {
		test('just before, still IST (+1)', async () => {
			// A fixed +0 offset would wrongly report 2026-10-24.
			expect(await dublinDate('2026-10-24 23:30:00+00')).toBe('2026-10-25');
		});

		test('just after, now GMT (+0)', async () => {
			// A fixed +1 offset would wrongly report 2026-10-26.
			expect(await dublinDate('2026-10-25 23:30:00+00')).toBe('2026-10-25');
		});
	});
});

describe('dublin_today — the now()-bound wrapper', () => {
	test('agrees with dublin_date(now())', async () => {
		const [{ today, viaDate }] = await sql<{ today: string; viaDate: string }[]>`
      select public.dublin_today()::text as today,
             public.dublin_date(now())::text as "viaDate"
    `;
		expect(today).toBe(viaDate);
	});
});
