<script lang="ts">
	import { publicSupabaseEnv } from '$lib/supabase/env';

	// Reading this here is the point, not decoration: it proves the anon key
	// reaches the browser while the service_role key — which lives behind
	// $lib/server — cannot be imported into this file at all. An unconfigured
	// environment says so rather than taking the page down.
	let supabase = $derived.by(() => {
		try {
			return { host: new URL(publicSupabaseEnv().url).host };
		} catch {
			return null;
		}
	});
</script>

<svelte:head>
	<title>Queens</title>
	<meta name="description" content="A daily Queens logic puzzle." />
</svelte:head>

<main>
	<h1>Queens</h1>
	<p>One queen per row, per column and per region — and no two queens touching, even diagonally.</p>
	<p class="placeholder">The daily isn't here yet. This is the scaffold.</p>
	<p class="placeholder">
		{#if supabase}
			Supabase: {supabase.host}
		{:else}
			Supabase: not configured — see README.md
		{/if}
	</p>
</main>

<style>
	main {
		max-width: 32rem;
		margin: 0 auto;
		padding: 4rem 1.5rem;
		font-family: system-ui, sans-serif;
		line-height: 1.6;
	}

	h1 {
		font-size: 3rem;
		margin: 0 0 1rem;
	}

	.placeholder {
		color: #666;
	}
</style>
