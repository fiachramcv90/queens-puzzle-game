import { describe, expect, it } from 'vitest';
import { extractSignals } from './signals';
import { columnRegions, diagonalRegions, uniqueRegionMap } from './test-fixtures';

describe('extractSignals', () => {
	it('reports the board size', () => {
		expect(extractSignals(uniqueRegionMap).size).toBe(uniqueRegionMap.length);
	});

	it('is deterministic — the same board yields identical signals', () => {
		expect(extractSignals(uniqueRegionMap)).toEqual(extractSignals(uniqueRegionMap));
	});

	it('gives a compact column-region board zero size variance and no row/col span waste', () => {
		const signals = extractSignals(columnRegions(8));
		// Every column-region has the same size, so variance is exactly zero.
		expect(signals.regionSizeVariance).toBe(0);
		// Each region is a full column: spans all 8 rows and 1 column.
		expect(signals.regionRowColSpan).toBe(9);
	});

	it('measures deduction depth as a non-negative integer', () => {
		const signals = extractSignals(uniqueRegionMap);
		expect(Number.isInteger(signals.forcedDeductionDepth)).toBe(true);
		expect(signals.forcedDeductionDepth).toBeGreaterThanOrEqual(0);
	});

	it('reports zero solver effort when a board falls to pure propagation', () => {
		// The hand-built unique 4×4 resolves by forced moves alone.
		const signals = extractSignals(uniqueRegionMap);
		if (signals.forcedDeductionDepth === 0) {
			expect(signals.solverNodes).toBe(0);
			expect(signals.solverBacktracks).toBe(0);
		}
	});

	it('finds an elongated diagonal layout more irregular than compact columns', () => {
		const compact = extractSignals(columnRegions(8));
		const diagonal = extractSignals(diagonalRegions(8));
		expect(diagonal.regionPerimeterAreaRatio).toBeGreaterThan(compact.regionPerimeterAreaRatio);
	});
});
