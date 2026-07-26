<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { AUTH_CONTEXT, type AuthContext } from '$lib/auth/context';
	import { buildHistory } from '$lib/history/history';
	import { loadHistoryRecords } from '$lib/history/load';
	import { formatTime } from '$lib/game/format';
	import { dublinToday } from '$lib/streak/streak';
	import { fetchGlobalLeaderboard } from '$lib/leaderboard/leaderboard-client';
	import {
		ownStanding,
		type LeaderboardEntry,
		type OwnStanding
	} from '$lib/leaderboard/leaderboard';
	import NameConfirm from '$lib/components/NameConfirm.svelte';

	const auth = getContext<AuthContext>(AUTH_CONTEXT);
	const today = dublinToday();

	let entries = $state<LeaderboardEntry[]>([]);
	let hasNext = $state(false);
	let page = $state(0);
	let loaded = $state(false);
	let failed = $state(false);
	let standing = $state<OwnStanding | null>(null);

	/**
	 * The most recent page asked for. Two quick taps on Next start two reads that can
	 * land in either order, so a stale reply must not overwrite a newer one — only the
	 * latest request is allowed to paint.
	 */
	let requested = 0;

	/**
	 * Load one page of the board. The board is the daily's, not the player's, so it is
	 * read even when signed out — a guest sees the same ranking, and holds a real ranked
	 * play of their own if they solved today cleanly. Which daily is today's is resolved
	 * by the server, never by this browser's clock.
	 */
	async function loadPage(next: number): Promise<void> {
		const ticket = ++requested;
		loaded = false;
		failed = false;
		try {
			const result = await fetchGlobalLeaderboard({ page: next });
			if (ticket !== requested) return;
			entries = result.entries;
			hasNext = result.hasNext;
			page = next;
		} catch {
			// A read failure (offline) shows the empty state rather than a broken page.
			if (ticket !== requested) return;
			entries = [];
			hasNext = false;
			failed = true;
		} finally {
			if (ticket === requested) loaded = true;
		}
	}

	onMount(() => {
		void loadPage(0);

		// The player's own two times for today, derived from their history by the same
		// builder the history page uses — best and ranked stay defined in one place.
		void loadHistoryRecords({ signedIn: auth?.signedIn ?? false, storage: window.localStorage })
			.then((records) => {
				const entry = buildHistory(records).find((e) => e.puzzleDate === today) ?? null;
				standing = ownStanding(entry);
			})
			.catch(() => {
				standing = null;
			});
	});

	function mistakesLabel(mistakes: number | null): string {
		if (mistakes === null) return '—';
		return `${mistakes} ${mistakes === 1 ? 'mistake' : 'mistakes'}`;
	}
</script>

<svelte:head>
	<title>Queens · Leaderboard</title>
	<meta name="description" content="The global board for today's daily, ranked by solve time." />
</svelte:head>

<h1>Leaderboard</h1>

<!-- Opening the board is a SOCIAL action, one of the two the one-time name confirm fires
     on (friends, #30, is the other and mounts this same component with the same context).
     Whether it actually appears is the component's question to ask, not this page's. -->
<NameConfirm {auth} context="social" />

<p class="intro">
	Today's daily, ranked by solve time — ties break by fewest mistakes, then earliest submission.
	Clean solves only: an assisted, stale or unverified play, and any attempt after your first, never
	reaches the board.
</p>

{#if standing}
	<section class="standing" aria-label="Your times today">
		{#if standing.differ}
			<p class="times">
				your best: <strong>{formatTime(standing.bestMs)}</strong> · ranked:
				<strong>{formatTime(standing.rankedMs ?? 0)}</strong>
			</p>
		{:else if standing.rankedMs !== null}
			<p class="times">your ranked time: <strong>{formatTime(standing.rankedMs)}</strong></p>
		{:else}
			<p class="times">your time today: <strong>{formatTime(standing.bestMs)}</strong></p>
		{/if}
		{#if standing.reason}
			<p class="reason">{standing.reason}</p>
		{/if}
	</section>
{/if}

{#if !loaded}
	<p class="placeholder">Loading the board…</p>
{:else if failed}
	<p class="placeholder">The board isn't available right now. Check your connection and refresh.</p>
{:else if entries.length === 0 && page === 0}
	<p class="placeholder">
		Nobody has posted a clean solve yet today. <a href={resolve('/')}>Play the daily</a> and take the
		top.
	</p>
{:else}
	<ol class="board">
		{#each entries as entry (entry.rank)}
			<li class="entry" class:you={entry.isYou}>
				<span class="rank">{entry.rank}</span>
				<span class="name"
					>{entry.displayName}{#if entry.isYou}<span class="tag">you</span>{/if}</span
				>
				<span class="detail">{mistakesLabel(entry.mistakes)}</span>
				<span class="time">{formatTime(entry.elapsedMs)}</span>
			</li>
		{/each}
	</ol>

	<nav class="paging" aria-label="Board pages">
		<button type="button" disabled={page === 0} onclick={() => loadPage(page - 1)}>Previous</button>
		<span class="page">Page {page + 1}</span>
		<button type="button" disabled={!hasNext} onclick={() => loadPage(page + 1)}>Next</button>
	</nav>
{/if}

<style>
	.intro {
		color: #666;
		font-size: 0.9rem;
	}

	.standing {
		margin: 1rem 0 1.5rem;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background: #f4f2ec;
	}

	.times {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}

	.reason {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: #666;
	}

	.board {
		list-style: none;
		padding: 0;
		margin: 0;
		counter-reset: none;
	}

	.entry {
		display: grid;
		grid-template-columns: 2.5rem 1fr auto auto;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.6rem 0.25rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.1);
	}

	.entry.you {
		background: #eef6f2;
		border-radius: 0.35rem;
	}

	.rank {
		font-variant-numeric: tabular-nums;
		color: #666;
		text-align: right;
	}

	.name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.tag {
		margin-left: 0.4rem;
		padding: 0.05rem 0.4rem;
		border-radius: 0.4rem;
		background: #0f6e56;
		color: #fff;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.detail {
		color: #666;
		font-size: 0.85rem;
	}

	.time {
		font-variant-numeric: tabular-nums;
		color: #0f6e56;
		font-weight: 600;
	}

	.paging {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-top: 1rem;
	}

	.paging button {
		font: inherit;
		padding: 0.35rem 0.9rem;
		border-radius: 0.4rem;
		border: 1px solid rgba(0, 0, 0, 0.2);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.paging button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.page {
		font-size: 0.85rem;
		color: #666;
	}

	@media (prefers-color-scheme: dark) {
		.intro,
		.reason,
		.detail,
		.rank,
		.page {
			color: #aaa;
		}
		.standing {
			background: #23231f;
		}
		.entry {
			border-bottom-color: rgba(255, 255, 255, 0.12);
		}
		.entry.you {
			background: #1c2a25;
		}
		.paging button {
			border-color: rgba(255, 255, 255, 0.25);
		}
	}
</style>
