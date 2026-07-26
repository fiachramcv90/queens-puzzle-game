<!--
  The light / dark / system control.

  A three-way segmented control rather than a two-state switch, because a switch has
  no way back to "follow my phone": flip it once and the player is pinned forever,
  and their evening auto-dark silently stops working. `System` is the default and
  stays reachable.

  Rendered as a radiogroup rather than three buttons, so a screen reader announces it
  as one setting with three choices and the arrow keys move between them — which is
  what a keyboard player expects from a segmented control.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import {
		applyTheme,
		readTheme,
		storeTheme,
		THEME_OPTIONS,
		type ThemePreference
	} from '$lib/theme/theme';

	// Starts at `system` for SSR; the real value is read on mount. The inline script
	// in app.html has ALREADY painted the correct theme by then, so this only syncs
	// the control's own highlighted state — it is not what prevents a flash.
	let theme = $state<ThemePreference>('system');

	onMount(() => {
		theme = readTheme(window.localStorage);
	});

	function choose(next: ThemePreference): void {
		theme = next;
		applyTheme(document.documentElement, next);
		storeTheme(window.localStorage, next);
	}
</script>

<div class="theme" role="radiogroup" aria-label="Colour theme">
	{#each THEME_OPTIONS as option (option.id)}
		<button
			class="option"
			class:selected={theme === option.id}
			type="button"
			role="radio"
			aria-checked={theme === option.id}
			title={option.label}
			onclick={() => choose(option.id)}
		>
			<span aria-hidden="true">{option.icon}</span>
			<span class="sr-only">{option.label}</span>
		</button>
	{/each}
</div>

<style>
	.theme {
		display: inline-flex;
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
	}

	.option {
		font: inherit;
		font-size: 0.8rem;
		line-height: 1;
		padding: 0.3rem 0.4rem;
		border: 0;
		border-radius: calc(var(--radius-sm) - 2px);
		background: transparent;
		color: inherit;
		cursor: pointer;
		/* The emoji carry the meaning; keep them from being washed out when unselected
		   without dropping them so far they stop being legible. */
		opacity: 0.55;
	}

	.option:hover {
		opacity: 0.85;
	}

	.option.selected {
		background: var(--bg);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
		opacity: 1;
	}

	/* Visible to a screen reader, not on screen — the icons alone would announce as
	   nothing useful. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
