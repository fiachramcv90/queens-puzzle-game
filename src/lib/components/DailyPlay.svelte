<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { Cell } from '$lib/solver';
	import type { Daily, GuestPrefs } from '$lib/game/types';
	import { GameState } from '$lib/game/game-state.svelte';
	import { getOrCreateGuestId, loadBlob, saveBlob, writePrefs } from '$lib/game/persistence';
	import { resolveBoardPrefs } from '$lib/game/palette';
	import { syncPrefsToProfile } from '$lib/auth/profile';
	import { currentSession } from '$lib/auth/session';
	import { armGuestMerge } from '$lib/auth/merge';
	import { sendHeartbeat, startPlay, submitPlay } from '$lib/game/play-client';
	import { appendRecord, recordFromResult } from '$lib/history/records';
	import { formatTime } from '$lib/game/format';
	import { heartbeat } from '$lib/config';
	import Board from '$lib/components/Board.svelte';
	import BoardActions from '$lib/components/BoardActions.svelte';
	import BoardSettings from '$lib/components/BoardSettings.svelte';
	import HintPanel from '$lib/components/HintPanel.svelte';
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

	// How this player wants the board rendered. Read from the local blob on mount and
	// resolved through `resolveBoardPrefs`, which owns the fallbacks — so an unknown
	// stored palette (one retired since the pref was written) still renders a board.
	//
	// The blob is the ONE place this component reads prefs from, in both directions of
	// the sync. Pulling the profile down onto the device is already AuthState's job (it
	// writes the profile's prefs into the blob on every authenticated load), so mirroring
	// that here would be a second writer racing the first — and the loser would be
	// whichever held the player's actual choice.
	let prefs = $state<GuestPrefs>({});
	const boardPrefs = $derived(resolveBoardPrefs(prefs));

	let storage: Storage | null = null;
	let guestId = '';

	/**
	 * Apply a pref change: to the screen now, to local storage always, and up to the
	 * profile when signed in. Only the changed fields are sent, so a partial write never
	 * overwrites a pref this device never set.
	 *
	 * Pushing up is what keeps the choice: AuthState pulls the profile down onto the
	 * device on the next load, so a change that stopped at localStorage would be
	 * overwritten by the profile's older value. A failed push is swallowed — it costs
	 * this device's setting on a later load, and must never interrupt a solve.
	 */
	function changePrefs(patch: GuestPrefs): void {
		prefs = { ...prefs, ...patch };
		if (storage) writePrefs(storage, patch);
		if (auth?.signedIn) void syncPrefsToProfile(patch).catch(() => {});
	}

	/**
	 * Anchor the play on the server, under the right identity.
	 *
	 * The session is read here, and AWAITED before `start` is called, rather than taken
	 * from the shared AuthState — because AuthState resolves its session asynchronously
	 * from the layout's own onMount, and this component's onMount can win that race. A
	 * `start` that fires first would create a GUEST play for a signed-in player, and
	 * nothing re-keys a play afterwards: it would stay off their streak and show on the
	 * leaderboard as "Guest" for good. `currentSession()` reads the persisted session
	 * directly, so the answer is the same whichever component mounted first.
	 *
	 * A failure leaves the board fully playable — it just is not anchored, which is the
	 * same state an offline start has always produced.
	 */
	async function anchorPlay(): Promise<void> {
		const session = await currentSession().catch(() => null);

		// No session means this really is a guest play, so re-arm the silent merge: it
		// has to fold this onto the account at the next sign-in even if this device
		// merged once already.
		if (!session && storage) armGuestMerge(storage);

		try {
			const started = await startPlay(daily.date, guestId, session?.access_token ?? null);
			if (!game) return;
			game.token = started.token;
			game.startedAt = Date.parse(started.startedAt);
		} catch {
			// Offline, rate-limited or an unavailable daily: play on, unanchored.
		}
	}

	onMount(() => {
		storage = window.localStorage;
		guestId = getOrCreateGuestId(storage);
		const blob = loadBlob(storage);

		// Only today's in-progress board is cached in the single-slot blob, so restore a
		// play only when it belongs to THIS daily. An archive daily starts fresh each
		// visit (its completed result is recorded to history, not the in-progress slot).
		const restored = blob?.play?.puzzleId === daily.id ? blob.play : undefined;
		game = new GameState(daily, restored);

		prefs = blob?.prefs ?? {};
		solvedDates = blob?.solvedDates ?? [];

		// The auto-mark-X PREFERENCE carries across days, but it must not switch itself
		// on for a fresh play: that would silently charge `assisted` for a choice the
		// player made yesterday. A restored play keeps whatever it was running with; a
		// new play starts clean and the player opts in again through the hint panel.
		if (restored?.autoMarkX) game.setAutoMarkX(true);
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
		if (!game.result) void anchorPlay();

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

	<BoardSettings {prefs} onChange={changePrefs} />

	<!-- Hints are offered only while the play is live. Keyed on `solved` rather than on
	     the server's `result`, because between those two there is a round trip during
	     which the board is finished but the reply has not landed — and a "reveal"
	     control beside a completed board reads as an invitation to redo it. -->
	{#if !game.solved}
		<HintPanel {game} onAutoMarkXChange={(on) => changePrefs({ autoMarkX: on })} />
	{/if}

	<div
		class="board-wrap"
		style={`--cell-size: min(2.75rem, calc((100vw - 2.5rem) / ${game.size}))`}
	>
		<Board
			regionMap={game.regionMap}
			board={game.board}
			conflicts={game.conflicts}
			flagged={game.flagged}
			palette={boardPrefs.palette}
			regionLabels={boardPrefs.regionLabels}
			locked={game.solved}
			onTap={(row, col) => game?.tap(row, col)}
			onToggleX={(row, col) => game?.toggleX(row, col)}
			onSweep={(cells: readonly Cell[]) => game?.sweep(cells)}
		/>
	</div>

	<!-- Below the board, not up with the hints: this acts on what the player has just
	     been doing, and it must not read as one of the controls that costs the ranking.
	     Hidden once solved for the same reason the hints are — the board is locked, and
	     a control that alters a finished board can only damage it. -->
	{#if !game.solved}
		<BoardActions {game} />
	{/if}

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
			{#if game.result.assisted}
				<p class="badge">
					Assisted — {game.result.hintsUsed}
					{game.result.hintsUsed === 1 ? 'hint' : 'hints'} used, not ranked
				</p>
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
		Tap to cycle X → queen. Drag across empty cells to sweep X's. Right-click for a quick X. Or use
		the keyboard: arrow keys to move, <kbd>Space</kbd> to cycle, <kbd>X</kbd> to mark.
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
		color: var(--text-muted);
	}
	.timer.solved {
		color: var(--accent);
		font-weight: 600;
	}

	.archive-note {
		margin: 0 0 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius);
		background: var(--warm-surface);
		color: var(--warm-ink);
		font-size: var(--text-sm);
	}

	.board-wrap {
		margin: 0.25rem 0 1rem;
	}

	.status {
		font-weight: 500;
		margin: 0.5rem 0 0.25rem;
	}
	.status.won {
		color: var(--accent);
	}

	/* The post-solve panel. It is the payoff for the whole session, so it reads as a
	   result card rather than three stacked paragraphs. */
	.result {
		margin: var(--space-3) 0 var(--space-2);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius);
		background: var(--accent-surface);
	}
	.result-headline {
		font-weight: 700;
		font-size: var(--text-lg);
		color: var(--accent);
		margin: 0 0 0.15rem;
	}
	.result-detail {
		margin: 0;
		color: var(--text-muted);
	}
	.badge {
		display: inline-block;
		margin: 0.4rem 0.4rem 0 0;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius);
		background: var(--warm-surface);
		color: var(--warm-ink);
		font-size: var(--text-xs);
	}

	.hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
		margin: 0.25rem 0 0;
	}

	.hint kbd {
		font: inherit;
		font-size: 0.95em;
		padding: 0.05rem 0.3rem;
		border: 1px solid var(--border);
		border-radius: 0.25rem;
		background: var(--surface);
	}
</style>
