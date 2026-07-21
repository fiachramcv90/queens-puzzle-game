import type { Cell } from './types';

/**
 * Whether two cells are king-adjacent: at Chebyshev distance 1, i.e.
 * `max(|dr|, |dc|) === 1`. This is the one adjacency definition, exported from
 * here and used everywhere — generator, client highlighting, server validation.
 *
 * Chebyshev is implemented literally, on purpose. The tempting `|dr| + |dc| > 2`
 * shortcut for "not adjacent" is equivalent *only* on a board that already has
 * one queen per row and per column: it wrongly treats a same-column pair two
 * apart, `(0,0)` and `(2,0)`, as adjacent (Manhattan 2), and it does so exactly
 * on the partial, mid-solve boards the client hands us. So we never take it.
 *
 * A cell is not adjacent to itself (Chebyshev distance 0).
 */
export function isAdjacent(a: Cell, b: Cell): boolean {
	const dr = Math.abs(a.row - b.row);
	const dc = Math.abs(a.col - b.col);
	return Math.max(dr, dc) === 1;
}
