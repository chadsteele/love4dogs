<script>
	import {onMount} from "svelte"
	import {goto} from "$app/navigation"
	import "leaflet/dist/leaflet.css"
	import {
		getApproxPostsFromCache,
		gpsToHash,
		setApproxPostsInCache,
	} from "$lib/utils"
	import PostCard from "$lib/PostCard.svelte"

	let {data} = $props()
	let mapEl = $state(null)
	let mapPosts = $state([])
	let loadingPins = $state(false)
	let mapError = $state("")
	let selectedPost = $state(null)
	let viewportApproximates = $state([])
	let locationQuery = $state("")
	let searchingLocation = $state(false)
	let searchError = $state("")

	let leaflet = null
	let mapInstance = null
	let markerLayer = null
	let lastViewportKey = ""
	let mapLoadRequestId = 0
	let viewportRefreshTimer = null
	const approxPostsCache = new Map()
	const approxErrorCache = new Set()

	const MIN_GRID_SAMPLES = 5
	const MAX_GRID_SAMPLES = 16
	const TARGET_HASH_STEP_DEGREES = 0.05
	const FETCH_CONCURRENCY = 8
	const VIEWPORT_REFRESH_DEBOUNCE_MS = 220

	async function searchLocation(event) {
		event?.preventDefault?.()
		searchError = ""
		const query = String(locationQuery || "").trim()
		if (!query) {
			searchError = "Type a location to search."
			return
		}

		searchingLocation = true
		try {
			const res = await fetch("/api/geocode", {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({query}),
			})
			const json = await res.json().catch(() => ({}))
			if (!res.ok) {
				throw new Error(json.error || "Unable to find that location.")
			}

			const lat = Number(json?.lat)
			const lon = Number(json?.lon)
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
				throw new Error("Invalid coordinates returned from geocoder.")
			}

			const hash = gpsToHash(lat, lon)
			if (!hash?.approx || !hash?.exact) {
				throw new Error(
					"Unable to compute a map hash for that location.",
				)
			}

			await goto(`/map/${hash.approx}/${hash.exact}`)
		} catch (error) {
			searchError = error?.message || "Unable to find that location."
		} finally {
			searchingLocation = false
		}
	}

	function clamp(value, min, max) {
		return Math.max(min, Math.min(max, value))
	}

	function gridSamplesForViewport({south, north, west, east}) {
		if (!mapInstance) return MIN_GRID_SAMPLES
		const latSpan = Math.max(Math.abs(north - south), 0)
		const lonSpan = Math.max(Math.abs(east - west), 0)
		const spanDriven = Math.max(
			Math.ceil(latSpan / TARGET_HASH_STEP_DEGREES) + 1,
			Math.ceil(lonSpan / TARGET_HASH_STEP_DEGREES) + 1,
		)
		const zoom = Number(mapInstance.getZoom?.() || 0)
		const zoomDriven = zoom <= 8 ? 12 : zoom <= 10 ? 10 : zoom <= 12 ? 8 : 6
		return clamp(
			Math.max(spanDriven, zoomDriven),
			MIN_GRID_SAMPLES,
			MAX_GRID_SAMPLES,
		)
	}

	function openDirections(lat, lon) {
		window.open(
			`https://maps.google.com/?q=${lat},${lon}`,
			"_blank",
			"noopener,noreferrer",
		)
	}

	function escapeHtml(text = "") {
		return String(text)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
	}

	function escapeAttr(text = "") {
		return String(text)
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
	}

	function markerPreviewHtml(post) {
		const text = String(post?.text || "").trim()
		const summary = text.length > 260 ? `${text.slice(0, 257)}...` : text
		const formatted = escapeHtml(summary).replace(/\n+/g, "<br />")
		const firstImage = post?.images?.[0]
		const thumb = firstImage
			? `<img class="pin-preview-thumb" src="${escapeAttr(firstImage)}" alt="Post preview" loading="lazy" />`
			: ""

		return `
			<div class="pin-preview">
				${thumb}
				<div class="pin-preview-text">${formatted || "No text"}</div>
				<button type="button" class="pin-preview-open" data-open-post="${escapeAttr(post?.uri || "")}">Open post</button>
			</div>
		`
	}

	function collectViewportApproximates() {
		if (!mapInstance) return []
		const bounds = mapInstance.getBounds()
		const south = bounds.getSouth()
		const north = bounds.getNorth()
		const west = bounds.getWest()
		const east = bounds.getEast()
		const hashes = new Set()
		const gridSamples = gridSamplesForViewport({south, north, west, east})

		for (let row = 0; row < gridSamples; row += 1) {
			const latRatio = gridSamples === 1 ? 0.5 : row / (gridSamples - 1)
			const lat = south + (north - south) * latRatio
			for (let col = 0; col < gridSamples; col += 1) {
				const lonRatio =
					gridSamples === 1 ? 0.5 : col / (gridSamples - 1)
				const lon = west + (east - west) * lonRatio
				const hash = gpsToHash(lat, lon)
				if (hash?.approx) hashes.add(hash.approx)
			}
		}

		if (data?.approximate)
			hashes.add(String(data.approximate).toLowerCase())
		return [...hashes]
	}

	async function fetchApproximatesBatched(approximates = []) {
		const results = []
		const workers = []
		let cursor = 0

		const runWorker = async () => {
			while (cursor < approximates.length) {
				const index = cursor
				cursor += 1
				if (index >= approximates.length) return
				const approximate = approximates[index]
				try {
					const params = new URLSearchParams({approximate})
					const res = await fetch(
						`/api/map-posts?${params.toString()}`,
					)
					const json = await res.json().catch(() => ({}))
					if (!res.ok) {
						throw new Error(
							json.error ||
								`Unable to load posts for ${approximate}.`,
						)
					}
					const posts = Array.isArray(json.posts) ? json.posts : []
					approxPostsCache.set(approximate, posts)
					setApproxPostsInCache(approximate, posts)
					approxErrorCache.delete(approximate)
					results[index] = {
						status: "fulfilled",
						value: {approximate, posts},
					}
				} catch (error) {
					approxErrorCache.add(approximate)
					results[index] = {status: "rejected", reason: error}
				}
			}
		}

		for (
			let worker = 0;
			worker < Math.min(FETCH_CONCURRENCY, approximates.length);
			worker += 1
		) {
			workers.push(runWorker())
		}

		await Promise.all(workers)
		return results
	}

	async function loadMapPosts(approximates = []) {
		const requestId = ++mapLoadRequestId
		loadingPins = true
		mapError = ""
		try {
			const cleanApproximates = approximates
				.map((value) =>
					String(value || "")
						.trim()
						.toLowerCase(),
				)
				.filter(Boolean)
			if (!cleanApproximates.length) {
				mapPosts = []
				return
			}

			const cachedPosts = []
			const missingApproximates = []
			for (const approximate of cleanApproximates) {
				if (approxPostsCache.has(approximate)) {
					cachedPosts.push(
						...(approxPostsCache.get(approximate) || []),
					)
					continue
				}
				const persistedPosts = getApproxPostsFromCache(approximate)
				if (Array.isArray(persistedPosts)) {
					approxPostsCache.set(approximate, persistedPosts)
					cachedPosts.push(...persistedPosts)
					continue
				}
				if (approxErrorCache.has(approximate)) continue
				missingApproximates.push(approximate)
			}

			const responses =
				await fetchApproximatesBatched(missingApproximates)

			if (requestId !== mapLoadRequestId) return

			const merged = [...cachedPosts]
			const seenUris = new Set()
			for (const post of merged) {
				if (post?.uri) seenUris.add(post.uri)
			}
			for (let i = 0; i < responses.length; i += 1) {
				const result = responses[i]
				if (result.status !== "fulfilled") {
					const approximate = missingApproximates[i]
					if (approximate) approxErrorCache.add(approximate)
					continue
				}
				for (const post of result.value.posts) {
					if (!post?.uri || seenUris.has(post.uri)) continue
					seenUris.add(post.uri)
					merged.push(post)
				}
			}
			mapPosts = merged

			const rejected = responses.find(
				(result) => result.status === "rejected",
			)
			if (rejected && merged.length === 0) {
				throw rejected.reason
			}
		} catch (error) {
			if (requestId !== mapLoadRequestId) return
			mapError = error.message || "Unable to load map posts."
			mapPosts = []
		} finally {
			if (requestId !== mapLoadRequestId) return
			loadingPins = false
		}
	}

	async function refreshViewportPosts() {
		if (!mapInstance) return
		const approximates = collectViewportApproximates()
		const key = [...approximates].sort().join(",")
		if (key === lastViewportKey) return
		lastViewportKey = key
		viewportApproximates = approximates
		await loadMapPosts(approximates)
	}

	function scheduleViewportRefresh() {
		if (viewportRefreshTimer) clearTimeout(viewportRefreshTimer)
		viewportRefreshTimer = setTimeout(() => {
			refreshViewportPosts()
		}, VIEWPORT_REFRESH_DEBOUNCE_MS)
	}

	function markerIcon() {
		return leaflet.divIcon({
			className: "post-marker",
			html: "<span></span>",
			iconSize: [20, 20],
			iconAnchor: [10, 10],
		})
	}

	function validMapPosts() {
		return mapPosts.filter(
			(post) => Number.isFinite(post?.lat) && Number.isFinite(post?.lon),
		)
	}

	function renderMarkers() {
		if (!leaflet || !mapInstance || !markerLayer) return

		markerLayer.clearLayers()
		const exactMarker = leaflet
			.circleMarker([data.lat, data.lon], {
				radius: 6,
				color: "#1f5135",
				fillColor: "#3b6e4f",
				fillOpacity: 0.95,
				weight: 2,
			})
			.addTo(markerLayer)

		exactMarker.on("click", () => {
			exactMarker
				.bindPopup(
					`Exact hash location (${data.exact})<br/>${data.lat}, ${data.lon}`,
				)
				.openPopup()
		})

		for (const post of validMapPosts()) {
			const marker = leaflet
				.marker([post.lat, post.lon], {icon: markerIcon()})
				.addTo(markerLayer)
			marker.bindPopup(markerPreviewHtml(post), {maxWidth: 280})
			marker.on("popupopen", (event) => {
				const el = event.popup?.getElement?.()
				const openBtn = el?.querySelector?.("[data-open-post]")
				if (!openBtn) return
				openBtn.addEventListener(
					"click",
					() => {
						selectedPost = post
					},
					{once: true},
				)
			})
		}
	}

	$effect(() => {
		renderMarkers()
	})

	onMount(() => {
		let destroyed = false

		async function initMap() {
			if (!data?.valid || typeof window === "undefined") return
			const module = await import("leaflet")
			if (destroyed) return

			leaflet = module.default ?? module
			mapInstance = leaflet
				.map(mapEl, {
					zoomControl: true,
					attributionControl: true,
				})
				.setView([data.lat, data.lon], 13)

			leaflet
				.tileLayer(
					"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
					{
						maxZoom: 19,
						attribution: "&copy; OpenStreetMap contributors",
					},
				)
				.addTo(mapInstance)

			markerLayer = leaflet.layerGroup().addTo(mapInstance)
			mapInstance.on("moveend", () => {
				scheduleViewportRefresh()
			})
			await refreshViewportPosts()
			renderMarkers()
			setTimeout(() => mapInstance?.invalidateSize({pan: false}), 0)
		}

		initMap()

		return () => {
			destroyed = true
			if (viewportRefreshTimer) {
				clearTimeout(viewportRefreshTimer)
				viewportRefreshTimer = null
			}
			if (mapInstance) {
				mapInstance.remove()
				mapInstance = null
				markerLayer = null
			}
		}
	})
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
		<form class="search-row" onsubmit={searchLocation}>
			<input
				type="search"
				class="search-input"
				placeholder="Search city, village, address..."
				bind:value={locationQuery}
				autocomplete="off"
			/>
			<button
				class="search-btn"
				type="submit"
				disabled={searchingLocation}
			>
				{searchingLocation ? "Searching..." : "Go"}
			</button>
		</form>
		{#if searchError}
			<p class="error">{searchError}</p>
		{/if}
		<div class="map-view" bind:this={mapEl}></div>
		{#if loadingPins}
			<p class="muted">Loading nearby posts...</p>
		{:else if mapError}
			<p class="error">{mapError}</p>
		{:else}
			<p class="muted">
				Found {validMapPosts().length} post(s) from {viewportApproximates.length}
				approx hash cell(s) in this view. Green pin = exact hash location.
			</p>
		{/if}
		<p class="coords">📍 {data.lat}, {data.lon}</p>
	{:else}
		<p class="error">{data.error}</p>
		<p class="muted">Try: /map/mkw9x/mkw9x3zzk</p>
	{/if}
</main>

{#if selectedPost}
	<div
		class="modal-overlay"
		role="dialog"
		aria-modal="true"
		aria-label="Post details"
		tabindex="-1"
	>
		<button
			type="button"
			class="modal-backdrop"
			aria-label="Close post details"
			onclick={() => (selectedPost = null)}
		></button>
		<div class="modal-panel">
			<div class="modal-head">
				<h2>Post</h2>
				<button
					type="button"
					class="close-btn"
					onclick={() => (selectedPost = null)}
				>
					Close
				</button>
			</div>
			<PostCard post={selectedPost} />
		</div>
	</div>
{/if}

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

	.search-row {
		display: flex;
		gap: 0.55rem;
		margin: 0 0 0.7rem;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		padding: 0.62rem 0.72rem;
		border: 1px solid #bdad9e;
		border-radius: 10px;
		background: #fffdf9;
		font: inherit;
	}

	.search-input:focus {
		outline: 2px solid rgba(59, 110, 79, 0.25);
		outline-offset: 1px;
		border-color: #3b6e4f;
	}

	.search-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.6rem 0.95rem;
		border: 1px solid #305741;
		border-radius: 10px;
		background: #3b6e4f;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.search-btn:disabled {
		opacity: 0.75;
		cursor: wait;
	}

	.map-view {
		width: 100%;
		height: 68vh;
		min-height: 360px;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		background: #f0e7da;
		display: block;
		overflow: hidden;
	}

	:global(.leaflet-container) {
		width: 100%;
		height: 100%;
	}

	:global(.post-marker) {
		background: transparent;
		border: none;
	}

	:global(.post-marker span) {
		display: block;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #b04030;
		border: 2px solid #fff;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.32);
	}

	:global(.pin-preview) {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 190px;
		max-width: 240px;
	}

	:global(.pin-preview-thumb) {
		width: 100%;
		height: 92px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid #d7c8b6;
	}

	:global(.pin-preview-text) {
		font-size: 0.82rem;
		line-height: 1.35;
		color: #2d2d2d;
		max-height: 132px;
		overflow: auto;
	}

	:global(.pin-preview-open) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem 0.7rem;
		border: 1px solid #305741;
		background: #3b6e4f;
		color: #fff;
		border-radius: 999px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}

	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: 1rem;
		overflow-y: auto;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		border: none;
		background: rgba(0, 0, 0, 0.55);
		padding: 0;
		margin: 0;
		cursor: pointer;
	}

	.modal-panel {
		position: relative;
		z-index: 1;
		width: min(760px, 100%);
		margin-top: 1rem;
		background: rgba(255, 250, 241, 0.98);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 0.85rem;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.55rem;
	}

	.modal-head h2 {
		margin: 0;
		font-size: 1rem;
	}

	.close-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.4rem 0.8rem;
		background: #fff;
		border: 1px solid #bdad9e;
		border-radius: 8px;
		font: inherit;
		cursor: pointer;
	}

	@media (max-width: 640px) {
		.search-row {
			flex-direction: column;
		}

		.search-btn {
			width: 100%;
		}
	}
</style>
