<!--
  The streak display — the reason to come back tomorrow.

  Shows the CURRENT streak (the time-aware read: held while still live, 0 once a day has
  elapsed) and the LONGEST alongside it, so a bad week never hides a good year. When the
  streak is held from a previous day and today is not yet solved it renders an AT-RISK
  state — a player must be reminded they still have all day to keep it, never told it is
  already lost. A player with no streak yet (current and longest both 0) sees nothing.
-->
<script lang="ts">
	import type { StreakView } from '$lib/streak/streak';

	let { view }: { view: StreakView } = $props();
</script>

{#if view.current > 0 || view.longest > 0}
	<div class="streak" class:at-risk={view.atRisk} aria-live="polite">
		<span
			class="current"
			title={view.atRisk ? 'Solve today to keep your streak' : 'Current streak'}
		>
			<span class="flame" aria-hidden="true">{view.atRisk ? '🕯️' : '🔥'}</span>
			<span class="count">{view.current}</span>
			<span class="label">day{view.current === 1 ? '' : 's'}</span>
		</span>
		{#if view.atRisk}
			<span class="risk">at risk — solve today</span>
		{/if}
		<span class="longest" title="Longest streak">Best {view.longest}</span>
	</div>
{/if}

<style>
	.streak {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem 0.75rem;
		margin: 0 0 0.75rem;
		font-size: 0.95rem;
	}
	.current {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		font-weight: 700;
		color: #b3541e;
	}
	.flame {
		font-size: 1.05rem;
	}
	.count {
		font-variant-numeric: tabular-nums;
		font-size: 1.15rem;
	}
	.label {
		font-weight: 500;
		color: #6b5f3f;
	}
	.longest {
		color: #777;
		font-size: 0.85rem;
	}
	/* At-risk: the held streak is still theirs, so it stays prominent — the amber cue
	   is a reminder to solve today, not a bereavement notice. */
	.streak.at-risk .current {
		color: #9a6b12;
	}
	.risk {
		color: #9a6b12;
		font-weight: 600;
		font-size: 0.8rem;
	}

	@media (prefers-color-scheme: dark) {
		.current {
			color: #e79a5e;
		}
		.label {
			color: #cdbb8a;
		}
		.longest {
			color: #999;
		}
		.streak.at-risk .current,
		.risk {
			color: #e0b458;
		}
	}
</style>
