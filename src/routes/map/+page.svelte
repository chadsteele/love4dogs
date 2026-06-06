<script>
	import {onMount} from "svelte"
	import {goto} from "$app/navigation"
	import {gpsToHash} from "$lib/utils"
	import NavBar from "$lib/NavBar.svelte"
	import {getSetting, setSetting} from "$lib/db.js"
	import {readSearchTerm} from "$lib/searchStore.js"

	let status = $state("Getting your location...")
	let error = $state("")

	onMount(async () => {
		try {
			// 1. Read stored location from DB
			let savedLocation = await getSetting('love4dogs.map-search-location')

			// 2. Read search terms from DB
			const terms = await readSearchTerm()
			const hasNearMe = String(terms || "").toLowerCase().includes("near me")

			// If no location saved, or search term has "near me", get current device location
			if (!savedLocation || hasNearMe) {
				status = "Getting your current location..."
				try {
					const position = await new Promise((resolve, reject) => {
						if (!navigator.geolocation) {
							reject(new Error("Geolocation is not supported by your browser."))
							return
						}
						navigator.geolocation.getCurrentPosition(resolve, reject, {
							enableHighAccuracy: true,
							timeout: 10000
						})
					})

					const lat = position.coords.latitude
					const lon = position.coords.longitude
					const hash = gpsToHash(lat, lon)
					if (!hash?.approx || !hash?.exact) {
						throw new Error("Could not compute a map hash for your location.")
					}

					savedLocation = {
						lat,
						lon,
						approximate: hash.approx,
						exact: hash.exact,
						zoom: savedLocation?.zoom || 13
					}
					await setSetting('love4dogs.map-search-location', savedLocation)
				} catch (err) {
					if (!savedLocation) {
						error = err.message || "Unable to get your location."
						return
					}
				}
			}

			// Open the map
			goto(`/map/${savedLocation.approximate}/${savedLocation.exact}`, {replaceState: true})
		} catch (err) {
			error = err.message || "An error occurred while loading the map."
		}
	})
</script>

<svelte:head>
	<title>Map | Love4Dogs</title>
</svelte:head>

<NavBar />

<main class="container">
	{#if error}
		<h1>Location Error</h1>
		<p class="error">{error}</p>
		<p>Try opening a map directly:</p>
		<ul>
			<li><a href="/map/mkw9x/mkw9x3zzk">/map/mkw9x/mkw9x3zzk</a></li>
			<li><a href="/map/mk3j4/mk3j4wsec">/map/mk3j4/mk3j4wsec</a></li>
		</ul>
	{:else}
		<p class="status">{status}</p>
	{/if}
</main>

<style>
	.container {
		max-width: 820px;
		margin: 1.25rem auto;
		padding: 1rem;
		background: rgba(255, 250, 241, 0.9);
		border: 1px solid rgba(58, 91, 65, 0.2);
		border-radius: 14px;
	}

	h1 {
		margin-top: 0;
	}

	.status {
		color: #6b7280;
		font-style: italic;
	}

	.error {
		color: #b91c1c;
	}
</style>
