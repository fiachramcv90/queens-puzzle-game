<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { AUTH_CONTEXT, type AuthContext } from '$lib/auth/context';
	import { buildHistory, type HistoryEntry } from '$lib/history/history';
	import { loadHistoryRecords } from '$lib/history/load';
	import { formatTime } from '$lib/game/format';

	const auth = getContext<AuthContext>(AUTH_CONTEXT);

	let entries = $state<HistoryEntry[]>([]);
	let loaded = $state(false);

	onMount(() => {
		let cancelled = false;
		void loadHistoryRecords({ signedIn: auth?.signedIn ?? false, storage: window.localStorage })
			.then((records) => {
				if (cancelled) return;
				entries = buildHistory(records);
			})
			.catch(() => {
				// A read failure (offline for a signed-in player) leaves an empty list rather
				// than a broken page; a guest's local read cannot fail.
				if (!cancelled) entries = [];
			})
			.finally(() => {
				if (!cancelled) loaded = true;
			});
		return () => {
			cancelled = true;
		};
	});

	function mistakesLabel(mistakes: number | null): string {
		if (mistakes === null) return 'mistakes not verified';
		return `${mistakes} ${mistakes === 1 ? 'mistake' : 'mistakes'}`;
	}
</script>

<svelte:head>
	<title>Queens · History</title>
	<meta name="description" content="Every daily you've played — solve time, mistakes and hints." />
</svelte:head>

<h1>History</h1>

{#if !loaded}
	<p class="placeholder">Loading your history…</p>
{:else if entries.length === 0}
	<p class="placeholder">
		No solves yet. Play <a href={resolve('/')}>today's daily</a> or catch up in the
		<a href={resolve('/archive')}>archive</a>.
	</p>
{:else}
	<ul class="history">
		{#each entries as entry (entry.puzzleDate)}
			<li class="entry">
				<div class="row">
					<span class="date">{entry.puzzleDate}</span>
					<span class="time">
						{#if entry.ranked && entry.replayed && entry.ranked.elapsedMs !== entry.best.elapsedMs}
							<!-- The first-play-only rule, made visible rather than mysterious. -->
							your best: {formatTime(entry.best.elapsedMs)} · ranked:
							{formatTime(entry.ranked.elapsedMs)}
						{:else}
							{formatTime(entry.best.elapsedMs)}
						{/if}
					</span>
				</div>
				<div class="detail">
					<span>{mistakesLabel(entry.best.mistakes)}</span>
					{#if entry.best.hintsUsed > 0}
						<span>· {entry.best.hintsUsed} hint{entry.best.hintsUsed === 1 ? '' : 's'}</span>
					{/if}
					{#if entry.streakNeutral}
						<span class="tag">archive · streak-neutral · unranked</span>
					{:else if entry.assisted}
						<span class="tag">assisted · unranked</span>
					{:else if entry.unranked}
						<span class="tag">unranked</span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.history {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.entry {
		padding: 0.75rem 0;
		border-bottom: 1px solid rgba(0, 0, 0, 0.1);
	}

	.row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: baseline;
	}

	.date {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.time {
		font-variant-numeric: tabular-nums;
		color: #0f6e56;
		font-weight: 600;
	}

	.detail {
		margin-top: 0.15rem;
		color: #666;
		font-size: 0.85rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: baseline;
	}

	.tag {
		padding: 0.05rem 0.4rem;
		border-radius: 0.4rem;
		background: #f0ede6;
		color: #6b5f3f;
		font-size: 0.75rem;
	}

	@media (prefers-color-scheme: dark) {
		.entry {
			border-bottom-color: rgba(255, 255, 255, 0.12);
		}
		.detail {
			color: #aaa;
		}
		.tag {
			background: #2a2822;
			color: #cdbb8a;
		}
	}
</style>
