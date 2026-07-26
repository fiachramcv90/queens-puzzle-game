/**
 * Region fill colours as a SWAPPABLE TOKEN SET, plus the rules for choosing between
 * sets and for the opt-in region labels.
 *
 * The finding this rests on (from the five-treatment prototype under CVD-simulation
 * filters, branch `prototype/accessibility-regions`): no palette alone keeps up to
 * 11 regions distinct for a monochromatic viewer. Hue can be the fast path; it can
 * never be the guarantee. So the board uses REDUNDANT CODING and everything here is
 * strictly the additive layer:
 *
 *   - The GUARANTEE is the always-on cage border, drawn by `Board.svelte` from the
 *     `--cage-*` tokens. It is pure luminance, survives every CVD filter and full
 *     greyscale, and NOTHING in this module — or in any preference — can turn it off.
 *   - The fill is the at-a-glance fast path. Swapping the palette swaps fills only;
 *     the line drawing underneath is identical in every palette.
 *   - Per-region letters are the last resort, opt-in inside the CVD palette, for the
 *     viewer for whom even a CVD palette collapses.
 *
 * Adding a third palette is an entry in `PALETTES` and nothing else: no component
 * knows a colour, and `resolvePalette` accepts any id in the registry.
 */

import type { GuestPrefs } from './types';

export interface RegionColor {
	/** Background fill for the region. */
	readonly fill: string;
	/** Legible foreground for the queen and mark (X) glyphs sitting on that fill. */
	readonly ink: string;
}

/** One named token set: everything a board needs to colour its regions. */
export interface Palette {
	readonly id: PaletteId;
	/** Human-readable, for the settings control. */
	readonly label: string;
	/**
	 * Fill/ink pairs addressed by region id. At least as many entries as the largest
	 * board has regions (11×11 ⇒ 11), so a real board never wraps.
	 */
	readonly colors: readonly RegionColor[];
}

/**
 * The default pastel set: gentle contrast between neighbours so the colour layer
 * groups at a glance without shouting over the line drawing beneath it.
 */
const CLASSIC_COLORS: readonly RegionColor[] = [
	{ fill: '#EEEDFE', ink: '#26215C' },
	{ fill: '#E1F5EE', ink: '#04342C' },
	{ fill: '#FAECE7', ink: '#4A1B0C' },
	{ fill: '#FBEAF0', ink: '#4B1528' },
	{ fill: '#E6F1FB', ink: '#042C53' },
	{ fill: '#EAF3DE', ink: '#173404' },
	{ fill: '#FAEEDA', ink: '#412402' },
	{ fill: '#F1EFE8', ink: '#2C2C2A' },
	{ fill: '#E4EEF0', ink: '#123338' },
	{ fill: '#F3E8F6', ink: '#3A1147' },
	{ fill: '#FDECEC', ink: '#5A1414' },
	{ fill: '#E8F0E4', ink: '#1E3313' }
];

/**
 * The CVD-aware set: Okabe–Ito hues, each tinted or shaded to a distinct target
 * luminance so the twelve entries are spread evenly across LIGHTNESS as well as hue.
 * That second channel is the point — under a CVD filter two hues can collapse onto
 * each other, but their lightness difference survives, and it survives full greyscale
 * too. Ink flips to white on the dark end so every glyph clears 4.5:1 on its own fill.
 */
const CVD_COLORS: readonly RegionColor[] = [
	{ fill: '#00466E', ink: '#FFFFFF' },
	{ fill: '#00664A', ink: '#FFFFFF' },
	{ fill: '#B45000', ink: '#FFFFFF' },
	{ fill: '#B26991', ink: '#12100C' },
	{ fill: '#4998C5', ink: '#12100C' },
	{ fill: '#D49300', ink: '#12100C' },
	{ fill: '#AFAFAF', ink: '#12100C' },
	{ fill: '#CABF37', ink: '#12100C' },
	{ fill: '#A9D0E5', ink: '#12100C' },
	{ fill: '#AFE1D3', ink: '#12100C' },
	{ fill: '#F2DDE8', ink: '#12100C' },
	{ fill: '#E1F2FB', ink: '#12100C' }
];

/**
 * The registry. This object is the only place a palette is declared; `PaletteId` is
 * derived from its keys, so adding a set here widens the type, the settings control
 * and the accepted values of the persisted pref in one edit.
 */
export const PALETTES = {
	classic: { id: 'classic', label: 'Classic', colors: CLASSIC_COLORS },
	cvd: { id: 'cvd', label: 'Colourblind-friendly', colors: CVD_COLORS }
} as const;

/** The id of every palette in the registry — and the values the `palette` pref may take. */
export type PaletteId = keyof typeof PALETTES;

/**
 * The palette a player gets before choosing one. Matches the `profiles.palette`
 * column default, so a fresh profile and a fresh guest render identically.
 */
export const DEFAULT_PALETTE_ID: PaletteId = 'classic';

/** The palette the accessibility toggle switches to. */
export const CVD_PALETTE_ID: PaletteId = 'cvd';

/** Every palette, in the order the settings control offers them. */
export const PALETTE_LIST: readonly Palette[] = Object.values(PALETTES);

/** Whether a stored string is still a palette this build knows about. */
export function isPaletteId(value: unknown): value is PaletteId {
	return typeof value === 'string' && Object.hasOwn(PALETTES, value);
}

/**
 * The palette for a stored id, falling back to the default. The fallback is what lets
 * a palette be retired: a player whose profile still names it sees the default board
 * rather than an unpainted one.
 */
export function resolvePalette(value: string | null | undefined): Palette {
	return isPaletteId(value) ? PALETTES[value] : PALETTES[DEFAULT_PALETTE_ID];
}

/** The colour for a region id, wrapping if a board ever outgrows the palette. */
export function regionColor(palette: Palette, regionId: number): RegionColor {
	return palette.colors[regionId % palette.colors.length];
}

/**
 * The letter identifying a region: A, B, C… in region-id order. Wraps past Z for the
 * same reason `regionColor` wraps — a board that outgrew the alphabet should render
 * something rather than nothing — which no MVP board (≤11 regions) comes near.
 */
export function regionLabel(regionId: number): string {
	return String.fromCharCode(65 + (regionId % 26));
}

/**
 * Whether a palette is the colourblind-friendly one — i.e. whether the player is in
 * accessibility mode. The one place that question is answered, so the settings control
 * and `resolveBoardPrefs` cannot disagree about what "inside accessibility mode" means.
 */
export function isAccessibilityPalette(palette: Palette): boolean {
	return palette.id === CVD_PALETTE_ID;
}

/** How the board should render itself, resolved from a player's stored preferences. */
export interface BoardPrefs {
	readonly palette: Palette;
	/** Whether to draw the per-region letter on every cell. */
	readonly regionLabels: boolean;
}

/**
 * Resolve stored preferences into what the board renders.
 *
 * Region labels are an assist WITHIN the CVD palette — the last resort once colour
 * has already been pushed as far as it goes — so the flag only takes effect there.
 * Keeping that rule here rather than in the component means the board never has to
 * ask what mode it is in, and the answer cannot drift between call sites.
 */
export function resolveBoardPrefs(prefs: GuestPrefs | null | undefined): BoardPrefs {
	const palette = resolvePalette(prefs?.palette);
	return {
		palette,
		regionLabels: isAccessibilityPalette(palette) && prefs?.regionLabels === true
	};
}
