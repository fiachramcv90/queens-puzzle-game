<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { page } from '$app/state';
	import { AUTH_CONTEXT, type AuthContext } from '$lib/auth/context';
	import NameConfirm from '$lib/components/NameConfirm.svelte';
	import FriendsBoard from '$lib/components/FriendsBoard.svelte';
	import {
		groupFriends,
		inviteLink,
		looksLikeCode,
		normaliseCode,
		REQUEST_MESSAGES,
		type FriendRow
	} from '$lib/friends/friends';
	import {
		blockUser,
		ensureFriendCode,
		fetchFriends,
		regenerateFriendCode,
		requestFriendship,
		respondToRequest,
		unfriend
	} from '$lib/friends/friends-client';

	const auth = getContext<AuthContext>(AUTH_CONTEXT);

	let code = $state<string | null>(null);
	let rows = $state<FriendRow[]>([]);
	let loaded = $state(false);
	let busy = $state(false);
	let message = $state<string | null>(null);
	let failed = $state(false);
	let entry = $state('');
	let copied = $state(false);

	const sections = $derived(groupFriends(rows));
	const link = $derived(code ? inviteLink(page.url.origin, code) : '');

	/**
	 * An invite link arrives as `?code=…`. It is PRE-FILLED rather than acted on:
	 * opening a link must not silently send a request in the player's name, and the
	 * flow the spec locks is share → pending request → the recipient decides.
	 */
	const linkCode = $derived(page.url.searchParams.get('code'));

	async function refresh(): Promise<void> {
		rows = await fetchFriends();
	}

	async function load(): Promise<void> {
		// The code is minted lazily, on the first visit here — most players never open
		// friends, and an unused code is one more string to collide on.
		code = await ensureFriendCode();
		await refresh();
	}

	onMount(async () => {
		if (!auth?.signedIn) {
			loaded = true;
			return;
		}
		try {
			await load();
			if (linkCode) entry = normaliseCode(linkCode);
		} catch {
			failed = true;
			message = 'Could not load your friends. Check your connection and refresh.';
		} finally {
			loaded = true;
		}
	});

	// Auth resolves after mount, so a player who was already signed in (or who signs
	// in while looking at this page) gets it filled in rather than being left on the
	// signed-out panel until they reload.
	$effect(() => {
		if (!auth?.signedIn || !loaded || code !== null || busy) return;
		void load().catch(() => {
			/* the signed-out/empty state is a better failure than a broken page */
		});
	});

	async function run(action: () => Promise<void>): Promise<void> {
		busy = true;
		failed = false;
		try {
			await action();
		} catch {
			failed = true;
			message = 'That didn’t work. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	function send(): Promise<void> {
		return run(async () => {
			const outcome = await requestFriendship(entry);
			message = REQUEST_MESSAGES[outcome] ?? 'Request sent.';
			failed = outcome === 'unknown-code' || outcome === 'self' || outcome === 'limit-reached';
			if (outcome === 'requested' || outcome === 'accepted') entry = '';
			await refresh();
		});
	}

	function respond(row: FriendRow, accept: boolean): Promise<void> {
		return run(async () => {
			await respondToRequest(row.userId, accept);
			message = accept ? `You’re now friends with ${row.displayName}.` : 'Request declined.';
			await refresh();
		});
	}

	function remove(row: FriendRow): Promise<void> {
		return run(async () => {
			await unfriend(row.userId);
			message = `Removed ${row.displayName}.`;
			await refresh();
		});
	}

	function block(row: FriendRow): Promise<void> {
		return run(async () => {
			await blockUser(row.userId);
			message = `Blocked ${row.displayName}. They can’t send you requests or see you.`;
			await refresh();
		});
	}

	function regenerate(): Promise<void> {
		return run(async () => {
			code = await regenerateFriendCode();
			copied = false;
			message = 'New code. Any invite link you shared before has stopped working.';
		});
	}

	async function copyLink(): Promise<void> {
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
		} catch {
			copied = false;
			message = `Copy failed — your invite link is ${link}`;
		}
	}
</script>

<svelte:head>
	<title>Queens · Friends</title>
	<meta name="description" content="Add friends by code and race them at today's daily." />
</svelte:head>

<h1>Friends</h1>

<!-- Opening friends is a SOCIAL action — one of the two the one-time name confirm
     fires on. Whether it appears is shouldPromptNameConfirm's question, not this page's. -->
