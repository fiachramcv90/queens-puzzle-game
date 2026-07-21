import { describe, expect, it } from 'vitest';
import { boardHash, canonicalRegionIds } from './hash';
import type { Cell, RegionMap } from './types';
import { uniqueRegionMap, uniqueSolution } from './test-fixtures';

describe('canonicalRegionIds', () => {
	it('relabels by first appearance in a row-major scan', () => {
		const map: RegionMap = [
			[5, 5, 2],
			[5, 9, 2],
			[9, 9, 2]
		];
		expect(canonicalRegionIds(map)).toEqual([
			[0, 0, 1],
			[0, 2, 1],
			[2, 2, 1]
		]);
	});

	it('is idempotent on an already-canonical map', () => {
		const canonical = canonicalRegionIds(uniqueRegionMap);
		expect(canonicalRegionIds(canonical)).toEqual(canonical);
	});
});

describe('boardHash', () => {
	const size = uniqueRegionMap.length;

	it('is stable across runs', () => {
		expect(boardHash(size, uniqueRegionMap, uniqueSolution)).toBe(
			boardHash(size, uniqueRegionMap, uniqueSolution)
		);
	});

	it('does not depend on the order the solution cells are listed', () => {
		const reversed = [...uniqueSolution].reverse();
		expect(boardHash(size, uniqueRegionMap, reversed)).toBe(
			boardHash(size, uniqueRegionMap, uniqueSolution)
		);
	});

	it('is invariant to region-id relabeling', () => {
		// Add a constant offset to every region id: same partition, different labels.
		const relabeled: RegionMap = uniqueRegionMap.map((row) => row.map((r) => r + 10));
		expect(boardHash(size, relabeled, uniqueSolution)).toBe(
			boardHash(size, uniqueRegionMap, uniqueSolution)
		);
	});

	it('differs when the region map differs', () => {
		const different: RegionMap = uniqueRegionMap.map((row, r) =>
			row.map((region, c) => (r === 0 && c === 0 ? 1 : region))
		);
		expect(boardHash(size, different, uniqueSolution)).not.toBe(
			boardHash(size, uniqueRegionMap, uniqueSolution)
		);
	});

	it('differs when the solution differs', () => {
		const otherSolution: Cell[] = uniqueSolution.map((cell, i) =>
			i === 0 ? { row: cell.row, col: (cell.col + 1) % size } : cell
		);
		expect(boardHash(size, uniqueRegionMap, otherSolution)).not.toBe(
			boardHash(size, uniqueRegionMap, uniqueSolution)
		);
	});

	it('differs when the size differs', () => {
		expect(boardHash(size + 1, uniqueRegionMap, uniqueSolution)).not.toBe(
			boardHash(size, uniqueRegionMap, uniqueSolution)
		);
	});

	it('is a 16-char hex string', () => {
		expect(boardHash(size, uniqueRegionMap, uniqueSolution)).toMatch(/^[0-9a-f]{16}$/);
	});
});
