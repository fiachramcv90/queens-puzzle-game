<!--
  Actions that operate on the board itself, as opposed to help with solving it.

  There is one today — clear every mark — and where it sits is the point. It is NOT in
  `HintPanel`, because every control there charges the play `assisted` and costs it the
  global ranking. Clearing REMOVES information and can never bring a player closer to
  the solution, so it costs nothing: no server call, no charge, no confirm about
  ranking. Putting it among the hints would price it by association, and a player who
  believes tidying their notation costs them the leaderboard simply won't tidy it.

  What it does cost is the work itself, and that is irreversible — there is no undo
  anywhere in the app. So the clear goes through a confirm, and unlike the hint panel's
  one-time price acceptance this one fires EVERY time: the price there is paid once,
  the work destroyed here is new on each press.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { GameState } from '$lib/game/game-state.svelte';

	let { game }: { game: GameState } = $props();

	/** Whether the confirm is open. */
	let confirming = $state(false);
	/**
	 * How many marks the last clear removed, until the next one. Kept so the live
	 * region can report the result: the change is otherwise conveyed only by the grid
	 * repainting, which a screen-reader player never sees.
	 */
	let lastCleared = $state<number | null>(null);

	let confirmButton = $state<HTMLButtonElement | null>(null);
	let messageEl = $state<HTMLParagraphElement | null>(null);

	/** How many marks are down, from the state that owns the board. */
	const marks = $derived(game.markCount);

	/**
	 * The result of the last clear, dropped again as soon as the player marks a cell:
	 * it stops being news the moment they start re-marking, and a line reading "14 marks
	 * cleared" over a board filling back up is simply stale.
	 */
	const message = $derived(
		lastCleared === null || marks > 0
			? ''
			: `${lastCleared} ${lastCleared === 1 ? 'mark' : 'marks'} cleared.`
	);

	function askToClear(): void {
		lastCleared = null;
		confirming = true;
	}

	/**
	 * Pull focus into the confirm as it opens. Without this a keyboard player is left
	 * on the trigger with an alertdialog they have to go looking for — and the dialog's
	 * whole purpose is to be answered before anything else happens.
	 */
	$effect(() => {
		if (confirming) confirmButton?.focus();
	});

	async function clearNow(): Promise<void> {
		const cleared = marks;
		confirming = false;
		game.clearMarks();
		lastCleared = cleared;
		// The trigger disables itself the instant the last mark goes, and the confirm it
		// was answered from has just unmounted, so focus has nowhere to fall but <body>.
		// Send it to the result line instead: it lands the player on the answer to what
		// they just did rather than at the top of the document.
		await tick();
		messageEl?.focus();
	}
</script>

<section class="actions" aria-label="Board actions">
	<!-- Stays ENABLED while the confirm is open: disabling the button the player just
	     pressed drops focus to <body>, which is exactly where a keyboard player should
	     not be sent at the moment a dialog needs answering. -->
	<button
		class="btn btn-sm"
		type="button"
		onclick={askToClear}
		disabled={marks === 0}
		aria-expanded={confirming}
	>
		Clear all marks
	</button>

	{#if confirming}
		<div class="confirm" role="alertdialog" aria-labelledby="clear-confirm-heading">
			<!-- The count is named, so the player can see the size of what they are about to
			     lose, and so is what SURVIVES: the fear this control has to answer is that it
			     takes the queens with it. -->
			<p id="clear-confirm-heading" class="confirm-title">
				Clear all {marks}
				{marks === 1 ? 'mark' : 'marks'}?
			</p>
			<p class="confirm-detail">Your queens stay where they are. This can't be undone.</p>
			<div class="row">
				<button
					class="btn btn-sm btn-danger"
					type="button"
					bind:this={confirmButton}
					onclick={() => void clearNow()}
				>
					{marks === 1 ? 'Clear it' : 'Clear them'}
				</button>
				<button class="btn btn-sm" type="button" onclick={() => (confirming = false)}>
					Keep my marks
				</button>
			</div>
		</div>
	{/if}

	<!-- Always mounted, empty until there is something to say. A live region that appears
	     WITH its text already in it is commonly not announced at all — assistive tech
	     watches an existing region for changes — so the element has to outlive the
	     message rather than arrive with it. It collapses to nothing while empty.
	     `tabindex="-1"` makes it a focus target without putting it in the tab order. -->
	<p class="message" aria-live="polite" tabindex="-1" bind:this={messageEl}>{message}</p>
</section>

<style>
	.actions {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		margin: var(--space-3) 0 var(--space-2);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/* The same panel shape the hint confirm uses, in the danger hue rather than the
	   at-risk one: this asks about destroying work, not about a price. */
	.confirm {
		align-self: stretch;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-left: 3px solid var(--danger);
		border-radius: var(--radius);
		background: var(--warm-surface);
	}

	.confirm-title {
		margin: 0 0 var(--space-1);
		font-weight: 700;
		font-size: var(--text-sm);
	}

	.confirm-detail {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--warm-ink);
	}

	.message {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	/* Collapsed rather than removed: the live region has to stay in the accessibility
	   tree between clears for the next message to be announced as a CHANGE. */
	.message:empty {
		height: 0;
		overflow: hidden;
	}
</style>
