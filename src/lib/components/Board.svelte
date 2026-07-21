<!--
  The daily board: a legible line drawing first, colour second.

  Every region boundary is drawn as an always-on heavy "cage" outline (the
  Killer-Sudoku primitive), so the board reads with all colour removed. The pastel
  fill sits on top purely as the at-a-glance fast path. This is the region
  rendering for everyone — there is no toggle.

  Interaction is wired to the pure board rules in $lib/game/board via callbacks:
    - tap a cell to cycle empty → X → queen → empty
    - drag across empty cells (touch) to sweep X's
    - right-click to toggle an X directly (desktop)

  Rendering and cage-border drawing are verified by eye against the prototype on
  branch prototype/board-interaction, not asserted in tests.
-->
<script lang="ts">
	import type { Board, Cell, RegionMap } from '$lib/solver';
	import { isSweepable } from '$lib/game/board';
	import { isConflict } from '$lib/game/conflicts';
	import { regionColor } from '$lib/game/palette';

	interface Props {
		regionMap: RegionMap;
		board: Board;
		conflicts: ReadonlySet<string>;
		onTap: (row: number, col: number) => void;
		onToggleX: (row: number, col: number) => void;
		onSweep: (cells: readonly Cell[]) => void;
	}

	let { regionMap, board, conflicts, onTap, onToggleX, onSweep }: Props = $props();

	const size = $derived(board.length);

	/** Whether a heavy cage line sits on a cell's given edge (region boundary). */
	function cageRight(row: number, col: number): boolean {
		return col < size - 1 && regionMap[row][col] !== regionMap[row][col + 1];
	}
	function cageBottom(row: number, col: number): boolean {
		return row < size - 1 && regionMap[row][col] !== regionMap[row + 1][col];
	}

	// --- Pointer handling: one gesture engine for tap and drag-sweep. ---
	//
	// Under pointer capture every move event targets the origin element, so the
	// cell currently under the finger is found via elementFromPoint + data attrs
	// rather than the event target.
	let downCell: Cell | null = null;
	let dragMode: 'sweep' | 'none' | null = null;
	// Whether this gesture has swept at least one cell — how pointerup tells a drag
	// from a plain tap. No per-cell dedup set is needed: a swept cell becomes an X,
	// so sweepable() rejects it on any repeat, and sweepX is idempotent regardless.
	let didSweep = false;

	function cellOf(el: Element | null): Cell | null {
		const holder = el?.closest<HTMLElement>('[data-row]');
		if (!holder) return null;
		return { row: Number(holder.dataset.row), col: Number(holder.dataset.col) };
	}

	function cellUnder(clientX: number, clientY: number): Cell | null {
		return cellOf(document.elementFromPoint(clientX, clientY));
	}

	function sweepable(cell: Cell): boolean {
		return isSweepable(board[cell.row][cell.col]);
	}

	function markSweep(cell: Cell): void {
		if (!sweepable(cell)) return;
		didSweep = true;
		onSweep([cell]);
	}

	function onPointerDown(event: PointerEvent): void {
		// Only the primary button starts a gesture; right-click is handled separately.
		if (event.button !== 0) return;
		const cell = cellOf(event.target as Element);
		if (!cell) return;
		downCell = cell;
		dragMode = null;
		didSweep = false;
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	}

	function onPointerMove(event: PointerEvent): void {
		if (!downCell) return;
		const cell = cellUnder(event.clientX, event.clientY);
		if (!cell) return;
		if (dragMode === null) {
			// Decide the gesture the first time the finger reaches any cell: a drag
			// begun on an empty/auto-X cell sweeps X's; one begun on a queen or X does
			// nothing (so a stray drag never wipes a deliberate placement).
			dragMode = sweepable(downCell) ? 'sweep' : 'none';
			if (dragMode === 'sweep') markSweep(downCell);
		}
		if (dragMode === 'sweep') markSweep(cell);
	}

	function onPointerUp(): void {
		// No sweeping happened → the gesture was a tap on the pressed cell.
		if (downCell && !didSweep) onTap(downCell.row, downCell.col);
		downCell = null;
		dragMode = null;
		didSweep = false;
	}

	function onContextMenu(event: MouseEvent): void {
		const cell = cellOf(event.target as Element);
		if (!cell) return;
		event.preventDefault();
		onToggleX(cell.row, cell.col);
	}
</script>

<div
	class="board"
	style:grid-template-columns={`repeat(${size}, var(--cell-size))`}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	oncontextmenu={onContextMenu}
	role="group"
	aria-label="Queens board"
>
	{#each board as rowCells, row (row)}
		{#each rowCells as state, col (col)}
			{@const color = regionColor(regionMap[row][col])}
			{@const ringed = state === 'queen' && isConflict(conflicts, row, col)}
			<div
				class="cell"
				class:cage-right={cageRight(row, col)}
				class:cage-bottom={cageBottom(row, col)}
				class:ringed
				data-row={row}
				data-col={col}
				style:background={color.fill}
				style:color={color.ink}
				aria-label={`row ${row + 1}, column ${col + 1}: ${state}`}
			>
				{#if state === 'queen'}
					<svg class="glyph queen" viewBox="0 0 24 24" aria-hidden="true">
						<path
							fill="currentColor"
							d="M5 16h14l1.2-8-4.2 3L12 5 8 11 3.8 8 5 16zm-.5 2.5h15a.5.5 0 0 1 .5.5v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1a.5.5 0 0 1 .5-.5z"
						/>
					</svg>
				{:else if state === 'X'}
					<svg class="glyph mark" viewBox="0 0 24 24" aria-hidden="true">
						<path
							fill="none"
							stroke="currentColor"
							stroke-width="2.4"
							stroke-linecap="round"
							d="M6 6l12 12M18 6L6 18"
						/>
					</svg>
				{:else if state === 'auto-X'}
					<svg class="glyph mark auto" viewBox="0 0 24 24" aria-hidden="true">
						<path
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							d="M6 6l12 12M18 6L6 18"
						/>
					</svg>
				{/if}
			</div>
		{/each}
	{/each}
</div>

<style>
	.board {
		display: inline-grid;
		gap: 0;
		/* The outer cage: the board's own boundary, same heavy ink as region lines. */
		border: var(--cage-width) solid var(--cage-line);
		border-radius: 4px;
		overflow: hidden;
		/* Prevent the page scrolling mid-drag while sweeping X's on touch. */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}

	.cell {
		width: var(--cell-size);
		height: var(--cell-size);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		/* Thin internal grid line by default; the heavy cage lines override below. */
		border-right: var(--grid-width) solid var(--grid-line);
		border-bottom: var(--grid-width) solid var(--grid-line);
		box-sizing: border-box;
	}

	/* A region boundary: a heavy dark line that carries the board as a line
	   drawing even with every fill removed. */
	.cell.cage-right {
		border-right: var(--cage-width) solid var(--cage-line);
	}
	.cell.cage-bottom {
		border-bottom: var(--cage-width) solid var(--cage-line);
	}

	/* The free-baseline conflict signal: a subtle red inset ring, not a fill. */
	.cell.ringed {
		box-shadow: inset 0 0 0 3px var(--conflict-ring);
	}

	.glyph {
		width: 62%;
		height: 62%;
		pointer-events: none;
	}
	.glyph.mark {
		width: 48%;
		height: 48%;
		opacity: 0.85;
	}
	.glyph.mark.auto {
		opacity: 0.35;
	}
</style>