<NameConfirm {auth} context="social" />

{#if !loaded}
	<p class="placeholder">Loading…</p>
{:else if !auth?.signedIn}
	<p class="intro">
		Friends need an account on both sides — there’s no public directory, so the only way to add
		someone is a code they give you.
	</p>
	<p class="placeholder">Sign in to get your friend code and see your friends’ times.</p>
{:else}
	<p class="intro">
		No public directory, no name search. Share your code or your invite link, and whoever you send
		it to has to accept before either of you appears on the other’s board.
	</p>

	<section class="card" aria-label="Your friend code">
		<h2>Your code</h2>
		<p class="code">{code ?? '…'}</p>
		<div class="row">
			<button class="btn btn-sm" type="button" onclick={copyLink} disabled={!code}>
				{copied ? 'Link copied' : 'Copy invite link'}
			</button>
			<button class="btn btn-sm" type="button" onclick={regenerate} disabled={busy}>
				Regenerate
			</button>
		</div>
		<p class="note">
			Regenerating retires the old code and stops every invite link you’ve already shared.
		</p>
	</section>

	<section class="card" aria-label="Add a friend">
		<h2>Add a friend</h2>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<label for="friend-code">Their friend code</label>
			<div class="row">
				<input
					id="friend-code"
					class="field"
					bind:value={entry}
					placeholder="QNS-4F2K"
					autocomplete="off"
					spellcheck="false"
				/>
				<button class="btn btn-primary" type="submit" disabled={busy || !looksLikeCode(entry)}>
					Send request
				</button>
			</div>
		</form>
	</section>

	{#if message}
		<p class="message" class:failed aria-live="polite">{message}</p>
	{/if}

	{#if sections.incoming.length > 0}
		<!-- Incoming first: it is the only group waiting on the player to act. -->
		<section aria-label="Requests waiting for you">
			<h2>Waiting for you</h2>
			<ul class="people">
				{#each sections.incoming as row (row.userId)}
					<li class="person">
						<span class="name">{row.displayName}</span>
						<span class="actions">
							<button
								class="btn btn-sm btn-primary"
								type="button"
								onclick={() => respond(row, true)}
								disabled={busy}
							>
								Accept
							</button>
							<button
								class="btn btn-sm"
								type="button"
								onclick={() => respond(row, false)}
								disabled={busy}
							>
								Decline
							</button>
							<button
								class="btn btn-sm btn-danger"
								type="button"
								onclick={() => block(row)}
								disabled={busy}
							>
								Block
							</button>
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section aria-label="Your friends">
		<h2>Your friends</h2>
		{#if sections.friends.length === 0}
			<p class="placeholder">No friends yet. Share your code above to add someone.</p>
		{:else}
			<ul class="people">
				{#each sections.friends as row (row.userId)}
					<li class="person">
						<span class="name">
							{row.displayName}
							{#if row.currentStreak > 0}<span class="streak">🔥 {row.currentStreak}</span>{/if}
						</span>
						<span class="actions">
							<button class="btn btn-sm" type="button" onclick={() => remove(row)} disabled={busy}>
								Unfriend
							</button>
							<button
								class="btn btn-sm btn-danger"
								type="button"
								onclick={() => block(row)}
								disabled={busy}
							>
								Block
							</button>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if sections.outgoing.length > 0}
		<section aria-label="Requests you have sent">
			<h2>Sent</h2>
			<ul class="people">
				{#each sections.outgoing as row (row.userId)}
					<li class="person">
						<span class="name">{row.displayName}</span>
						<span class="waiting">waiting for them</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section aria-label="Today's friends board">
		<h2>Today’s board</h2>
		<FriendsBoard />
	</section>
{/if}

<style>
	.intro {
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.card {
		margin: var(--space-4) 0;
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-base);
	}

	.code {
		margin: 0 0 var(--space-3);
		font-size: var(--text-xl);
		font-weight: 700;
		letter-spacing: 0.08em;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.row input {
		flex: 1 1 9rem;
		text-transform: uppercase;
	}

	label {
		display: block;
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		margin-bottom: var(--space-1);
	}

	.note {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.people {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.person {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--border);
	}

	.name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.streak {
		margin-left: var(--space-2);
		font-weight: 500;
		font-size: var(--text-sm);
		color: var(--streak);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.waiting {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.message {
		margin: var(--space-3) 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.message.failed {
		color: var(--danger);
	}
</style>
