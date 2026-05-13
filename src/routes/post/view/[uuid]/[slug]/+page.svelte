<script>
	let {data} = $props()

	const displaySlug = $derived(
		String(data?.slug || "")
			.split("-")
			.filter(Boolean)
			.join(" "),
	)
</script>

<svelte:head>
	<title>Post View</title>
</svelte:head>

<main class="post-view-page">
	<h1>Post View</h1>
	<p class="muted">UUID: {data?.uuid}</p>
	{#if displaySlug}
		<p class="muted">Slug: {displaySlug}</p>
	{/if}
	<p class="note">
		This route is available and can be expanded to render post details.
	</p>
	<p>
		<a href="/">Back home</a>
	</p>
</main>

<style>
	.post-view-page {
		max-width: 760px;
		margin: 0 auto;
		padding: 1rem;
	}

	.muted {
		color: #5f665f;
	}

	.note {
		margin-top: 0.75rem;
	}
</style>
