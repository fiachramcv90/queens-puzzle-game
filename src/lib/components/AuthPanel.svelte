<!--
  The sign-in surface: Google in one tap, or an email magic link.

  Two rules shape this component, and neither is cosmetic:

  1. SIGNING IN GATES NOTHING A PLAYER IS DOING RIGHT NOW. It gates leaderboards,
     friends and cross-device sync — never solo or guest play. So the header holds a
     single compact button, and the form only exists once the player has asked for it.
     The earlier version rendered a raw button, an email input and a submit button
     inline in the header on every route, which put the sign-up furniture above the
     board on mobile and quietly contradicted the premise.

  2. THE PANEL IS DISMISSIBLE FROM ANYWHERE. It is a popover in the page flow, not a
     focus trap: Escape closes it, focus returns to the button that opened it, and a
     player who ignores it can keep playing underneath.

  Signed in, the same control becomes an account menu — display name and sign out.
-->
<script lang="ts">
	import { signInWithGoogle, signInWithMagicLink, signOut } from '$lib/auth/session';
	import { confirmDisplayName, isConfirmableDisplayName } from '$lib/auth/profile';
	import type { AuthState } from '$lib/auth/auth-state.svelte';

	let { auth }: { auth: AuthState } = $props();

	let open = $state(false);
	let email = $state('');
	let linkSent = $state(false);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);

	/**
	 * Renaming from the account menu — the only way to change a display name after the
	 * one-time confirm has been answered (#44).
	 *
	 * `NameConfirm` retires itself for good by setting `name_confirmed`, so without this
	 * a player who accepted their seeded name had no way back. That matters most for a
	 * magic-link signup, whose name is seeded from the email local-part: one keystroke
	 * would otherwise publish `firstname.lastname` to the global board permanently.
	 *
	 * The draft is separate from the profile so a failed write leaves the typing intact,
	 * the same way the confirm prompt does it.
	 */
	let editingName = $state(false);
	let nameDraft = $state('');
	let nameField = $state<HTMLInputElement | null>(null);

	function startRename(): void {
		nameDraft = auth.profile?.displayName ?? '';
		errorMessage = null;
		editingName = true;
	}

	function cancelRename(): void {
		editingName = false;
		errorMessage = null;
	}

	async function saveName(): Promise<void> {
		if (!isConfirmableDisplayName(nameDraft)) return;
		await run(async () => {
			// The same call the one-time prompt makes: it sets `name_confirmed` too, which is
			// already true here and stays true — a rename is a player choosing their name just
			// as much as the first confirm was.
			await confirmDisplayName(nameDraft);
			await auth.refreshProfile();
			editingName = false;
		});
	}

	// Focus the field when the rename opens, so the menu behaves like the confirm prompt
	// for a keyboard player rather than leaving them to find it.
	$effect(() => {
		if (editingName) nameField?.focus();
	});

	let trigger = $state<HTMLButtonElement | null>(null);
	let panel = $state<HTMLElement | null>(null);

	/**
	 * A minimal shape check, only to disable the submit before a round trip. The
	 * address is validated for real by the input's own `type="email"` and, definitively,
	 * by whether the link arrives — so this stays deliberately loose rather than
	 * rejecting a valid-but-unusual address.
	 */
	const emailLooksValid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

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

	function close(): void {
		open = false;
		editingName = false;
		errorMessage = null;
		trigger?.focus();
	}

	function toggle(): void {
		open = !open;
		if (!open) errorMessage = null;
	}

	function google() {
		return run(signInWithGoogle);
	}

	function magicLink() {
		return run(async () => {
			await signInWithMagicLink(email.trim());
			linkSent = true;
		});
	}

	/**
	 * Close on a click outside the control. Registered only while the panel is open, so
	 * the app carries no document listener in its resting state.
	 */
	$effect(() => {
		if (!open) return;
		function onDocumentPointerDown(event: PointerEvent) {
			const target = event.target as Node;
			if (panel?.contains(target) || trigger?.contains(target)) return;
			open = false;
		}
		document.addEventListener('pointerdown', onDocumentPointerDown);
		return () => document.removeEventListener('pointerdown', onDocumentPointerDown);
	});
</script>

<!-- Escape backs out one step at a time: it abandons a rename in progress before it
     closes the whole menu, so a mistyped name does not also cost the player the panel. -->
<svelte:window
	onkeydown={(event) => {
		if (!open || event.key !== 'Escape') return;
		if (editingName) cancelRename();
		else close();
	}}
/>

