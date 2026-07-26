<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import { AUTH_CONTEXT, type AuthContext } from '$lib/auth/context';
	import { loadHistoryRecords } from '$lib/history/load';
	import { dublinToday } from '$lib/streak/streak';

	let { data }: { data: PageData } = $props();

	const auth = getContext<AuthContext>(AUTH_CONTEXT);
	const today = dublinToday();

	/** The daily dates the player has completed at least once, for the "solved" marker. */
	let played = $state<Set<string>>(new Set());

	onMount(() => {
		let cancelled = false;
		void loadHistoryRecords({ signedIn: auth?.signedIn ?? false, storage: window.localStorage })
			.then((records) => {
				if (cancelled) return;
				played = new Set(records.filter((r) => r.completed).map((r) => r.puzzleDate));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:head>
	<title>Queens · Archive</title>
	<meta name="description" content="Every past daily since launch — permanently playable." />
</svelte:head>

<h1>Archive</h1>

<p class="intro">
	Every past daily since launch stays playable — no account needed. Archive solves are recorded to
	your history but don't affect your streak or that day's leaderboard.
</p>

{#if data.dailies.length === 0}
	<p class="placeholder">
		The archive isn't available right now. Check your connection and refresh.
	</p>
{:else}
	<ul class="archive">
		{#each data.dailies as d (d.date)}
			<li class="entry">
				<a href={d.date === today ? resolve('/') : resolve('/play/[date]', { date: d.date })}>
					<span class="date">{d.date}</span>
					<span class="tier">{d.boardSize}×{d.boardSize} · {d.tier}</span>
					{#if d.date === today}
						<span class="tag today">today</span>
					{/if}
					{#if played.has(d.date)}
						<span class="tag solved">solved</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.intro {
		color: var(--text-muted);
		font-size: 0.9rem;
		margin: 0 0 1rem;
	}

	.archive {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.entry a {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding: 0.7rem 0;
		border-bottom: 1px solid var(--border);
		text-decoration: none;
		color: inherit;
	}
	.entry a:hover .date {
		text-decoration: underline;
	}

	.date {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.tier {
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.tag {
		margin-left: auto;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		background: var(--warm-surface);
		color: var(--warm-ink);
	}
	.tag.solved {
		margin-left: 0;
		background: var(--accent-surface);
		color: var(--accent);
	}
</style>
