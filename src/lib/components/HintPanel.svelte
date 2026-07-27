<!--
  Help for a stuck player, priced honestly.

  Three hints, all opt-in, and ALL of them flip the play to `assisted` — which costs
  the global ranking and nothing else. The streak is untouched, even by a fully
  machine-revealed solve: integrity lives on the leaderboard, not on the streak. And
  once a play is assisted the hints are unlimited, because rationing help on a play
  that is already out of the ranking would punish twice for one decision.

  The confirm fires ONCE, before the first hint, and never again. A player who has
  already accepted the cost is not asked to re-accept it — the panel just says, plainly
  and permanently, that today is unranked.

  What is NOT here: the conflict ring. It is the free baseline every player gets, and
  treating it as a hint would make the honest default feel like a purchase.
-->
<script lang="ts">
	import type { Cell } from '$lib/solver';
	import type { GameState } from '$lib/game/game-state.svelte';
	import { findRuleViolations } from '$lib/game/hints';
	import { PlayRequestError, recordAssist, revealCell } from '$lib/game/play-client';

	interface Props {
		game: GameState;
		/** Persist the auto-mark-X preference. The `assisted` charge is not its business. */
		onAutoMarkXChange: (on: boolean) => void;
	}

	let { game, onAutoMarkXChange }: Props = $props();

	/** The hint waiting on the player's one-time confirmation, if any. */
	let pending = $state<null | 'check' | 'reveal' | 'auto'>(null);
	let busy = $state(false);
	let message = $state<string | null>(null);
	let failed = $state(false);

	/** Once the play is assisted the price has been paid, so stop asking. */
	function request(hint: 'check' | 'reveal' | 'auto'): void {
		message = null;
		failed = false;
		if (game.assisted) void take(hint);
		else pending = hint;
	}

	/**
	 * Charge the play, then apply the hint. The order is deliberate: if the charge
	 * cannot be recorded, the help is not given. Applying first and recording after
	 * would make a dropped request into a free hint.
	 */
	async function take(hint: 'check' | 'reveal' | 'auto'): Promise<void> {
		pending = null;
		if (!game.token) {
			failed = true;
			message = "This play isn't anchored on the server yet — try again in a moment.";
			return;
		}
		busy = true;
		failed = false;
		message = null;
		try {
			if (hint === 'reveal') {
				// `reveal` charges as part of answering, so there is no separate call.
				const result = await revealCell(game.token, game.board);
				game.assisted = result.assisted || game.assisted;
				if (result.hintsUsed !== null) game.hintsUsed = result.hintsUsed;
				if (!result.cell) {
					message = 'Every queen is already placed — there is nothing left to reveal.';
				} else {
					game.reveal(result.cell);
					message = `Revealed a queen at row ${result.cell.row + 1}, column ${result.cell.col + 1}.`;
				}
			} else {
				const charged = await recordAssist(game.token);
				game.assisted = charged.assisted;
				if (charged.hintsUsed !== null) game.hintsUsed = charged.hintsUsed;

				if (hint === 'check') {
					const violations: Cell[] = findRuleViolations(game.board, game.regionMap);
					game.flag(violations);
					message =
						violations.length === 0
							? 'Nothing on the board breaks a rule right now.'
							: `${violations.length} ${violations.length === 1 ? 'queen breaks' : 'queens break'} a rule — they're ringed on the board.`;
				} else {
					game.setAutoMarkX(true);
					onAutoMarkXChange(true);
					message = "Ruled-out cells are marked for you. They'll update as you place queens.";
				}
			}
		} catch (cause) {
			failed = true;
			// A refusal and an unreachable server are different problems, and telling a
			// player to "check your connection" when the connection is fine sends them
			// hunting for a fault they do not have. `PlayRequestError` means the request
			// arrived and came back non-2xx, so say that instead.
			message =
				cause instanceof PlayRequestError
					? 'The server turned that hint down, so none was given. Try again in a moment.'
					: "Couldn't reach the server, so no hint was given. Check your connection.";
		} finally {
			busy = false;
		}
	}

	/** Turning the assist OFF is free — the play is already assisted. */
	function stopAutoMarkX(): void {
		game.setAutoMarkX(false);
		onAutoMarkXChange(false);
		message = null;
	}

	const labels = {
		check: 'Check for mistakes',
		reveal: 'Reveal a queen',
		auto: 'Mark ruled-out cells'
	} as const;
</script>

<section class="hints" aria-label="Hints">
	<div class="row">
		<button class="btn btn-sm" type="button" onclick={() => request('check')} disabled={busy}>
			{labels.check}
		</button>
		<button class="btn btn-sm" type="button" onclick={() => request('reveal')} disabled={busy}>
			{labels.reveal}
		</button>
		{#if game.autoMarkX}
			<button class="btn btn-sm" type="button" onclick={stopAutoMarkX} disabled={busy}>
				Stop marking for me
			</button>
		{:else}
			<button class="btn btn-sm" type="button" onclick={() => request('auto')} disabled={busy}>
				{labels.auto}
			</button>
		{/if}
	</div>

	{#if pending}
		<!--
			The one-time confirm. It states the cost and, just as importantly, what the
			cost is NOT: a player who thinks a hint breaks their streak will not take one
			even when they need it, and will abandon the puzzle instead.
		-->
		<div class="confirm" role="alertdialog" aria-labelledby="hint-confirm-heading">
			<p id="hint-confirm-heading" class="confirm-title">
				Using a hint makes today's time unranked.
			</p>
			<p class="confirm-detail">
				Your streak is safe, and your time is still saved to your history — you just won't appear on
				the global board today. After this, hints are unlimited.
			</p>
			<div class="row">
				<button class="btn btn-sm btn-primary" type="button" onclick={() => take(pending!)}>
					{labels[pending]} anyway
				</button>
				<button class="btn btn-sm" type="button" onclick={() => (pending = null)}>
					Keep my time ranked
				</button>
			</div>
		</div>
	{/if}

	{#if game.assisted}
		<p class="state">
			Assisted — today's time is unranked. {game.hintsUsed}
			{game.hintsUsed === 1 ? 'hint' : 'hints'} used. Hints are unlimited from here.
		</p>
	{/if}

	<!-- aria-live so a screen-reader player hears the mistake check's result, which is
	     otherwise conveyed only by rings drawn on the board. -->
	{#if message}
		<p class="message" class:failed aria-live="polite">{message}</p>
	{/if}
</section>

<style>
	.hints {
		margin: 0 0 var(--space-4);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.confirm {
		margin-top: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-left: 3px solid var(--streak-at-risk);
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

	.state {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xs);
		color: var(--warm-ink);
	}

	.message {
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.message.failed {
		color: var(--danger);
	}
</style>
