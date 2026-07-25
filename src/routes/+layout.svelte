<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import { browser } from '$app/environment';
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
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="site-header">
	<AuthPanel {auth} />
</header>

{@render children()}

<style>
	.site-header {
		display: flex;
		justify-content: flex-end;
		padding: 0.75rem 1rem;
	}
</style>
