<svelte:head>
	<title>Queens</title>
	<meta name="description" content="A daily Queens logic puzzle." />
</svelte:head>

<main>
	<h1>Queens</h1>
	<p>One queen per row, per column and per region — and no two queens touching, even diagonally.</p>
	<p class="placeholder">The daily isn't here yet. This is the scaffold.</p>
</main>

<style>
	main {
		max-width: 32rem;
		margin: 0 auto;
		padding: 4rem 1.5rem;
		font-family: system-ui, sans-serif;
		line-height: 1.6;
	}

	h1 {
		font-size: 3rem;
		margin: 0 0 1rem;
	}

	.placeholder {
		color: #666;
	}
</style>
