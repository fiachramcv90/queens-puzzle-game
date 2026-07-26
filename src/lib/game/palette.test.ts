import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	CVD_PALETTE_ID,
	DEFAULT_PALETTE_ID,
	PALETTES,
	PALETTE_LIST,
	isAccessibilityPalette,
	isPaletteId,
	regionColor,
	regionLabel,
	resolveBoardPrefs,
	resolvePalette
} from './palette';

/**
 * The largest MVP board is 11×11, so a palette must carry at least 11 distinct
 * region colours before it is allowed to wrap.
 */
const MAX_REGIONS = 11;

// --- WCAG relative luminance and contrast, test-local ---------------------------
// Kept here rather than in the module: nothing in the app computes contrast at
// runtime, these are assertions about fixed token values.

function channels(hexColor: string): [number, number, number] {
	return [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance(hexColor: string): number {
	const [r, g, b] = channels(hexColor).map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe('the palette token set', () => {
	it('exposes every palette through one registry, keyed by its own id', () => {
		for (const palette of PALETTE_LIST) {
			expect(PALETTES[palette.id]).toBe(palette);
		}
		expect(PALETTE_LIST).toHaveLength(Object.keys(PALETTES).length);
	});

	it('offers both the default and the CVD palette', () => {
		expect(PALETTE_LIST.map((p) => p.id)).toEqual(
			expect.arrayContaining([DEFAULT_PALETTE_ID, CVD_PALETTE_ID])
		);
	});

	it('gives every palette a human label for the settings control', () => {
		for (const palette of PALETTE_LIST) {
			expect(palette.label.length).toBeGreaterThan(0);
		}
	});

	it('covers the largest board without reusing a fill', () => {
		for (const palette of PALETTE_LIST) {
			expect(palette.colors.length).toBeGreaterThanOrEqual(MAX_REGIONS);
			const fills = palette.colors.map((c) => c.fill.toUpperCase());
			expect(new Set(fills).size).toBe(fills.length);
		}
	});

	it('keeps every glyph legible on its own fill', () => {
		for (const palette of PALETTE_LIST) {
			for (const color of palette.colors) {
				expect(contrastRatio(color.fill, color.ink)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it('spreads the CVD palette across lightness, so hue is never the only channel', () => {
		const luminances = PALETTES[CVD_PALETTE_ID].colors
			.map((c) => relativeLuminance(c.fill))
			.sort((a, b) => a - b);
		const gaps = luminances.slice(1).map((l, i) => l - luminances[i]);
		expect(Math.min(...gaps)).toBeGreaterThan(0.03);
	});
});

describe('resolvePalette', () => {
	it('resolves a known id to its palette', () => {
		expect(resolvePalette(CVD_PALETTE_ID).id).toBe(CVD_PALETTE_ID);
	});

	it('falls back to the default for an absent or unrecognised id', () => {
		expect(resolvePalette(undefined).id).toBe(DEFAULT_PALETTE_ID);
		expect(resolvePalette('a-palette-that-was-removed').id).toBe(DEFAULT_PALETTE_ID);
	});

	it('recognises exactly the ids in the registry', () => {
		expect(isPaletteId(DEFAULT_PALETTE_ID)).toBe(true);
		expect(isPaletteId(CVD_PALETTE_ID)).toBe(true);
		expect(isPaletteId('nope')).toBe(false);
	});
});

describe('isAccessibilityPalette', () => {
	it('identifies the CVD palette as accessibility mode and the default as not', () => {
		expect(isAccessibilityPalette(PALETTES[CVD_PALETTE_ID])).toBe(true);
		expect(isAccessibilityPalette(PALETTES[DEFAULT_PALETTE_ID])).toBe(false);
	});
});

describe('regionColor', () => {
	it('reads the colour for a region from the given palette', () => {
		const cvd = PALETTES[CVD_PALETTE_ID];
		expect(regionColor(cvd, 3)).toEqual(cvd.colors[3]);
	});

	it('wraps rather than returning undefined if a board ever outgrows the palette', () => {
		const palette = PALETTES[DEFAULT_PALETTE_ID];
		expect(regionColor(palette, palette.colors.length)).toEqual(palette.colors[0]);
	});

	it('swapping the palette changes the fill for the same region', () => {
		const classic = regionColor(PALETTES[DEFAULT_PALETTE_ID], 0);
		const cvd = regionColor(PALETTES[CVD_PALETTE_ID], 0);
		expect(cvd.fill).not.toBe(classic.fill);
	});
});

describe('regionLabel', () => {
	it('labels regions A, B, C… in region-id order', () => {
		expect(regionLabel(0)).toBe('A');
		expect(regionLabel(1)).toBe('B');
		expect(regionLabel(10)).toBe('K');
	});

	it('gives every region on the largest board its own letter', () => {
		const labels = Array.from({ length: MAX_REGIONS }, (_, i) => regionLabel(i));
		expect(new Set(labels).size).toBe(MAX_REGIONS);
	});
});

describe('resolveBoardPrefs', () => {
	it('defaults a player with no prefs to the default palette and no labels', () => {
		const prefs = resolveBoardPrefs(undefined);
		expect(prefs.palette.id).toBe(DEFAULT_PALETTE_ID);
		expect(prefs.regionLabels).toBe(false);
	});

	it('switches the fills when the CVD palette is chosen', () => {
		expect(resolveBoardPrefs({ palette: CVD_PALETTE_ID }).palette.id).toBe(CVD_PALETTE_ID);
	});

	it('shows region labels when opted into inside the CVD palette', () => {
		expect(resolveBoardPrefs({ palette: CVD_PALETTE_ID, regionLabels: true }).regionLabels).toBe(
			true
		);
	});

	it('keeps region labels off outside the CVD palette — they are an assist within it', () => {
		expect(
			resolveBoardPrefs({ palette: DEFAULT_PALETTE_ID, regionLabels: true }).regionLabels
		).toBe(false);
	});

	it('ignores an unrecognised stored palette rather than rendering nothing', () => {
		const prefs = resolveBoardPrefs({ palette: 'gone', regionLabels: true });
		expect(prefs.palette.id).toBe(DEFAULT_PALETTE_ID);
		expect(prefs.regionLabels).toBe(false);
	});
});

describe('the board component holds no palette colour of its own', () => {
	it('has no hard-coded colour literal in Board.svelte', () => {
		const source = readFileSync(
			fileURLToPath(new URL('../components/Board.svelte', import.meta.url)),
			'utf8'
		);
		// Hex literals, rgb()/hsl() functions, and CSS named colours would each be a
		// colour the palette cannot swap. Tokens (var(--…)) and palette props are the
		// only permitted sources.
		expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
	});
});
