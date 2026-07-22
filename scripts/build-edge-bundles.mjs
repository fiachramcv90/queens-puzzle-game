/**
 * Bundle the shared TypeScript the Edge Functions need into single Deno-loadable
 * files under `supabase/functions/_shared/`.
 *
 * Why a bundle instead of a direct import: the Supabase edge runtime only mounts
 * `supabase/`, so a function cannot reach `src/`; and Deno chokes on the solver's
 * extensionless imports and its type-only `types.ts` (an empty runtime module
 * fails graph creation). esbuild collapses each entry into one self-contained ESM
 * file — no cross-boundary import, no `.ts` extensions, no type-only module — so
 * `src/lib/solver` stays the single authored source of truth.
 *
 * The outputs are checked in so `supabase functions deploy` needs no Node step;
 * CI rebuilds them and fails on drift. Run manually after touching the solver or
 * config:  `npm run build:edge-bundles`
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each shared module the functions import, entry → bundled output. */
const BUNDLES = [
	{ entry: 'src/lib/solver/index.ts', out: 'supabase/functions/_shared/solver.bundle.js' },
	{ entry: 'src/lib/config/index.ts', out: 'supabase/functions/_shared/config.bundle.js' }
];

for (const { entry, out } of BUNDLES) {
	await build({
		entryPoints: [resolve(root, entry)],
		outfile: resolve(root, out),
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		target: 'deno1',
		// A banner so nobody hand-edits the generated file.
		banner: { js: `// GENERATED from ${entry} by scripts/build-edge-bundles.mjs — do not edit.` }
	});
	console.log(`  bundled ${entry} → ${out}`);
}

console.log('Edge bundles built.');
