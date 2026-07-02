<script>
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import NavBar from "$lib/NavBar.svelte"
	import MapView from "$lib/MapView.svelte"
	import FeedHeaderActions from "$lib/FeedHeaderActions.svelte"
	import { lookupLocationDetails } from "$lib/utils"

	const urlTerms = $derived.by(() => {
		const termsParam = String(page.params?.terms || "")
			.split("/")
			.map((s) => s.trim())
			.filter(Boolean)
			.join(" ")
		if (termsParam) return termsParam;
		return page.url?.searchParams?.get("q") || "";
	})

	let searchTerm = $state("")
	let refreshTrigger = $state(0)
	let mapCenter = $state(null)
	let country = $state("")

	$effect(() => {
		searchTerm = urlTerms
	})

	$effect(() => {
		const center = mapCenter
		if (!center || typeof center.lat !== "number" || typeof center.lon !== "number") {
			country = ""
			return
		}

		const timer = setTimeout(async () => {
			try {
				const res = await lookupLocationDetails(center.lat, center.lon)
				if (res && res.location) {
					const { state, country: countryVal } = res.location
					country = [state, countryVal].filter(Boolean).join(", ")
				} else {
					country = ""
				}
			} catch (e) {
				console.error("Failed to lookup location details:", e)
				country = ""
			}
		}, 400)

		return () => {
			clearTimeout(timer)
		}
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
					{country || "Map Results"}
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

