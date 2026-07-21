import { defineConfig } from 'vitest/config';

/**
 * Integration tests that run against a LOCAL Supabase Postgres with real RLS
 * policies (`tests/db`). Kept separate from the default unit-test project (`npm
 * run test`, `src/**`) because these need `supabase start` running — CI runs them
 * in a dedicated job that brings the stack up first.
 *
 * Run locally with `npm run test:db` once `supabase start` is up.
 */
export default defineConfig({
	test: {
		include: ['tests/db/**/*.test.ts'],
		environment: 'node',
		// A single DB connection, role-switched per transaction: run files serially so
		// fixtures in one file never race another's.
		fileParallelism: false,
		hookTimeout: 30_000
	}
});
