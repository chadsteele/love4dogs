<script>
	import {onMount} from "svelte"
	import "leaflet/dist/leaflet.css"

	let {
		location = null,
		onChange = () => {},
		height = 300,
		searchTerms = "",
		onPinMoved = () => {},
		showConfirmToggle = true,
		autoSearch = false,
	} = $props()

	let container = $state(null)
	let shell = $state(null)
	let map = null
	let leaflet = null
	let marker = null
	let pinIcon = null
	let mapHeight = $state(300)
	let hasCustomSize = $state(false)
	let hideLocation = $state(false)
	let searchText = $state("")
	let searchLoading = $state(false)
	let searchError = $state("")
	let resizeCleanup = null

	async function handleConfirmLocation() {
		if (!hideLocation) {
			const lat = location?.lat != null ? Number(location.lat) : null
			const lon = location?.lon != null ? Number(location.lon) : null
			if (lat == null || lon == null) return

			searchLoading = true
			searchError = ""
			try {
				const response = await fetch("/api/geocode", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ lat, lon, reverse: true })
				})
				const data = await response.json().catch(() => ({}))
				if (!response.ok || data.error?.includes("water") || data.error?.includes("ocean")) {
					searchError = data.error || "Location cannot be in the ocean or water."
					return
				}
				hideLocation = true
			} catch (err) {
				searchError = "Could not verify location. Please try again."
			} finally {
				searchLoading = false
			}
		} else {
			hideLocation = false
			searchError = ""
		}
	}

	function currentCoords() {
		if (location?.lat != null && location?.lon != null) {
			return [Number(location.lat), Number(location.lon)]
		}

		return [-20.3, 57.5]
	}

	function emitLocation(lat, lon, details = {}) {
		onChange({
			lat,
			lon,
			city: details.city || "",
			country: details.country || "",
			zip: details.zip || "",
		})
	}

	function extractCoordinatesFromText(text) {
		const match = text.match(/([-+]?\d+\.?\d*)\s*,\s*([-+]?\d+\.?\d*)/)
		if (!match) return null

		const lat = Number(match[1])
		const lon = Number(match[2])
		if (Number.isNaN(lat) || Number.isNaN(lon)) return null
		if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null

		return {lat, lon}
	}

	function extractSearchQueryFromUrl(text) {
		const urlMatch = text.match(/https?:\/\/\S+/)
		if (!urlMatch) return ""

		try {
			const url = new URL(urlMatch[0])
			return (
				url.searchParams.get("q") ||
				url.searchParams.get("query") ||
				""
			).trim()
		} catch {
			return ""
		}
	}

	function normalizeAddressQuery(text) {
		return text
			.replace(/https?:\/\/\S+/g, " ")
			.replace(/\n+/g, " ")
			.replace(/\s+/g, " ")
			.trim()
	}

	async function getDeviceCoords() {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			return null
		}

		try {
			const position = await new Promise((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: true,
					timeout: 8000,
				})
			})
			return {
				lat: Number(position.coords.latitude),
				lon: Number(position.coords.longitude),
			}
		} catch {
			return null
		}
	}

	async function runSearch(rawInput = searchText) {
		const input = rawInput.trim()
		searchError = ""
		searchLoading = true

		try {
			if (!input || input.toLowerCase() === "near me" || input.toLowerCase() === "my location") {
				const deviceCoords = await getDeviceCoords()
				if (!deviceCoords) {
					searchError =
						"Unable to get device location. Enter a location to map."
					return
				}
				emitLocation(deviceCoords.lat, deviceCoords.lon)
				if (map) placeMarker(deviceCoords.lat, deviceCoords.lon, true)
				return
			}

			const coordinates = extractCoordinatesFromText(input)
			if (coordinates) {
				emitLocation(coordinates.lat, coordinates.lon)
				if (map) placeMarker(coordinates.lat, coordinates.lon, true)
				return
			}

			const queryFromUrl = extractSearchQueryFromUrl(input)
			const addressQuery = queryFromUrl || normalizeAddressQuery(input)
			if (!addressQuery || addressQuery.length < 3) {
				searchError =
					"Enter a more specific address to map this location."
				return
			}

			const response = await fetch("/api/geocode", {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({query: addressQuery}),
			})

			let payload = null
			try {
				payload = await response.json()
			} catch {
				payload = null
			}

			if (payload?.ok === false) {
				searchError = payload?.error || "Could not map that location."
				return
			}

			if (!response.ok) {
				searchError = payload?.error || "Could not map that location."
				return
			}

			if (
				typeof payload?.lat !== "number" ||
				typeof payload?.lon !== "number"
			) {
				searchError = "Geocoding returned invalid coordinates."
				return
			}

			emitLocation(payload.lat, payload.lon, {
				city: payload.city || "",
				country: payload.country || "",
				zip: payload.zip || "",
			})
			if (map) placeMarker(payload.lat, payload.lon, true)
		} catch {
			searchError = "Could not map that location."
		} finally {
			searchLoading = false
		}
	}

	async function runNearMe() {
		searchText = "Near me"
		await runSearch("Near me")
	}

	function syncMapSize() {
		setTimeout(() => {
			map?.invalidateSize()
		}, 0)
	}

	function eventClientY(event) {
		if (event.touches?.length) return event.touches[0].clientY
		if (event.changedTouches?.length) return event.changedTouches[0].clientY
		return event.clientY
	}

	function stopResize(onMouseMove, onMouseUp, onTouchMove, onTouchEnd) {
		window.removeEventListener("mousemove", onMouseMove)
		window.removeEventListener("mouseup", onMouseUp)
		window.removeEventListener("touchmove", onTouchMove)
		window.removeEventListener("touchend", onTouchEnd)
		window.removeEventListener("touchcancel", onTouchEnd)
		resizeCleanup = null
		syncMapSize()
	}

	function startResize(event) {
		event.preventDefault()
		hasCustomSize = true
		const startY = eventClientY(event)
		const startHeight = mapHeight

		const onMove = (moveEvent) => {
			const nextHeight = Math.max(
				220,
				startHeight + (eventClientY(moveEvent) - startY),
			)
			mapHeight = nextHeight
			moveEvent.preventDefault?.()
			syncMapSize()
		}

		const onMouseMove = (moveEvent) => onMove(moveEvent)
		const onTouchMove = (moveEvent) => onMove(moveEvent)
		const onMouseUp = () =>
			stopResize(onMouseMove, onMouseUp, onTouchMove, onTouchEnd)
		const onTouchEnd = () =>
			stopResize(onMouseMove, onMouseUp, onTouchMove, onTouchEnd)

		resizeCleanup?.()
		window.addEventListener("mousemove", onMouseMove)
		window.addEventListener("mouseup", onMouseUp)
		window.addEventListener("touchmove", onTouchMove, {passive: false})
		window.addEventListener("touchend", onTouchEnd)
		window.addEventListener("touchcancel", onTouchEnd)
		resizeCleanup = () => {
			stopResize(onMouseMove, onMouseUp, onTouchMove, onTouchEnd)
		}
	}

	function getPinIcon() {
		if (!leaflet) return null
		if (pinIcon) return pinIcon

		pinIcon = leaflet.divIcon({
			className: "map-pin-icon",
			html: '<span class="map-pin-core"></span>',
			iconSize: [28, 40],
			iconAnchor: [14, 40],
		})

		return pinIcon
	}

	function placeMarker(lat, lon, shouldPan = true) {
		if (!leaflet || !map) return

		if (!marker) {
			marker = leaflet
				.marker([lat, lon], {
					draggable: true,
					icon: getPinIcon(),
				})
				.addTo(map)
			marker.on("dragend", () => {
				const pos = marker.getLatLng()
				emitLocation(pos.lat, pos.lng)
				onPinMoved()
			})
		} else {
			marker.setLatLng([lat, lon])
		}

		if (shouldPan) {
			map.setView([lat, lon], Math.max(map.getZoom(), 15))
		}
	}

	$effect(() => {
		if (!map || location?.lat == null || location?.lon == null) return
		placeMarker(Number(location.lat), Number(location.lon), false)
	})

	$effect(() => {
		searchText = searchTerms
	})

	$effect(() => {
		if (hasCustomSize) return
		mapHeight = height
		syncMapSize()
	})

	onMount(() => {
		let cancelled = false

		;(async () => {
			leaflet = await import("leaflet")
			if (cancelled) return

			let [lat, lon] = currentCoords()
			if (location?.lat == null || location?.lon == null) {
				const incomingSearch = (searchTerms || "").trim()
				if (!incomingSearch) {
					const deviceCoords = await getDeviceCoords()
					if (deviceCoords) {
						lat = deviceCoords.lat
						lon = deviceCoords.lon
					}
				}
			}
			map = leaflet.map(container).setView([lat, lon], 15)

			const streetLayer = leaflet.tileLayer(
				"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
				{
					attribution: "&copy; OpenStreetMap contributors",
				},
			)

			const satelliteLayer = leaflet.tileLayer(
				"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
				{
					attribution:
						"Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
				},
			)

			const topoLayer = leaflet.tileLayer(
				"https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
				{
					attribution:
						"Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)",
					maxZoom: 17,
				},
			)

			const terrainLayer = leaflet.tileLayer(
				"https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg",
				{
					attribution:
						"Map tiles by Stamen Design, CC BY 3.0 — Map data &copy; OpenStreetMap contributors",
					maxZoom: 18,
				},
			)

			const lightLayer = leaflet.tileLayer(
				"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
				{
					attribution:
						"&copy; OpenStreetMap contributors &copy; CARTO",
					subdomains: "abcd",
					maxZoom: 20,
				},
			)

			streetLayer.addTo(map)

			leaflet.control
				.layers(
					{
						"Street (OSM)": streetLayer,
						"Satellite (Esri)": satelliteLayer,
						Topo: topoLayer,
						Terrain: terrainLayer,
						Light: lightLayer,
					},
					null,
					{position: "topright", collapsed: true},
				)
				.addTo(map)

			placeMarker(lat, lon, false)
			if (location?.lat == null || location?.lon == null) {
				emitLocation(lat, lon)
			}

			if (autoSearch && searchTerms.trim()) {
				await runSearch(searchTerms)
			}

			map.on("click", (event) => {
				const {lat: nextLat, lng: nextLon} = event.latlng
				placeMarker(nextLat, nextLon, false)
				emitLocation(nextLat, nextLon)
				onPinMoved()
			})
		})()

		return () => {
			cancelled = true
			resizeCleanup?.()
			resizeCleanup = null
			map?.remove()
			map = null
			marker = null
		}
	})
