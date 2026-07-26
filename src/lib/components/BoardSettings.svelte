<!--
  The board's accessibility settings.

  Two controls, and deliberately only two. The cage borders that carry every region
  boundary as a line drawing are NOT here and must never be: they are the structural
  guarantee the accessible board rests on, so they are always on for everyone and
  there is no setting — anywhere — that turns them off. What the player can change is
  the additive colour layer on top of them, and the last-resort letters.

  Region letters are nested inside the colourblind-friendly palette because that is
  what they are for: the answer for a viewer for whom even a CVD palette collapses.
  The rule itself lives in `resolveBoardPrefs`; this component only reflects it.
-->
<script lang="ts">
	import type { GuestPrefs } from '$lib/game/types';
	import { CVD_PALETTE_ID, DEFAULT_PALETTE_ID, resolveBoardPrefs } from '$lib/game/palette';

	interface Props {
		prefs: GuestPrefs;
		/** Called with only the fields that changed, so a partial write stays partial. */
		onChange: (patch: GuestPrefs) => void;
	}

	let { prefs, onChange }: Props = $props();

	const resolved = $derived(resolveBoardPrefs(prefs));
	const cvdOn = $derived(resolved.palette.id === CVD_PALETTE_ID);
</script>

<details class="settings">
	<summary>Board appearance</summary>

	<label class="row">
		<input
			type="checkbox"
			checked={cvdOn}
			onchange={(event) =>
				onChange({
					palette: event.currentTarget.checked ? CVD_PALETTE_ID : DEFAULT_PALETTE_ID
				})}
		/>
		<span>Colourblind-friendly colours</span>
	</label>

	<label class="row nested" class:muted={!cvdOn}>
		<input
			type="checkbox"
			checked={resolved.regionLabels}
			disabled={!cvdOn}
			onchange={(event) => onChange({ regionLabels: event.currentTarget.checked })}
		/>
		<span>Show a letter on every region</span>
	</label>

	<p class="note">
		Every region is always outlined in heavy black, in both colour schemes — the board stays
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

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
		cursor: pointer;
	}

	.row.nested {
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
