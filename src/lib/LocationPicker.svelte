<script>
	import {onMount} from "svelte"
	import "leaflet/dist/leaflet.css"

	let {location = null, onChange = () => {}, height = 300} = $props()

	let container = $state(null)
	let shell = $state(null)
	let map = null
	let leaflet = null
	let marker = null
	let pinIcon = null
	let mapHeight = $state(300)
	let hasCustomSize = $state(false)
	let resizeCleanup = null

	function currentCoords() {
		if (location?.lat != null && location?.lon != null) {
			return [Number(location.lat), Number(location.lon)]
		}

		return [-20.3, 57.5]
	}

	function emitLocation(lat, lon) {
		onChange({lat, lon})
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
		if (hasCustomSize) return
		mapHeight = height
		syncMapSize()
	})

	onMount(() => {
		let cancelled = false

		;(async () => {
			leaflet = await import("leaflet")
			if (cancelled) return

			const [lat, lon] = currentCoords()
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

			map.on("click", (event) => {
				const {lat: nextLat, lng: nextLon} = event.latlng
				placeMarker(nextLat, nextLon, false)
				emitLocation(nextLat, nextLon)
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

<div class="map-shell">
	<div bind:this={shell} class="map-frame" style={`height: ${mapHeight}px;`}>
		<div bind:this={container} class="map"></div>
		<button
			type="button"
			class="resize-handle"
			onmousedown={startResize}
			ontouchstart={startResize}
			aria-label="Resize map"
		></button>
	</div>
	<p class="map-help">
		Click to place the pin or drag it to refine the location.
	</p>
</div>

<style>
	.map-shell {
		margin-top: 0.5rem;
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
</style>
