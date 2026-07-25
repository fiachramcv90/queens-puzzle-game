<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import type { Daily } from '$lib/game/types';
	import { loadBlob } from '$lib/game/persistence';
	import DailyPlay from '$lib/components/DailyPlay.svelte';

	let { data }: { data: PageData } = $props();

	/** Today's daily, resolved from the server load or (offline) the cached blob. */
	let daily = $state<Daily | null>(null);
	/** True when neither the load nor the cache could produce a daily. */
	let unavailable = $state(false);

	onMount(() => {
		// Prefer the freshly loaded daily; fall back to the cached one so a returning
		// player whose network is down still gets their board.
		const blob = loadBlob(window.localStorage);
		daily = data.daily ?? blob?.daily ?? null;
		if (!daily) unavailable = true;
	});
</script>

<svelte:head>
	<title>Queens</title>
	<meta name="description" content="A daily Queens logic puzzle." />
</svelte:head>

<main>
	<h1>Queens</h1>

	<nav class="links">
		<a href={resolve('/history')}>History</a>
		<a href={resolve('/archive')}>Archive</a>
	</nav>

	{#if daily}
		<DailyPlay {daily} />
	{:else if unavailable}
		<p>
			One queen per row, per column and per region — and no two queens touching, even diagonally.
		</p>
		<p class="placeholder">Today's daily isn't available. Check your connection and refresh.</p>
	{:else}
		<p class="placeholder">Loading today's daily…</p>
	{/if}
</main>

<style>
	main {
		max-width: 32rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		line-height: 1.6;

		/* Board line-drawing tokens: heavy dark cage lines carry the regions with
		   all colour removed; the thin grid line separates cells within a region. */
		--cage-line: #1a1a1a;
		--cage-width: 2px;
		--grid-line: rgba(0, 0, 0, 0.12);
		--grid-width: 1px;
		--conflict-ring: #e24b4a;
	}

	h1 {
		font-size: 2.25rem;
		margin: 0 0 0.5rem;
	}

	.links {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
		font-size: 0.95rem;
	}

	.placeholder {
		color: #666;
	}

	@media (prefers-color-scheme: dark) {
		main {
			color: #e8e8e8;
		}
	}
</style>
