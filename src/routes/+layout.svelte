<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';
	import AuthPanel from '$lib/components/AuthPanel.svelte';
	import { AuthState } from '$lib/auth/auth-state.svelte';
	import { AUTH_CONTEXT } from '$lib/auth/context';
	import '../app.css';

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
	 *
	 * Ordered by how often a player reaches for each one. Leaderboard sits second, right
	 * behind Today, because it is part of the daily loop: solve the daily, then see where
	 * that time landed. Archive and History are the occasional visits — a past daily, or
	 * a look back at the streak — so they stay behind it.
	 */
	const LINKS = [
		{ id: '/', label: 'Today' },
		{ id: '/leaderboard', label: 'Leaderboard' },
		{ id: '/friends', label: 'Friends' },
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

<!--
  The shell: wordmark first, account second.

  The order here is the product's premise made visible. A guest plays immediately with
  no account and no prompt, so the sign-in control is a single compact button on the
  right rather than the three raw form controls that used to be the first thing on
  every page — above the word "Queens" and above the board. Signing in still gates
  leaderboards, friends and cross-device sync, and still gates nothing else.
-->
<header class="site-header">
	<a class="wordmark" href={resolve('/')}>
		<img src={favicon} alt="" width="28" height="28" />
		<span>Queens</span>
	</a>
	<AuthPanel {auth} />
</header>

<nav class="links" aria-label="Sections">
	<ul>
		{#each LINKS as link (link.id)}
			<li>
				<a href={resolve(link.id)} aria-current={isCurrent(link.id) ? 'page' : undefined}
					>{link.label}</a
				>
			</li>
		{/each}
	</ul>
</nav>

<!-- The single page shell: width and typography. Route pages render their own heading
     and content inside it and no longer carry a copy. -->
<main>
	{@render children()}
</main>

<style>
	/* One column measurement, shared by the header, the nav and the page, so the
	   wordmark, the tabs and the board all sit on the same left edge. */
	.site-header,
	.links,
	main {
		max-width: 34rem;
		margin-inline: auto;
		padding-inline: var(--space-4);
	}

	.site-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-block: var(--space-3);
	}

	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-lg);
		font-weight: 700;
		letter-spacing: -0.01em;
		color: inherit;
		text-decoration: none;
	}

	.wordmark img {
		display: block;
	}

	/* Section tabs. Every state is drawn: the current one is not merely bold, it
	   carries the accent and an underline rule, so which page you are on reads at a
	   glance instead of by comparing font weights. */
	.links {
		border-bottom: 1px solid var(--border);
		padding-bottom: 0;
	}

	.links ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.links a {
		display: inline-block;
		padding: var(--space-2) 0;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-muted);
		text-decoration: none;
		/* Reserve the current-page rule on every tab so nothing shifts on navigation. */
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}

	.links a:hover {
		color: var(--text);
	}

	.links a[aria-current='page'] {
		color: var(--accent);
		font-weight: 700;
		border-bottom-color: var(--accent);
	}

	main {
		padding-block: var(--space-5) var(--space-6);
	}

	/* Page-level typography the routes produce. Scoped styles do not cross into the
	   slot, so the shared heading and placeholder rules are :global within `main`. */
	main :global(h1) {
		font-size: var(--text-2xl);
		line-height: 1.15;
		letter-spacing: -0.02em;
		margin: 0 0 var(--space-2);
	}

	/* The shared empty / loading / offline state. It reads as a deliberate panel
	   rather than a stray grey paragraph, which is what a player sees on their first
	   visit if the daily has not loaded yet. */
	main :global(.placeholder) {
		display: block;
		margin: var(--space-4) 0;
		padding: var(--space-4);
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-align: center;
	}

	main :global(.placeholder a) {
		color: var(--accent);
	}
</style>