<div class="account">
	{#if auth.signedIn}
		<button
			class="btn btn-sm trigger"
			type="button"
			bind:this={trigger}
			onclick={toggle}
			aria-expanded={open}
			aria-haspopup="true"
		>
			<span class="avatar" aria-hidden="true">
				{(auth.profile?.displayName ?? '?').trim().charAt(0).toUpperCase()}
			</span>
			<span class="who">{auth.profile?.displayName ?? 'Signed in'}</span>
		</button>

		{#if open}
			<div class="panel" bind:this={panel}>
				{#if editingName}
					<form
						onsubmit={(event) => {
							event.preventDefault();
							void saveName();
						}}
					>
						<label class="rename-label" for="account-name-input">Display name</label>
						<input
							id="account-name-input"
							class="field"
							type="text"
							bind:this={nameField}
							bind:value={nameDraft}
							autocomplete="nickname"
							required
						/>
						<p class="panel-note">This is what friends and the leaderboard show.</p>
						<div class="rename-actions">
							<button
								class="btn btn-sm btn-primary"
								type="submit"
								disabled={busy || !isConfirmableDisplayName(nameDraft)}
							>
								{busy ? 'Saving…' : 'Save'}
							</button>
							<button class="btn btn-sm" type="button" onclick={cancelRename} disabled={busy}>
								Cancel
							</button>
						</div>
					</form>
				{:else}
					<p class="panel-name">{auth.profile?.displayName ?? 'Signed in'}</p>
					<p class="panel-note">Your history and streak sync across every device.</p>
					<div class="rename-actions">
						<button class="btn btn-sm" type="button" onclick={startRename} disabled={busy}>
							Change name
						</button>
						<button
							class="btn btn-sm"
							type="button"
							onclick={() => run(signOut).then(close)}
							disabled={busy}
						>
							{busy ? 'Signing out…' : 'Sign out'}
						</button>
					</div>
				{/if}

				{#if errorMessage}<p class="form-error">{errorMessage}</p>{/if}
			</div>
		{/if}
	{:else}
		<button
			class="btn btn-sm trigger"
			type="button"
			bind:this={trigger}
			onclick={toggle}
			aria-expanded={open}
			aria-haspopup="true"
		>
			Sign in
		</button>

		{#if open}
			<div class="panel" bind:this={panel}>
				{#if linkSent}
					<!-- The confirmation is the whole panel: a player who has just been sent a
					     link needs to know where to look, not another form to fill in. -->
					<p class="panel-title">Check your email</p>
					<p class="panel-note">
						We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this device and
						you'll be signed in.
					</p>
					<button
						class="btn btn-sm"
						type="button"
						onclick={() => {
							linkSent = false;
							email = '';
						}}
					>
						Use a different address
					</button>
				{:else}
					<p class="panel-title">Sign in to Queens</p>
					<p class="panel-note">
						Keeps your streak and history across devices, and puts you on the leaderboards. You can
						keep playing without it.
					</p>

					<!--
						Google's sign-in branding guidelines: the official four-colour mark at its
						correct proportions, on a neutral surface, with the wording "Sign in with
						Google" unaltered and the mark never recoloured or cropped.
					-->
					<button class="btn google" type="button" onclick={google} disabled={busy}>
						<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
							<path
								fill="#4285F4"
								d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
							/>
							<path
								fill="#34A853"
								d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
							/>
							<path
								fill="#FBBC05"
								d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
							/>
							<path
								fill="#EA4335"
								d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
							/>
						</svg>
						<span>Sign in with Google</span>
					</button>

					<div class="divider"><span>or</span></div>

					<form
						onsubmit={(e) => {
							e.preventDefault();
							magicLink();
						}}
					>
						<label for="auth-email">Email</label>
						<input
							id="auth-email"
							class="field"
							type="email"
							bind:value={email}
							placeholder="you@example.com"
							required
							autocomplete="email"
							disabled={busy}
						/>
						<button
							class="btn btn-primary submit"
							type="submit"
							disabled={busy || !emailLooksValid}
						>
							{busy ? 'Sending…' : 'Email me a link'}
						</button>
					</form>
				{/if}

				{#if errorMessage}<p class="form-error">{errorMessage}</p>{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.account {
		position: relative;
	}

	.trigger {
		max-width: 12rem;
	}

	.who {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 0.7rem;
		font-weight: 700;
		flex: none;
	}

	.panel {
		position: absolute;
		top: calc(100% + var(--space-2));
		right: 0;
		z-index: 20;
		width: min(19rem, calc(100vw - 2rem));
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
		text-align: left;
	}

	.panel-title,
	.panel-name {
		margin: 0 0 var(--space-1);
		font-weight: 700;
		font-size: var(--text-base);
	}

	.panel-note {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.rename-label {
		display: block;
		margin-bottom: 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.7;
	}

	.rename-label + .field {
		width: 100%;
		margin-bottom: var(--space-2);
	}

	.rename-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.google {
		width: 100%;
		background: #fff;
		color: #1f1f1f;
		border-color: #747775;
		font-weight: 500;
	}

	.google:hover:not(:disabled) {
		background: #f7f8f8;
	}

	.divider {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-3) 0;
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
	}

	label {
		display: block;
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		margin-bottom: var(--space-1);
	}

	input {
		width: 100%;
	}

	.submit {
		width: 100%;
		margin-top: var(--space-2);
	}
</style>
