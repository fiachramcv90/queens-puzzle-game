/**
 * The one default pastel palette, expressed as tokens.
 *
 * Each region id maps to a `{ fill, ink }` pair — a soft background and a legible
 * foreground for the queen and X glyphs on it. This is the AT-A-GLANCE fast path
 * only: the board's legibility does not depend on it, because the always-on cage
 * borders carry the region boundaries as a line drawing with all colour removed.
 *
 * The palette TOKEN SET (multiple named palettes) and the CVD toggle land in a
 * later ticket. Here there is one set, addressed by region id, wrapping if a board
 * ever has more regions than entries.
 */

export interface RegionColor {
	/** Soft background fill for the region. */
	readonly fill: string;
	/** Legible foreground for glyphs sitting on the fill. */
	readonly ink: string;
}

/**
 * Twelve pastel/ink pairs — comfortably more than the largest MVP board — tuned
 * for gentle contrast between neighbours so the colour layer reads at a glance
 * without shouting over the line drawing beneath it.
 */
export const REGION_PALETTE: readonly RegionColor[] = [
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

/** The colour for a region id, wrapping if the id exceeds the palette length. */
export function regionColor(regionId: number): RegionColor {
	return REGION_PALETTE[regionId % REGION_PALETTE.length];
}
