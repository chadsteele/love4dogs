<script>
	import NavBar from "$lib/NavBar.svelte"
</script>

<svelte:head>
	<title>Settings | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar hideCreateButton={true} />

	<section class="panel">
		<h2>Settings</h2>
		<p class="help">
			Set your defaults once and keep your workflow faster.
		</p>
	</section>
</main>

<style>
	.page {
		max-width: 980px;
		margin: 0 auto;
		padding: 1rem;
		display: grid;
		gap: 0.85rem;
	}

	.panel {
		background: rgba(255, 250, 241, 0.92);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 0.9rem;
	}

	h2 {
		margin: 0;
	}

	.help {
		margin: 0.35rem 0 0.75rem;
		color: #5f665f;
		font-size: 0.9rem;
	}
</style>
