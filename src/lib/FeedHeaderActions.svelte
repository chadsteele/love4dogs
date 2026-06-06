<script>
	import { RefreshCw, Map as MapIcon, LayoutGrid } from "lucide-svelte"

	let {
		currentView = "search",
		searchTerm = "",
		onRefresh = () => {},
		refreshDisabled = false,
		mapCenter = null
	} = $props()

	let resolvedLocationText = $state("")

	// Svelte 5 reactive effect to reverse geocode when mapCenter changes
	$effect(() => {
		if (currentView === "map" && mapCenter && typeof mapCenter.lat === "number" && typeof mapCenter.lon === "number") {
			const timer = setTimeout(async () => {
				try {
					const res = await fetch("/api/geocode", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							reverse: true,
							lat: mapCenter.lat,
							lon: mapCenter.lon
						})
					})
					if (res.ok) {
						const data = await res.json()
						if (data && data.ok) {
							const state = data.state || ""
							const country = data.country || ""
							resolvedLocationText = [state, country].filter(Boolean).join(" ")
						}
					}
				} catch (err) {
					console.error("Failed to reverse geocode map center in FeedHeaderActions:", err)
				}
			}, 600)

			return () => clearTimeout(timer)
		}
	})

	const searchHref = $derived.by(() => {
		let term = searchTerm || ""
		if (term.toLowerCase().includes("near me") && resolvedLocationText) {
			term = term.replace(/near\s+me/gi, "near " + resolvedLocationText)
		}
		const normalized = term
			.replace(/,/g, " ")
			.trim()
			.replace(/\s+/g, " ")
		const segments = normalized
			? normalized
					.split(" ")
					.map((s) => encodeURIComponent(s))
					.join("/")
			: ""
		return segments ? `/search/${segments}` : "/search"
	})

	const mapHref = $derived.by(() => {
		const normalized = searchTerm
			.replace(/,/g, " ")
			.trim()
			.replace(/\s+/g, " ")
		const segments = normalized
			? normalized
					.split(" ")
					.map((s) => encodeURIComponent(s))
					.join("/")
			: ""
		return segments ? `/map/${segments}` : "/map"
	})
</script>

<div class="feed-header-actions">
	<button
		type="button"
		class="action-btn refresh-btn"
		onclick={onRefresh}
		disabled={refreshDisabled}
		aria-label="Refresh search results"
		title="Refresh"
	>
		<RefreshCw size={16} />
	</button>

	<a
		href={mapHref}
		class="action-btn map-btn"
		class:active={currentView === "map"}
		aria-label="Switch to Map view"
		title="Map View"
	>
		<MapIcon size={16} />
	</a>

	<a
		href={searchHref}
		class="action-btn grid-btn"
		class:active={currentView === "search"}
		aria-label="Switch to Grid view"
		title="Grid View"
	>
		<LayoutGrid size={16} />
	</a>
</div>

<style>
	.feed-header-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(255, 255, 255, 0.4);
		backdrop-filter: blur(4px);
		padding: 0.25rem;
		border-radius: 999px;
		border: 1px solid rgba(58, 91, 65, 0.12);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 1px solid rgba(59, 110, 79, 0.25);
		background: rgba(255, 250, 241, 0.9);
		color: #305741;
		cursor: pointer;
		text-decoration: none;
		box-sizing: border-box;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.action-btn:hover:not(:disabled) {
		background: rgba(59, 110, 79, 0.15);
		border-color: #305741;
		transform: scale(1.05);
	}

	.action-btn:active:not(:disabled) {
		transform: scale(0.95);
	}

	.action-btn.active {
		background: #3b6e4f;
		color: #ffffff;
		border-color: #305741;
		box-shadow: 0 2px 8px rgba(59, 110, 79, 0.3);
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* Subtle micro-animation for refresh icon rotation on hover */
	.refresh-btn:hover:not(:disabled) :global(svg) {
		transform: rotate(30deg);
		transition: transform 0.2s ease;
	}
</style>