</script>

<div class="location-panel">
	{#if showConfirmToggle}
		<label class="hide-location-label">
			<button
				type="button"
				class="location-check-btn"
				class:is-active={hideLocation}
				onclick={handleConfirmLocation}
				aria-label={hideLocation ? "Show map" : "Hide map"}
				><span class="location-check-dot"
					>{hideLocation ? "✓" : ""}</span
				></button
			>
			<h2>{hideLocation ? "Location Confirmed" : "Confirm Location"}</h2>
		</label>
	{/if}
	{#if !hideLocation || !showConfirmToggle}
		<div>Please ensure the location is accurate before sharing!</div>
		<div class="location-search-row">
			<input
				class="location-search-input"
				type="text"
				bind:value={searchText}
				placeholder="Search by address, lat,lng, or map URL"
				onkeydown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault()
						runSearch(searchText)
					}
				}}
			/>
			<button
				type="button"
				class="location-search-btn"
				disabled={searchLoading}
				onclick={() => runSearch(searchText)}
			>
				Map
			</button>
		</div>
		{#if searchError}
			<div class="map-search-error-container">
				<p class="map-search-error">{searchError}</p>
				<button type="button" class="near-me-btn" onclick={runNearMe} disabled={searchLoading}>
					Use Current Location (Near Me)
				</button>
			</div>
		{/if}
		<div
			bind:this={shell}
			class="map-frame"
			style={`height: ${mapHeight}px;`}
		>
			<div bind:this={container} class="map"></div>
			<button
				type="button"
				class="resize-handle"
				onmousedown={startResize}
				ontouchstart={startResize}
				aria-label="Resize map"
			></button>
		</div>
		{#if location}
			<p class="location-coords">
				{Number(location.lat).toFixed(5)}, {Number(
					location.lon,
				).toFixed(5)}
				{#if location.city || location.country}
					· {location.city || "Unknown city"}, {location.country ||
						"Unknown country"}
				{/if}
			</p>
		{/if}
	{/if}
	{#if showConfirmToggle}
		<p class="map-help">
			Click to place the pin or drag it to refine the location.
		</p>
	{/if}
</div>

<style>
	.location-panel {
		margin-top: 1rem;
	}
	.hide-location-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		margin-bottom: 0.5rem;
	}
	.hide-location-label h2 {
		margin: 0;
		font-size: 1rem;
	}
	.location-check-btn {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid rgba(60, 60, 60, 0.35);
		background: rgba(255, 255, 255, 0.92);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		flex-shrink: 0;
	}
	.location-check-btn.is-active {
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}
	.location-check-dot {
		font-size: 0.85rem;
		line-height: 1;
		font-weight: 700;
	}
	.location-search-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.6rem;
		margin-bottom: 0.55rem;
	}
	.location-search-input {
		flex: 1;
		min-width: 0;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		padding: 0.65rem 0.75rem;
		font: inherit;
		background: #fffdf8;
		box-sizing: border-box;
	}
	.location-search-btn {
		flex-shrink: 0;
		border: 1px solid #305741;
		border-radius: 999px;
		padding: 0.65rem 1rem;
		font: inherit;
		font-weight: 600;
		background: #3b6e4f;
		color: #fff;
		cursor: pointer;
	}
	.location-search-btn:hover {
		background: #305741;
	}
	.location-search-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.map-search-error {
		margin: 0 0 0.45rem;
		color: #8e2f21;
		font-size: 0.9rem;
	}
	.location-coords {
		margin: 0.55rem 0 0;
		font-size: 0.9rem;
		color: #506157;
	}
	.map-frame {
		position: relative;
		width: 100%;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		overflow: hidden;
		background: #f0e7da;
	}

	.map {
		width: 100%;
		height: 100%;
	}

	.resize-handle {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 24px;
		height: 24px;
		border: 0;
		padding: 0;
		background: linear-gradient(
			135deg,
			transparent 0 40%,
			rgba(59, 110, 79, 0.45) 40% 52%,
			transparent 52% 62%,
			rgba(59, 110, 79, 0.75) 62% 74%,
			transparent 74% 84%,
			rgba(59, 110, 79, 0.95) 84% 100%
		);
		cursor: nwse-resize;
		touch-action: none;
		z-index: 1000;
	}

	.map-help {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
		color: #5f665f;
	}

	:global(.leaflet-container) {
		font: inherit;
	}

	:global(.leaflet-control-attribution) {
		margin: 0 30px 4px 0;
		max-width: calc(100% - 42px);
		font-size: 0.68rem;
	}

	:global(.map-pin-icon) {
		background: transparent;
		border: 0;
	}

	:global(.map-pin-core) {
		position: relative;
		display: block;
		width: 28px;
		height: 28px;
		border-radius: 50% 50% 50% 0;
		background: #c7522a;
		border: 2px solid #fff4ea;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
		transform: rotate(-45deg);
	}

	:global(.map-pin-core::after) {
		content: "";
		position: absolute;
		inset: 7px;
		border-radius: 50%;
		background: #fff4ea;
	}

	.map-search-error-container {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0 0 0.45rem;
		flex-wrap: wrap;
	}

	.near-me-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0.75rem;
		background: #3b6e4f;
		color: #fff;
		border: 1px solid #305741;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.near-me-btn:hover {
		background: #305741;
	}

	.near-me-btn:disabled {
		opacity: 0.7;
		cursor: wait;
	}
</style>
