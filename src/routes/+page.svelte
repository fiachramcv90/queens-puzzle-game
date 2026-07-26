<script lang="ts">
	import { onMount } from 'svelte';
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

<h1>Queens</h1>

{#if daily}
	<DailyPlay {daily} />
{:else if unavailable}
	<p>One queen per row, per column and per region — and no two queens touching, even diagonally.</p>
	<p class="placeholder">Today's daily isn't available. Check your connection and refresh.</p>
{:else}
	<p class="placeholder">Loading today's daily…</p>
{/if}
