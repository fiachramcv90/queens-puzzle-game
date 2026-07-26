<!--
  The board's accessibility settings.

  Two controls, and deliberately only two. The cage borders that carry every region
  boundary as a line drawing are NOT here and must never be: they are the structural
  guarantee the accessible board rests on, so they are always on for everyone and
  there is no setting — anywhere — that turns them off. What the player can change is
  the additive colour layer on top of them, and the last-resort letters.

  The palette choice is rendered from `PALETTE_LIST` rather than hard-wired to the two
  ids that exist today, so a third token set appears here with no edit to this file.
  With two entries it reads as the accessibility toggle the board needs.

  Region letters are nested inside the colourblind-friendly palette because that is
  what they are for: the answer for a viewer for whom even a CVD palette collapses.
  The rule itself lives in `resolveBoardPrefs`; this component only reflects it.
-->
<script lang="ts">
	import type { GuestPrefs } from '$lib/game/types';
	import { PALETTE_LIST, isAccessibilityPalette, resolveBoardPrefs } from '$lib/game/palette';

	interface Props {
		prefs: GuestPrefs;
		/** Called with only the fields that changed, so a partial write stays partial. */
		onChange: (patch: GuestPrefs) => void;
	}

	let { prefs, onChange }: Props = $props();

	const resolved = $derived(resolveBoardPrefs(prefs));
	const accessible = $derived(isAccessibilityPalette(resolved.palette));
</script>

<details class="settings">
	<summary>Board appearance</summary>

	<fieldset>
		<legend>Region colours</legend>
		{#each PALETTE_LIST as palette (palette.id)}
			<label class="row">
				<input
					type="radio"
					name="palette"
					value={palette.id}
					checked={resolved.palette.id === palette.id}
					onchange={() => onChange({ palette: palette.id })}
				/>
				<span>{palette.label}</span>
			</label>
		{/each}
	</fieldset>

	<!-- Kept mounted but disabled outside accessibility mode, so the assist is visible
	     as something that exists rather than appearing out of nowhere on toggle. The
	     stored flag is left alone when the palette changes: a player who had letters on
	     gets them back on returning to this palette, rather than opting in twice. -->
	<label class="row nested" class:muted={!accessible}>
		<input
			type="checkbox"
			checked={resolved.regionLabels}
			disabled={!accessible}
			onchange={(event) => onChange({ regionLabels: event.currentTarget.checked })}
		/>
		<span>Show a letter on every region</span>
	</label>

	<p class="note">
		Every region is always outlined in heavy black, in every colour scheme — the board stays
		readable with all colour removed.
	</p>
</details>

<style>
	.settings {
		margin: 0 0 1rem;
		font-size: 0.9rem;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
	}

	fieldset {
		margin: 0.5rem 0 0;
		padding: 0;
		border: 0;
	}

	legend {
		padding: 0;
		font-weight: 600;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.7;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.35rem;
		cursor: pointer;
	}

	.row.nested {
		margin-top: 0.75rem;
		margin-left: 1.5rem;
	}

	.row.muted {
		opacity: 0.55;
		cursor: default;
	}

	.note {
		margin: 0.6rem 0 0;
		color: #666;
		font-size: 0.8rem;
	}

	@media (prefers-color-scheme: dark) {
		.note {
			color: #aaa;
		}
	}
</style>
