<!--
  The daily board: a legible line drawing first, colour second.

  Every region boundary is drawn as an always-on heavy "cage" outline (the
  Killer-Sudoku primitive), so the board reads with all colour removed. This is the
  region rendering for everyone and it takes NO PROP: there is deliberately no way to
  turn it off, because it is the structural guarantee the accessible board rests on.

  The fill sits on top purely as the at-a-glance fast path, and it is the only thing
  the palette prop changes. This component holds no colour of its own — fills and ink
  arrive in the `palette` token set, and the line-drawing tokens (--cage-*, --grid-*,
  --conflict-ring) come from the page shell — so a new palette is a token file rather
  than an edit here.

  `regionLabels` draws the per-region letter, the last-resort identifier for a viewer
  for whom even a CVD palette collapses. Whether it may be on at all is decided by
  `resolveBoardPrefs` in $lib/game/palette, not here.

  Interaction is wired to the pure board rules in $lib/game/board via callbacks:
    - tap a cell to cycle empty → X → queen → empty
    - drag across empty cells (touch) to sweep X's
    - right-click to toggle an X directly (desktop)
    - arrow keys move, Space/Enter cycles, X toggles a mark (keyboard)

  The keyboard path is not an accessibility afterthought bolted beside the pointer
  path — it calls the SAME rules in $lib/game/board, so the two can never disagree
  about what a cell does. It is a standard ARIA grid: one tab stop for the whole
  board with a roving tabindex, so a player tabs onto the board once rather than
  through 121 cells.

  Rendering and cage-border drawing are verified by eye against the prototype on
  branch prototype/board-interaction, not asserted in tests.
-->
<script lang="ts">
	import type { Board, Cell, RegionMap } from '$lib/solver';
	import { isSweepable, nextFocus } from '$lib/game/board';
	import { isConflict } from '$lib/game/conflicts';
	import { regionColor, regionLabel, type Palette } from '$lib/game/palette';

	interface Props {
		regionMap: RegionMap;
		board: Board;
		conflicts: ReadonlySet<string>;
		/** The token set the region fills are drawn from. Fills only — never the borders. */
		palette: Palette;
		/** Draw the per-region letter on every cell. */
		regionLabels: boolean;
		onTap: (row: number, col: number) => void;
		onToggleX: (row: number, col: number) => void;
		onSweep: (cells: readonly Cell[]) => void;
	}

	let { regionMap, board, conflicts, palette, regionLabels, onTap, onToggleX, onSweep }: Props =
		$props();

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
		syncFocusTo(cell);
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

	// --- Keyboard: the ARIA grid roving-tabindex model. ---
	//
	// Exactly one cell carries tabindex="0" at any moment; every other is -1. That
	// makes the board a SINGLE tab stop — a keyboard player tabs onto it once and
	// then navigates within it, instead of tabbing through every cell on an 11×11.
	let focus = $state<Cell>({ row: 0, col: 0 });
	let grid = $state<HTMLElement | null>(null);
	// Only pull DOM focus when the player is actually driving the board. Without this
	// the mount-time effect would steal focus from the page on every board render.
	let keyboardActive = $state(false);

	function isFocused(row: number, col: number): boolean {
		return focus.row === row && focus.col === col;
	}

	/** Keep the roving index on a real cell if the board size changes underneath it. */
	$effect(() => {
		if (focus.row >= size || focus.col >= size) focus = { row: 0, col: 0 };
	});

	// Move real DOM focus to whichever cell holds the roving index. The tabindex swap
	// alone only decides where Tab would LAND; arrow keys must actually move focus, or
	// a screen reader keeps announcing the cell the player has already left.
	$effect(() => {
		if (!keyboardActive || !grid) return;
		const target = grid.querySelector<HTMLElement>(
			`[data-row="${focus.row}"][data-col="${focus.col}"]`
		);
		if (target && document.activeElement !== target) target.focus();
	});

	function onKeyDown(event: KeyboardEvent): void {
		const moved = nextFocus(focus, event.key, size, { ctrlKey: event.ctrlKey || event.metaKey });
		if (moved) {
			event.preventDefault();
			keyboardActive = true;
			focus = moved;
			return;
		}

		switch (event.key) {
			// The same 3-state cycle a tap performs — one control, one rule, two inputs.
			case ' ':
			case 'Enter':
				event.preventDefault();
				keyboardActive = true;
				onTap(focus.row, focus.col);
				return;
			// The keyboard equivalent of right-click, which otherwise had none: put a
			// mark down (or take it back) without cycling through queen to get there.
			case 'x':
			case 'X':
			case 'Delete':
			case 'Backspace':
				event.preventDefault();
				keyboardActive = true;
				onToggleX(focus.row, focus.col);
				return;
		}
	}

	/**
	 * A pointer press moves the roving index to the cell touched, so a player who
	 * switches from mouse to keyboard carries on from where they were looking rather
	 * than from wherever the keyboard was last.
	 */
	function syncFocusTo(cell: Cell): void {
		focus = cell;
	}
