<!--
  The sign-in surface: Google in one tap, or an email magic link. Deliberately small
  and out of the way — signing in gates leaderboards, friends and cross-device sync,
  never solo or guest play, so a guest can ignore it entirely and keep playing.

  When signed in it shows the display name and a sign-out control instead.
-->
<script lang="ts">
	import { signInWithGoogle, signInWithMagicLink, signOut } from '$lib/auth/session';
	import type { AuthState } from '$lib/auth/auth-state.svelte';

	let { auth }: { auth: AuthState } = $props();

	let email = $state('');
	let linkSent = $state(false);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);

	async function run(action: () => Promise<void>) {
		busy = true;
		errorMessage = null;
		try {
			await action();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Something went wrong. Try again.';
		} finally {
			busy = false;
		}
	}

	function google() {
		return run(signInWithGoogle);
	}

	function magicLink() {
		return run(async () => {
			await signInWithMagicLink(email);
			linkSent = true;
		});
	}
</script>

{#if auth.signedIn}
	<div class="auth">
		<span class="who">{auth.profile?.displayName ?? 'Signed in'}</span>
		<button type="button" onclick={() => run(signOut)} disabled={busy}>Sign out</button>
	</div>
{:else if linkSent}
	<p class="auth">Check your email for a sign-in link.</p>
{:else}
	<div class="auth">
		<button type="button" onclick={google} disabled={busy}>Sign in with Google</button>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				magicLink();
			}}
		>
			<input
				type="email"
				bind:value={email}
				placeholder="you@example.com"
				required
				autocomplete="email"
			/>
			<button type="submit" disabled={busy || email.length === 0}>Email me a link</button>
		</form>
		{#if errorMessage}<p class="error">{errorMessage}</p>{/if}
	</div>
{/if}

<style>
	.auth {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.who {
		font-weight: 600;
	}
	.error {
		color: #b00020;
		flex-basis: 100%;
		margin: 0;
	}
</style>
