<script>
	import {onMount} from "svelte"
	import {goto} from "$app/navigation"
	import {gpsToHash} from "$lib/utils"

	let status = $state("Getting your location...")
	let error = $state("")

	onMount(() => {
		if (!navigator.geolocation) {
			error = "Geolocation is not supported by your browser."
			return
		}
		navigator.geolocation.getCurrentPosition(
			(position) => {
				const lat = position.coords.latitude
				const lon = position.coords.longitude
				const hash = gpsToHash(lat, lon)
				if (!hash?.approx || !hash?.exact) {
					error = "Could not compute a map hash for your location."
					return
				}
				goto(`/map/${hash.approx}/${hash.exact}`, {replaceState: true})
			},
			(err) => {
				error = err.message || "Unable to get your location."
			},
			{enableHighAccuracy: true, timeout: 10000},
		)
	})
</script>

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
