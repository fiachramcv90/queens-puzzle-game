import type { Cell, RegionMap } from './types';

/**
 * The canonical hash of a puzzle over `(size, region_map, solution)`.
 *
 * This is the value the offline pool later unique-constrains on so a player is
 * never served the same board twice (see the MVP build spec, issue #18). Two
 * properties are load-bearing:
 *
 * - **Stable across runs and machines.** A pure function of the three inputs,
 *   using a fixed string encoding and a fixed hash — no `Date`, no `Math.random`,
 *   no locale, no object-key iteration order. The same board hashes the same
 *   forever, which is what makes the DB constraint meaningful across deploys.
 * - **Invariant to region-id relabeling.** The region *ids* are arbitrary colour
 *   labels; two boards that partition the grid identically but number the colours
 *   differently are the *same* puzzle to a player, so they must collide. The
 *   region map is therefore canonicalised (see {@link canonicalRegionIds}) before
 *   hashing. Genuinely different partitions still differ.
 *
 * The solution is included because a region map alone does not identify a puzzle
 * — the same colouring paired with a different hidden solution is a different
 * board. It is encoded as one column per row, which a Queens solution always has.
 */
export function boardHash(size: number, regionMap: RegionMap, solution: readonly Cell[]): string {
	const regions = canonicalRegionIds(regionMap);
	const regionPart = regions.map((row) => row.join(',')).join(';');

	// One column per row: a Queens solution has exactly one queen per row, so the
	// row-indexed column list is a complete, order-independent encoding.
	const cols = new Array<number>(size).fill(-1);
	for (const { row, col } of solution) cols[row] = col;
	const solutionPart = cols.join(',');

	return fnv1a64Hex(`${size}|${regionPart}|${solutionPart}`);
}

/**
 * Relabel a region map's ids by first-appearance in a row-major scan: the first
 * cell's region becomes 0, the next new region 1, and so on. This is the
 * relabeling-invariant canonical form used before hashing — any permutation of
 * the original ids maps to the same output.
 */
export function canonicalRegionIds(regionMap: RegionMap): number[][] {
	const remap = new Map<number, number>();
	return regionMap.map((row) =>
		row.map((region) => {
			let id = remap.get(region);
			if (id === undefined) {
				id = remap.size;
				remap.set(region, id);
			}
			return id;
		})
	);
}

/**
 * FNV-1a, 64-bit, as a zero-padded 16-char hex string. Implemented with BigInt
 * so the 64-bit arithmetic is exact rather than silently wrapping through
 * JavaScript's 53-bit floats. Chosen for a stable, dependency-free hash — this is
 * a content fingerprint, not a security primitive.
 */
function fnv1a64Hex(input: string): string {
	const mask = (1n << 64n) - 1n;
	const prime = 0x100000001b3n;
	let hash = 0xcbf29ce484222325n;
	for (let i = 0; i < input.length; i++) {
		hash ^= BigInt(input.charCodeAt(i));
		hash = (hash * prime) & mask;
	}
	return hash.toString(16).padStart(16, '0');
}