</script>

<div
	class="board"
	bind:this={grid}
	style:grid-template-columns={`repeat(${size}, var(--cell-size))`}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	oncontextmenu={onContextMenu}
	onkeydown={onKeyDown}
	role="grid"
	tabindex="-1"
	aria-label="Queens board. Arrow keys move, Space cycles a cell, X marks it."
>
	<!-- role="row" with `display: contents` satisfies the grid pattern's required
	     row structure without adding a box that would break the single CSS grid the
	     cage borders are drawn across. -->
	{#each board as rowCells, row (row)}
		<div class="row" role="row">
			{#each rowCells as state, col (col)}
				{@const region = regionMap[row][col]}
				{@const color = regionColor(palette, region)}
				{@const ringed = state === 'queen' && isConflict(conflicts, row, col)}
				<div
					class="cell"
					class:cage-right={cageRight(row, col)}
					class:cage-bottom={cageBottom(row, col)}
					class:ringed
					role="gridcell"
					tabindex={isFocused(row, col) ? 0 : -1}
					data-row={row}
					data-col={col}
					style:background={color.fill}
					style:color={color.ink}
					aria-label={`row ${row + 1}, column ${col + 1}, region ${regionLabel(region)}: ${state}`}
				>
					{#if regionLabels}
						<!-- aria-hidden: the region is already named in the cell's own label, so
						     announcing the letter again would double it up for a screen reader. -->
						<span class="region-label" aria-hidden="true">{regionLabel(region)}</span>
					{/if}
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
		</div>
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
		position: relative;
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

	.row {
		/* The rows exist for the ARIA grid pattern only; `contents` keeps every cell a
		   direct child of the single CSS grid, so the cage borders still line up. */
		display: contents;
	}

	/* The free-baseline conflict signal: a subtle red inset ring, not a fill. */
	.cell.ringed {
		box-shadow: inset 0 0 0 3px var(--conflict-ring);
	}

	/*
	  Keyboard focus. Deliberately NOT the app-wide `:focus-visible` outline: an
	  `outline` would be clipped by the board's `overflow: hidden`, and on the outer
	  cells it would be drawn over the cage border that carries the region boundary.

	  It is a second inset ring, drawn INSIDE the conflict ring and in a different
	  hue, because a cell can legitimately be focused and clashing at the same time
	  and the two signals must stay independently readable. The blue reads against
	  every fill in both palettes; the conflict red keeps the outer band it always had.
	*/
	.cell:focus {
		outline: none;
		box-shadow: inset 0 0 0 3px var(--cell-focus-ring);
	}

	.cell.ringed:focus {
		box-shadow:
			inset 0 0 0 3px var(--conflict-ring),
			inset 0 0 0 6px var(--cell-focus-ring);
	}

	/* The per-region letter: tucked into the corner, in the region's own ink, so it
	   identifies the region without competing with the queen or mark (X) glyph. */
	.region-label {
		position: absolute;
		top: 1px;
		left: 3px;
		font-size: calc(var(--cell-size) * 0.3);
		font-weight: 700;
		line-height: 1;
		opacity: 0.75;
		pointer-events: none;
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
