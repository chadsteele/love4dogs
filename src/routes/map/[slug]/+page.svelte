<script>
	let {data} = $props()
</script>

<svelte:head>
	<title>Map Location</title>
</svelte:head>

<main class="map-page">
	{#if data.valid}
		<h1>Decoded Location</h1>
		<p class="meta">Slug: {data.slug}</p>
		<p class="meta">Coordinates: {data.lat}, {data.lon}</p>
		<p class="meta">
			<a href={data.mapUrl} target="_blank" rel="noopener noreferrer"
				>Open in Google Maps</a
			>
		</p>

		<iframe
			title="Location map"
			src={data.mapUrl}
			loading="lazy"
			referrerpolicy="no-referrer-when-downgrade"
			allowfullscreen
		></iframe>
	{:else}
		<h1>Invalid Map Slug</h1>
		<p class="error">{data.error}</p>
		<p class="meta">Try: /map/-20.17849,57.77235</p>
	{/if}
</main>

<style>
	.map-page {
		max-width: 920px;
		margin: 1.25rem auto;
		padding: 1rem;
		background: rgba(255, 250, 241, 0.9);
		border: 1px solid rgba(58, 91, 65, 0.2);
		border-radius: 14px;
	}

	h1 {
		margin: 0 0 0.6rem;
	}

	.meta {
		margin: 0.35rem 0;
	}

	.error {
		color: #8e2f21;
	}

	iframe {
		margin-top: 0.9rem;
		width: 100%;
		height: 68vh;
		min-height: 360px;
		border: 0;
		border-radius: 12px;
		background: #f0e7da;
	}
</style>
