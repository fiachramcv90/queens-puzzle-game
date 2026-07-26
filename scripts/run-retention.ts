/**
 * The retention sweep and the unverified alarm (#33).
 *
 * Run on a schedule by `.github/workflows/retention.yml`, and manually dispatchable
 * so an operator can sweep or check the alarm without waiting for the cron.
 *
 * Both retention jobs run as INDEPENDENT calls, in the order that matters least —
 * because it genuinely does not matter. `purge_guest_plays` cannot touch a row with
 * a `user_id`, and `purge_move_logs` deletes only from `play_move_logs`. Neither can
 * reach the other's data, which is the property the two-jobs-not-one design exists
 * to guarantee.
 *
 * The alarm is a report, not a gate on the sweep: a spike in `unverified` must never
 * be a reason to stop purging, and a purge failure must never hide the alarm. So they
 * are reported together and the exit code reflects both.
 *
 * Numbers come from `src/lib/config` (`retention.*`), never inline here.
 */

import { retention } from '../src/lib/config/index';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
	console.error('PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
	process.exit(1);
}

/** The `unverified` percentage that turns a report into a warning. */
const ALARM_PCT = Number(process.env.UNVERIFIED_ALARM_PCT ?? '5');

const dryRun = process.argv.includes('--dry-run');

interface RateRow {
	day: string;
	completed_plays: number;
	unverified_plays: number;
	unverified_pct: number | null;
	generator_versions: number[] | null;
	move_log_versions: number[] | null;
}

/** Call a security-definer function over the REST API with the secret key. */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
	const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			apikey: key!,
			authorization: `Bearer ${key}`
		},
		body: JSON.stringify(args)
	});
	if (!res.ok) {
		throw new Error(`${fn} failed: ${res.status} ${await res.text()}`);
	}
	return (await res.json()) as T;
}

async function main(): Promise<void> {
	let failed = false;

	// --- The alarm, first: an operator reading the log wants this at the top. ---
	try {
		const rows = await rpc<RateRow[]>('unverified_rate', { p_days: 14 });
		console.log('\nUnverified rate (last 14 days)');
		console.log('  day         plays  unverified   %    generator  move-log');
		for (const r of rows) {
			const pct = r.unverified_pct ?? 0;
			console.log(
				`  ${r.day}  ${String(r.completed_plays).padStart(5)}  ` +
					`${String(r.unverified_plays).padStart(10)}  ${String(pct).padStart(5)}  ` +
					`${JSON.stringify(r.generator_versions ?? [])}  ${JSON.stringify(r.move_log_versions ?? [])}`
			);
		}

		// Yesterday rather than today: today is partial, and a handful of plays can
		// make a meaningless percentage look alarming.
		const recent = rows[1] ?? rows[0];
		if (recent && (recent.unverified_pct ?? 0) >= ALARM_PCT && recent.completed_plays >= 20) {
			// A ::warning:: surfaces on the workflow run itself, which is the point —
			// #53 flagged that a warning nobody reads is a blemish nobody sees.
			console.log(
				`::warning::unverified is ${recent.unverified_pct}% on ${recent.day} ` +
					`(${recent.unverified_plays}/${recent.completed_plays}). ` +
					`SUSPECT A SOLVER-CORE DEPLOY SKEW FIRST, not cheating — compare the ` +
					`generator_version and move-log format version columns above against the day it started.`
			);
			failed = true;
		}
	} catch (error) {
		console.error('::error::could not read the unverified rate:', error);
		failed = true;
	}

	if (dryRun) {
		console.log('\n--dry-run: no rows deleted.');
		process.exit(failed ? 1 : 0);
	}

	// --- The two sweeps, independently. A failure in one must not skip the other. ---
	try {
		const deleted = await rpc<number>('purge_guest_plays', {
			p_older_than_days: retention.guestPlaysDays
		});
		console.log(
			`\nPurged ${deleted} unconverted guest play rows older than ${retention.guestPlaysDays} days.`
		);
	} catch (error) {
		console.error('::error::guest play purge failed:', error);
		failed = true;
	}

	try {
		const deleted = await rpc<number>('purge_move_logs', {
			p_older_than_days: retention.moveLogsDays
		});
		console.log(
			`Dropped ${deleted} move logs older than ${retention.moveLogsDays} days. Play rows are kept.`
		);
	} catch (error) {
		console.error('::error::move log purge failed:', error);
		failed = true;
	}

	process.exit(failed ? 1 : 0);
}

void main();
