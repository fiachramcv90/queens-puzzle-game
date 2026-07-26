<!--
  The friends board (#31): did I beat the people I actually know?

  The one thing that makes this different from the global board is that ASSISTED
  PLAYS ARE SHOWN, with their hint count and an explicit badge. On the global board
  they are absent entirely. Among friends, hiding an assisted solve would leave a
  suspiciously fast time unexplained; showing it labelled makes it legible as exactly
  what it is. Same rows, two projections — which is why both boards are
  security-definer functions rather than RLS policies.

  Streaks come from the time-aware read helper server-side, so a lapsed friend reads 0
  rather than the number they were on when they stopped playing.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { formatTime } from '$lib/game/format';
	import { fetchFriendsLeaderboard, type FriendsEntry } from '$lib/leaderboard/friends-leaderboard';

	let entries = $state<FriendsEntry[]>([]);
	let loaded = $state(false);
	let failed = $state(false);

	onMount(async () => {
		try {
			entries = await fetchFriendsLeaderboard();
		} catch {
			failed = true;
		} finally {
			loaded = true;
		}
	});

	function mistakesLabel(mistakes: number | null): string {
		if (mistakes === null) return '—';
		return `${mistakes} ${mistakes === 1 ? 'mistake' : 'mistakes'}`;
	}
</script>

{#if !loaded}
	<p class="placeholder">Loading today’s board…</p>
{:else if failed}
	<p class="placeholder">The board isn’t available right now. Check your connection and refresh.</p>
{:else if entries.length === 0}
	<p class="placeholder">
		Nobody in your circle has solved today’s daily yet — including you. Be the first.
	</p>
{:else}
	<ol class="board">
		{#each entries as entry (entry.userId)}
			<li class="entry" class:you={entry.isYou}>
				<span class="rank">{entry.rank}</span>
				<span class="who">
					<span class="name"
						>{entry.displayName}{#if entry.isYou}<span class="tag">you</span>{/if}</span
					>
					<span class="detail">
						{mistakesLabel(entry.mistakes)}
						{#if entry.assisted}
							<span class="badge" title="Used {entry.hintsUsed} hints">
								assisted · {entry.hintsUsed}
								{entry.hintsUsed === 1 ? 'hint' : 'hints'}
							</span>
						{/if}
						{#if entry.currentStreak > 0}
							<span class="streak">🔥 {entry.currentStreak}</span>
						{/if}
					</span>
				</span>
				<span class="time">{formatTime(entry.elapsedMs)}</span>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.board {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.entry {
		display: grid;
		grid-template-columns: 2rem 1fr auto;
		gap: var(--space-3);
		align-items: baseline;
		padding: var(--space-3) var(--space-1);
		border-bottom: 1px solid var(--border);
	}

	.entry.you {
		background: var(--accent-surface);
		border-radius: var(--radius-sm);
	}

	.rank {
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		text-align: right;
	}

	.name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.tag {
		margin-left: 0.4rem;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 0.7rem;
		font-weight: 600;
	}

	.detail {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: baseline;
		margin-top: 0.1rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.badge {
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-sm);
		background: var(--warm-surface);
		color: var(--warm-ink);
		font-size: 0.75rem;
	}

	.streak {
		color: var(--streak);
		font-size: 0.8rem;
	}

	.time {
		font-variant-numeric: tabular-nums;
		color: var(--accent);
		font-weight: 600;
	}
</style>
