import postgres from 'postgres';

/**
 * A connection to the LOCAL Supabase Postgres for integration tests.
 *
 * These tests exercise the real Row Level Security policies against a running
 * `supabase start` stack — not a mock. That is the point: RLS is the product's
 * security boundary, and the only faithful test of a policy is the policy itself
 * enforcing on a real Postgres.
 *
 * The connection is the superuser `postgres` role. Tests never trust that; they
 * drop into `anon`, `authenticated` or `service_role` with `set local role`
 * inside a transaction (see {@link asRole}), which is exactly how PostgREST
 * presents each Data API caller to Postgres. `set local` scopes the role to the
 * transaction, so roles never leak between tests.
 */
const CONNECTION =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export type Sql = postgres.Sql;

/** A handle inside a transaction — what `asRole` and `sql.begin` hand their callback. */
export type TxSql = postgres.TransactionSql;

export function connect(): Sql {
	// One connection, no pool: tests run serially and role-switch per transaction.
	return postgres(CONNECTION, { max: 1, onnotice: () => {} });
}

/** A Data API role a query can run as. */
export type DataApiRole = 'anon' | 'authenticated' | 'service_role';

/**
 * Run `fn` inside a transaction as `role`, then roll the transaction back.
 *
 * `set local role` makes Postgres enforce the same RLS it would for that role
 * behind PostgREST. The rollback keeps role-scoped reads from mutating anything
 * and lets a test grant/revoke privileges to probe the RLS wall without leaving
 * a trace.
 */
export async function asRole<T>(
	sql: Sql,
	role: DataApiRole,
	fn: (tx: TxSql) => Promise<T>
): Promise<T> {
	let result!: T;
	await sql
		.begin(async (tx) => {
			await tx.unsafe(`set local role ${role}`);
			result = await fn(tx);
			// Undo everything this probe did — reads, and any grant/revoke it tried.
			throw new Rollback();
		})
		.catch((error) => {
			if (!(error instanceof Rollback)) throw error;
		});
	return result;
}

class Rollback extends Error {}
