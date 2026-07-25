<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { Cell } from '$lib/solver';
	import type { Daily } from '$lib/game/types';
	import { GameState } from '$lib/game/game-state.svelte';
	import { getOrCreateGuestId, loadBlob, saveBlob } from '$lib/game/persistence';
	import { sendHeartbeat, startPlay, submitPlay } from '$lib/game/play-client';
	import { appendRecord, recordFromResult } from '$lib/history/records';
	import { formatTime } from '$lib/game/format';
	import { heartbeat } from '$lib/config';
	import Board from '$lib/components/Board.svelte';
	import StreakBadge from '$lib/components/StreakBadge.svelte';
	import { AUTH_CONTEXT, type AuthContext } from '$lib/auth/context';
	import { computeStreak, dublinToday, viewStreak } from '$lib/streak/streak';

	// The daily to play — resolved by the route (today's, or a past archive daily). Every
	// rule below keys off the daily's own DATE rather than which route rendered it, the
	// same date-derived model the server uses: an archive daily is simply one whose date
	// is not today. Today's daily persists its in-progress board for an offline refresh
	// and, when solved, extends the streak; an archive daily is recorded to history but
	// stays streak-neutral and unranked.
	let { daily }: { daily: Daily } = $props();

	const auth = getContext<AuthContext>(AUTH_CONTEXT);

	// An archive play is one played outside the daily's own window — the same predicate
	// the server applies to keep it streak-neutral and off the frozen board.
	const isArchive = $derived(daily.date !== dublinToday());

	/** The Dublin dates this guest has solved in-window, for the guest streak. */
	let solvedDates = $state<string[]>([]);

	const streak = $derived(
		viewStreak(auth?.signedIn && auth.profile ? auth.profile : computeStreak(solvedDates))
	);

	let game = $state<GameState | null>(null);
	let submitting = $state(false);
	let submitFailed = $state(false);

	let storage: Storage | null = null;
	let guestId = '';

	onMount(() => {
		storage = window.localStorage;
		guestId = getOrCreateGuestId(storage);
		const blob = loadBlob(storage);

		// Only today's in-progress board is cached in the single-slot blob, so restore a
		// play only when it belongs to THIS daily. An archive daily starts fresh each
		// visit (its completed result is recorded to history, not the in-progress slot).
		const restored = blob?.play?.puzzleId === daily.id ? blob.play : undefined;
		game = new GameState(daily, restored);

		solvedDates = blob?.solvedDates ?? [];
		// A restored, already-solved TODAY play still belongs to its day's streak.
		if (
			game.result &&
			!isArchive &&
			daily.date === dublinToday() &&
			!solvedDates.includes(daily.date)
		) {
			solvedDates = [...solvedDates, daily.date];
		}

		// Anchor the play on the server unless it is already completed. `start` is
		// idempotent per identity and date and accepts any visible (today or past) daily.
		if (!game.result) {
			startPlay(daily.date, guestId)
				.then((started) => {
					if (!game) return;
					game.token = started.token;
					game.startedAt = Date.parse(started.startedAt);
				})
				.catch(() => {});
		}

		const timer = setInterval(() => {
			if (game && game.solvedElapsedMs === undefined) game.nowMs = Date.now();
			else clearInterval(timer);
		}, 1000);

		const beat = setInterval(() => {
			if (
				game?.token &&
				game.solvedElapsedMs === undefined &&
				document.visibilityState === 'visible'
			) {
				sendHeartbeat(game.token).catch(() => {});
			}
		}, heartbeat.intervalMs);

		return () => {
			clearInterval(timer);
			clearInterval(beat);
		};
	});

	// Submit the instant the board is solved, once, provided the play was anchored on
	// the server. Records the result to the guest's local history for BOTH modes; only
	// an in-window solve touches the streak.
	$effect(() => {
		if (!game) return;
		if (!game.solved || game.result || !game.token || submitting) return;
		submitting = true;
		submitFailed = false;
		const g = game;
		const token = game.token;
		const puzzleId = daily.id;
		const puzzleDate = daily.date;
		submitPlay(token, puzzleId, g.board, g.moveLog())
			.then((result) => {
				g.result = result;

				const playedDate = dublinToday();
				if (storage) {
					const existing = loadBlob(storage);
					const record = recordFromResult(result, puzzleDate, playedDate);
					const nextDates =
						puzzleDate === playedDate &&
						!isArchive &&
						!(existing?.solvedDates ?? []).includes(puzzleDate)
							? [...(existing?.solvedDates ?? []), puzzleDate]
							: (existing?.solvedDates ?? solvedDates);
					saveBlob(storage, {
						...existing,
						guestId,
						prefs: existing?.prefs ?? {},
						solvedDates: nextDates,
						plays: appendRecord(existing?.plays, record)
					});
					solvedDates = nextDates;
				}

				if (auth?.signedIn) void auth.refreshProfile();
			})
			.catch(() => {
				submitFailed = true;
			})
			.finally(() => {
				submitting = false;
			});
	});

	// Persist the in-progress board so an offline refresh restores it — TODAY only. An
	// archive board is deliberately not cached, so playing an old daily never clobbers
	// today's in-progress solve in the single-slot blob.
	$effect(() => {
		if (!game || !storage || isArchive) return;
		void game.board;
		void game.solvedElapsedMs;
		void game.startedAt;
		void game.token;
		void game.result;
		void solvedDates;
		const existing = loadBlob(storage);
		saveBlob(storage, {
			...existing,
			guestId,
			prefs: existing?.prefs ?? {},
			daily,
			play: game.snapshot(),
			solvedDates
		});
	});
