import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'.vercel/',
			'node_modules/',
			// Vendored from https://github.com/mattpocock/skills.
			'.claude/skills/',
			// Ephemeral git worktrees Claude Code creates for sub-agents; they carry
			// their own generated .svelte-kit output and are never part of the repo.
			'.claude/worktrees/',
			// Edge Functions run on Deno and are checked by the Supabase CLI.
			'supabase/functions/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		}
	}
);
