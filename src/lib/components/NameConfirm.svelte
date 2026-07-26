<!--
  The one-time display-name confirm.

  It fires the first time a signed-in player does something SOCIAL — today that is
  opening the leaderboard; friends (#30) will be the second entry point. The name was
  seeded for them by the new-user trigger (an OAuth name, or an email local-part), so
  this is the moment they get to see it and change it before anyone else does.

  Whether it appears is NOT decided here. `shouldPromptNameConfirm` is the single home
  of that rule — signed in, still unconfirmed, and a social context, never during play
  and never for a guest — and this component only asks it. Nothing about the condition
  is re-stated below, so the leaderboard and friends cannot drift apart on it.

  `confirmDisplayName` retires the prompt for good by setting `name_confirmed`, so it
  is gone on the next visit and after a reload; the profile is re-read afterwards so
  the retirement is reflected without one.

  Deliberately not a modal. It is an inline panel in the page flow: focus moves to the
  input when it appears, Escape (or "Not now") dismisses it for this visit, and Tab
  walks straight out into the page — nothing is trapped, and a player who ignores it
  can still read the board underneath.
-->
<script lang="ts">
	import type { AuthState } from '$lib/auth/auth-state.svelte';
	import {
		confirmDisplayName,
		isConfirmableDisplayName,
		shouldPromptNameConfirm,
		type NameConfirmContext
	} from '$lib/auth/profile';

	interface Props {
		/** The shared auth state; its profile is what the prompt reads and writes. */
		auth: AuthState | undefined;
		/** Where the player is. Only `'social'` may prompt — see `shouldPromptNameConfirm`. */
		context: NameConfirmContext;
	}

	let { auth, context }: Props = $props();

	/** Dismissed for this visit only — an unconfirmed name is asked about again later. */
	let dismissed = $state(false);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	/** Edited independently of the profile, so a failed write leaves the typing intact. */
	let name = $state('');
	let seeded = $state(false);

	const open = $derived(!dismissed && shouldPromptNameConfirm(auth?.profile ?? null, context));

	// The profile arrives after mount (the layout starts auth in onMount), so the field is
	// seeded when it lands rather than at construction. Once seeded it is left alone: a
	// profile refresh must not overwrite what the player is halfway through typing.
	$effect(() => {
		const displayName = auth?.profile?.displayName;
		if (!seeded && displayName !== undefined) {
			name = displayName;
			seeded = true;
		}
	});

	// Move focus to the field when the prompt appears, so a keyboard or screen-reader
	// player is put where the decision is instead of having to hunt for it — and hand it
	// back where it came from when the panel goes, so dismissing does not dump a keyboard
	// player at the top of the document. The node binds on mount and unbinds on teardown,
	// so the cleanup runs on every close: confirmed, Escaped or "Not now".
	$effect(() => {
		const field = input;
		if (!field) return;
		const previous = document.activeElement;
		field.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	});

	async function confirm(): Promise<void> {
		if (!isConfirmableDisplayName(name)) return;
		busy = true;
		errorMessage = null;
		try {
			await confirmDisplayName(name);
			// Re-read so `nameConfirmed` (and the name shown in the header) is current; the
			// prompt closes because the rule now says so, not because of a local flag.
			await auth?.refreshProfile();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Could not save that name. Try again.';
		} finally {
			busy = false;
		}
	}
</script>

<!-- Escape is bound on the window rather than on the panel, and does nothing unless the
     prompt is open: it dismisses from wherever focus has wandered to, since the panel is
     not a focus trap and focus may legitimately be outside it. -->
<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') dismissed = true;
	}}
/>

{#if open}
	<section class="confirm" aria-labelledby="name-confirm-heading">
		<h2 id="name-confirm-heading">Is this your name?</h2>
		<p class="why">
			This is the name other players see next to your solve time on the leaderboard. We picked one
			for you — change it now if you'd rather be called something else.
		</p>

		<form
			onsubmit={(event) => {
				event.preventDefault();
				void confirm();
			}}
		>
			<label for="name-confirm-input">Display name</label>
			<input
				id="name-confirm-input"
				class="field"
				type="text"
				bind:this={input}
				bind:value={name}
				autocomplete="nickname"
				required
			/>
			<div class="actions">
				<button class="btn btn-primary" type="submit" disabled={busy || !isConfirmableDisplayName(name)}>
					{busy ? 'Saving…' : 'Use this name'}
				</button>
				<button class="btn" type="button" onclick={() => (dismissed = true)} disabled={busy}>
					Not now
				</button>
			</div>
		</form>

		{#if errorMessage}<p class="form-error">{errorMessage}</p>{/if}
	</section>
{/if}

<style>
	.confirm {
		margin: 0 0 var(--space-5);
		padding: 0.9rem 1rem 1rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface);
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.why {
		margin: 0.35rem 0 0.75rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.7;
	}

	input {
		width: 100%;
		margin-top: 0.25rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
</style>