</script>

{#if game}
	<StreakBadge view={streak} />
	<div class="meta">
		<span class="tier">{game.size}×{game.size} · {game.tier}</span>
		<span class="timer" class:solved={game.solved} aria-live="off"
			>{formatTime(game.result ? game.result.elapsedMs : game.elapsedMs)}</span
		>
	</div>

	{#if isArchive}
		<!-- The rule made visible up front, so an archive solve reads as a rule rather
		     than a slight: this play won't touch the streak or that day's board. -->
		<p class="archive-note">
			Archive daily for {daily.date} — playable any time, but this solve won't affect your streak or that
			day's leaderboard.
		</p>
	{/if}

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

	{#if game.result}
		<div class="result" class:won={true}>
			<p class="result-headline">✓ Solved in {formatTime(game.result.elapsedMs)}</p>
			<p class="result-detail">
				{#if game.result.mistakes === null}
					Mistakes not verified
				{:else}
					{game.result.mistakes}
					{game.result.mistakes === 1 ? 'mistake' : 'mistakes'}
				{/if}
			</p>
			{#if isArchive}
				<p class="badge">Archive — doesn't affect your streak or ranking</p>
			{:else if game.result.replay}
				<p class="badge">Replay — practice, not ranked</p>
			{/if}
			{#if game.result.stale}
				<p class="badge">Idle too long — counts, but out of ranking</p>
			{/if}
			{#if game.result.unverified}
				<p class="badge">Solve accepted but not verified</p>
			{/if}
		</div>
	{:else if game.solved}
		<p class="status won">
			{#if submitting}
				✓ Solved — recording…
			{:else if submitFailed}
				✓ Solved — couldn't reach the server to record it. Reconnect and refresh.
			{:else}
				✓ Solved
			{/if}
		</p>
	{:else}
		<p class="status">{game.queenCount}/{game.size} queens placed</p>
	{/if}
	<p class="hint">
		Tap to cycle X → queen. Drag across empty cells to sweep X's. Right-click for a quick X.
	</p>
{/if}

<style>
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

	.archive-note {
		margin: 0 0 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: #f0ede6;
		color: #6b5f3f;
		font-size: 0.85rem;
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

	.result {
		margin: 0.5rem 0 0.25rem;
	}
	.result-headline {
		font-weight: 700;
		font-size: 1.15rem;
		color: #0f6e56;
		margin: 0 0 0.15rem;
	}
	.result-detail {
		margin: 0;
		color: #555;
	}
	.badge {
		display: inline-block;
		margin: 0.4rem 0.4rem 0 0;
		padding: 0.15rem 0.5rem;
		border-radius: 0.5rem;
		background: #f0ede6;
		color: #6b5f3f;
		font-size: 0.8rem;
	}

	.hint {
		color: #888;
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}

	@media (prefers-color-scheme: dark) {
		.timer {
			color: #aaa;
		}
		.hint {
			color: #999;
		}
		.result-detail {
			color: #aaa;
		}
		.badge,
		.archive-note {
			background: #2a2822;
			color: #cdbb8a;
		}
	}
</style>
