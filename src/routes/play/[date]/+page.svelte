<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import DailyPlay from '$lib/components/DailyPlay.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Queens · {data.requestedDate}</title>
	<meta name="description" content="Play a past daily Queens puzzle from the archive." />
</svelte:head>

<main>
	<h1>Queens</h1>

	<nav class="links">
		<a href={resolve('/')}>Today</a>
		<a href={resolve('/archive')}>Archive</a>
		<a href={resolve('/history')}>History</a>
	</nav>

	{#if data.daily}
		<DailyPlay daily={data.daily} />
	{:else}
		<!-- A future date resolves to nothing under RLS, so this is also the "no
		     reachable future daily" case — the same message, no special path. -->
		<p class="placeholder">
			No daily is available for {data.requestedDate}. Only past and current dailies can be played.
		</p>
		<p><a href={resolve('/archive')}>Back to the archive</a></p>
	{/if}
</main>

<style>
	main {
		max-width: 32rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		line-height: 1.6;

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
