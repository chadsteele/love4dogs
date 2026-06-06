<script>
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import NavBar from "$lib/NavBar.svelte"
	import MapView from "$lib/MapView.svelte"
	import FeedHeaderActions from "$lib/FeedHeaderActions.svelte"

	const urlTerms = $derived(
		String(page.params?.terms || "")
			.split("/")
			.map((s) => s.trim())
			.filter(Boolean)
			.join(" "),
	)

	let searchTerm = $state("")
	let refreshTrigger = $state(0)
	let mapCenter = $state(null)

	$effect(() => {
		searchTerm = urlTerms
	})

	function handleSearchInput() {
		if (!searchTerm.trim()) {
			goto("/map")
		}
	}

	function handleRefresh() {
		refreshTrigger += 1
	}
</script>

<svelte:head>
	<title>{urlTerms ? `${urlTerms} | Map | Love4Dogs` : 'Map | Love4Dogs'}</title>
	<meta name="description" content="View dog, cat and other pet post locations on our interactive map." />
</svelte:head>

<main class="map-page-layout">
	<NavBar
		bind:searchTerm
		showSearch={true}
		onSearchInput={handleSearchInput}
	/>

	<section class="map-container-panel">
		<div class="feed-header">
			<div class="feed-header-left">
				<h2>
					{#if urlTerms}
						Map Results
					{:else}
						Map View
					{/if}
				</h2>
			</div>
			<FeedHeaderActions
				currentView="map"
				searchTerm={urlTerms}
				onRefresh={handleRefresh}
				{mapCenter}
			/>
		</div>

		<MapView searchTerm={urlTerms} refreshTrigger={refreshTrigger} bind:mapCenter={mapCenter} />
	</section>
</main>

<style>
	.map-page-layout {
		max-width: 1120px;
		margin: 0 auto;
		padding: 1rem;
	}

	.map-container-panel {
		background: rgba(255, 250, 241, 0.88);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 1.25rem;
		box-shadow: 0 10px 26px rgba(65, 42, 20, 0.12);
		margin-bottom: 2rem;
	}

	.feed-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.feed-header-left {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
	}

	h2 {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		font-size: 1rem;
	}

	@media (max-width: 640px) {
		.feed-header {
			flex-wrap: wrap;
		}
	}
</style>

