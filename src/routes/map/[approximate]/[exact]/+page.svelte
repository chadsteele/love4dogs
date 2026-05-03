<script>
	let {data} = $props()

	function openDirections(lat, lon) {
		window.open(
			`https://maps.google.com/?q=${lat},${lon}`,
			"_blank",
			"noopener,noreferrer",
		)
	}
</script>

<svelte:head>
	<title>Map Location</title>
</svelte:head>

<main class="map-page">
	<nav class="topline">
		<a class="nav-btn" href="/">＜ Go Back</a>
		<h1 class="map-title">Map</h1>
		{#if data.valid}
			<button
				class="nav-btn"
				onclick={() => openDirections(data.lat, data.lon)}
			>
				Get Directions ↗
			</button>
		{/if}
	</nav>
	{#if data.valid}
		<iframe
			title="Location map"
			src={data.mapEmbedUrl}
			loading="lazy"
			referrerpolicy="no-referrer-when-downgrade"
			allowfullscreen
		></iframe>
		<p class="coords">📍 {data.lat}, {data.lon}</p>
	{:else}
		<p class="error">{data.error}</p>
		<p class="muted">Try: /map/mkw9x/mkw9x3zzk</p>
	{/if}
</main>

<style>
	.map-page {
		max-width: 920px;
		margin: 1.25rem auto;
		padding: 1rem;
		background: rgba(255, 250, 241, 0.88);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		box-shadow: 0 10px 26px rgba(65, 42, 20, 0.12);
	}

	.topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.map-title {
		margin: 0;
		font-size: 1rem;
		flex: 1;
		text-align: center;
	}

	.coords {
		margin: 0.6rem 0 0;
		font-size: 0.82rem;
		color: #5f665f;
		font-family: monospace;
	}

	.nav-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.45rem 1rem;
		background: #3b6e4f;
		color: #fff;
		border: 1px solid #305741;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease;
		white-space: nowrap;
		text-decoration: none;
		font-family: inherit;
	}

	.nav-btn:hover {
		background: #305741;
	}

	.muted {
		color: #5f665f;
		margin: 0.45rem 0;
	}

	.error {
		color: #8e2f21;
		margin: 0.45rem 0;
	}

	iframe {
		width: 100%;
		height: 68vh;
		min-height: 360px;
		border: 0;
		border-radius: 12px;
		background: #f0e7da;
		display: block;
	}
</style>
