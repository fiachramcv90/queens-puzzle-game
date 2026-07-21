import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// The app deploys to Vercel — see docs/deployment.md. The runtime is
			// pinned rather than inferred from the local Node version, so a
			// developer on a newer Node still builds what production runs.
			adapter: adapter({ runtime: 'nodejs24.x' })
		})
	],
	test: {
		// Unit tests live next to the code they test, as `*.test.ts`.
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// The solver core is CPU-heavy (generation, counting to two over many
		// seeds). Run in parallel, several such tests contend for cores and a
		// single test's wall clock can drift past Vitest's 5s default — a flaky
		// timeout, not a slow test. Give them generous headroom; the property
		// tests that need even more set their own timeout inline.
		testTimeout: 30_000
	}
});
