<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { Cell } from '$lib/solver';
	import type { Daily } from '$lib/game/types';
	import { GameState } from '$lib/game/game-state.svelte';
	import { getOrCreateGuestId, loadBlob, saveBlob } from '$lib/game/persistence';
	import Board from '$lib/components/Board.svelte';

	let { data }: { data: PageData } = $props();

	let game = $state<GameState | null>(null);
	/** True when neither the load nor the cache could produce a daily. */
	let unavailable = $state(false);

	// Set once in onMount, then read by the persistence effect after `game` exists.
	let storage: Storage | null = null;
	let guestId = '';
	let daily: Daily | null = null;

	onMount(() => {
		storage = window.localStorage;
		guestId = getOrCreateGuestId(storage);
		const blob = loadBlob(storage);

		// Prefer the freshly loaded daily; fall back to the cached one so a returning
		// player whose network is down still gets their board.
		daily = data.daily ?? blob?.daily ?? null;
		if (!daily) {
			unavailable = true;
			return;
		}

		game = new GameState(daily, blob?.play);

		// Advance the display-only timer once a second, until the board is solved.
		const timer = setInterval(() => {
			if (game && game.solvedElapsedMs === undefined) game.nowMs = Date.now();
			else clearInterval(timer);
		}, 1000);

		return () => clearInterval(timer);
	});

	// Persist on every change to the board or the timer's frozen result, so a
	// refresh or a closed tab restores exactly where the player left off. Created
	// at init (never inside onMount) and gated until the game exists.
	$effect(() => {
		if (!game || !storage || !daily) return;
		// Touch the reactive fields the snapshot depends on.
		void game.board;
		void game.solvedElapsedMs;
		void game.startedAt;
		saveBlob(storage, { guestId, prefs: {}, daily, play: game.snapshot() });
	});

	function formatTime(ms: number): string {
		const total = Math.floor(ms / 1000);
		const minutes = Math.floor(total / 60);
		const seconds = total % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>Queens</title>
	<meta name="description" content="A daily Queens logic puzzle." />
</svelte:head>

<main>
	<h1>Queens</h1>

	{#if game}
		<div class="meta">
			<span class="tier">{game.size}×{game.size} · {game.tier}</span>
			<span class="timer" class:solved={game.solved} aria-live="off"
				>{formatTime(game.elapsedMs)}</span
			>
		</div>

		<div
			class="board-wrap"
			style={`--cell-size: min(2.75rem, calc((100vw - 2.5rem) / ${game.size}))`}
		>
			<Board
				regionMap={game.regionMap}
				board={game.board}
				conflicts={game.conflicts}
				onTap={(row, col) => game?.tap(row, col)}
				onToggleX={(row, col) => game?.toggleX(row, col)}
				onSweep={(cells: readonly Cell[]) => game?.sweep(cells)}
			/>
		</div>

		<!-- The banner reports completion, not a credited time — the running timer
		     above is display-only and the server owns solve time (next ticket). -->
		<p class="status" class:won={game.solved}>
			{#if game.solved}
				✓ Solved
			{:else}
				{game.queenCount}/{game.size} queens placed
			{/if}
		</p>
		<p class="hint">
			Tap to cycle X → queen. Drag across empty cells to sweep X's. Right-click for a quick X.
		</p>
	{:else if unavailable}
		<p>
			One queen per row, per column and per region — and no two queens touching, even diagonally.
		</p>
		<p class="placeholder">Today's daily isn't available. Check your connection and refresh.</p>
	{:else}
		<p class="placeholder">Loading today's daily…</p>
	{/if}
</main>

<style>
	main {
		max-width: 32rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
		font-family: system-ui, sans-serif;
		line-height: 1.6;

		/* Board line-drawing tokens: heavy dark cage lines carry the regions with
		   all colour removed; the thin grid line separates cells within a region. */
		--cage-line: #1a1a1a;
		--cage-width: 2px;
		--grid-line: rgba(0, 0, 0, 0.12);
		--grid-width: 1px;
		--conflict-ring: #e24b4a;
	}

	h1 {
		font-size: 2.25rem;
		margin: 0 0 1rem;
	}

	.meta {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.tier {
		font-weight: 600;
		font-size: 1.05rem;
	}

	.timer {
		font-variant-numeric: tabular-nums;
		font-size: 1.05rem;
		color: #555;
	}
	.timer.solved {
		color: #0f6e56;
		font-weight: 600;
	}

	.board-wrap {
		margin: 0.25rem 0 1rem;
	}

	.status {
		font-weight: 500;
		margin: 0.5rem 0 0.25rem;
	}
	.status.won {
		color: #0f6e56;
	}

	.hint {
		color: #888;
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}

	.placeholder {
		color: #666;
	}

	/* The board is a light-surfaced card (its region fills are always light
	   pastels), so the cage and grid lines stay dark in both themes — inverting
	   them would make light-on-light lines vanish. Only the page chrome adapts. */
	@media (prefers-color-scheme: dark) {
		main {
			color: #e8e8e8;
		}
		.timer {
			color: #aaa;
		}
		.hint {
			color: #999;
		}
	}
</style>
