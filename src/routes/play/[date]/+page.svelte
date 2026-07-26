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

<h1>Queens</h1>

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
