<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';
	import AuthPanel from '$lib/components/AuthPanel.svelte';
	import { AuthState } from '$lib/auth/auth-state.svelte';
	import { AUTH_CONTEXT } from '$lib/auth/context';

	let { children } = $props();

	// Auth is browser-only: it owns a Supabase session subscription and, on the first
	// authenticated load after guest play, silently merges the guest's history. It
	// never gates play — a guest sees an unchanged board.
	const auth = new AuthState();

	// Share the one auth instance with the page (the streak display reads the profile
	// through it), rather than threading it as a prop through the slot.
	setContext(AUTH_CONTEXT, auth);

	onMount(() => {
		let teardown: (() => void) | undefined;
		if (browser) {
			void auth.start().then((stop) => {
				teardown = stop;
			});
		}
		return () => teardown?.();
	});

	/**
	 * The site nav, owned here rather than repeated per route. Adding a destination (the
	 * leaderboard, friends) is one edit in one file — before this, each page listed the
	 * others and a new link meant touching every route.
	 */
	const LINKS = [
		{ id: '/', label: 'Today' },
		{ id: '/archive', label: 'Archive' },
		{ id: '/history', label: 'History' }
	] as const;

	/**
	 * Which nav entry is current, compared on the matched ROUTE ID rather than on the
	 * resolved href or the pathname. `resolve()` returns a relative URL whose form
	 * depends on the current route's depth (`./archive` from the root, `/archive` from
	 * `/history`), so comparing it to `page.url.pathname` matches only by coincidence.
	 * The route id is the same stable value these links are declared with.
	 *
	 * An archive daily lives at `/play/[date]`, so it marks Archive rather than nothing —
	 * that is the section the player navigated in from.
	 */
	function isCurrent(id: (typeof LINKS)[number]['id']): boolean {
		if (page.route.id === '/play/[date]') return id === '/archive';
		return page.route.id === id;
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="site-header">
	<AuthPanel {auth} />
</header>

<!-- The single page shell: width, typography and the board's line-drawing tokens. Route
     pages render their own heading and content inside it and no longer carry a copy. -->
<main>
	<nav class="links" aria-label="Sections">
		{#each LINKS as link (link.id)}
			<a href={resolve(link.id)} aria-current={isCurrent(link.id) ? 'page' : undefined}
				>{link.label}</a
			>
		{/each}
	</nav>

	{@render children()}
</main>

<style>
	.site-header {
		display: flex;
		justify-content: flex-end;
		padding: 0.75rem 1rem;
	}

	main {
		max-width: 32rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		line-height: 1.6;

		/* Board line-drawing tokens: heavy dark cage lines carry the regions with
		   all colour removed; the thin grid line separates cells within a region.
		   Defined on the shell so every route that renders a board inherits them. */
		--cage-line: #1a1a1a;
		--cage-width: 2px;
		--grid-line: rgba(0, 0, 0, 0.12);
		--grid-width: 1px;
		--conflict-ring: #e24b4a;
	}

	.links {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
		font-size: 0.95rem;
	}

	.links a[aria-current='page'] {
		font-weight: 700;
		text-decoration: none;
	}

	/* Page-level typography the routes produce. Scoped styles do not cross into the
	   slot, so the shared heading and placeholder rules are :global within `main`. */
	main :global(h1) {
		font-size: 2.25rem;
		margin: 0 0 0.5rem;
	}

	main :global(.placeholder) {
		color: #666;
	}

	@media (prefers-color-scheme: dark) {
		main {
			color: #e8e8e8;
		}
		main :global(.placeholder) {
			color: #aaa;
		}
	}
</style>
