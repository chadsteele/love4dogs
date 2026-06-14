<script>
	import { onMount } from "svelte"
	import "leaflet/dist/leaflet.css"
	import {
		getApproxPostsFromCache,
		gpsToHash,
		setApproxPostsInCache,
		getApproxCacheEntry,
        isLocalHost,
	} from "$lib/utils"
	import { getSetting, setSetting, setPost } from "$lib/db.js"
	import { listStoredProfiles } from "$lib/profileRegistry"
	import { readSearchTerm, writeSearchTerm } from "$lib/searchStore.js"

	let { searchTerm = "", refreshTrigger = 0, mapCenter = $bindable(null) } = $props()

	let mapEl = $state(null)
	let mapPosts = $state([])
	let loadingPins = $state(false)
	let mapError = $state("")
	let viewportApproximates = $state([])
	let hashLoadTotal = $state(0)
	let hashLoadDone = $state(0)
	let localProfileUuids = $state([])
	let findingNearMe = $state(false)
	let blockedUuids = $state([])
	let blockedAuthors = $state([])

	let leaflet = null
	let mapInstance = $state(null)
	let markerLayer = null
	let lastLoadedViewportKey = ""
	let requestedViewportKey = ""
	let mapLoadRequestId = 0
	let viewportRefreshTimer = null
	const approxPostsCache = new Map()
	// Maps approximate hash → timestamp when it can be retried (error TTL)
	const approxErrorCache = new Map()
	const APPROX_ERROR_TTL_MS = 90_000

	const MIN_GRID_SAMPLES = 5
	const TARGET_HASH_STEP_DEGREES = 0.05
	const FETCH_CONCURRENCY = 3
	const SLOW_WHILE_MOVING_REQUEST_SPACING_MS = 700
	const BASE_REQUEST_SPACING_MS = 140
	const THROTTLED_REQUEST_SPACING_MS = 700
	const THROTTLE_BACKOFF_MS = 60_000
	const API_DOWN_BACKOFF_MS = 15_000
	const VIEWPORT_REFRESH_DEBOUNCE_MS = 260
	const MAP_IDLE_BEFORE_SPEEDUP_MS = 1_000
	const MIN_ZOOM = 10
	let nextApproxRequestAt = 0
	let throttleBackoffUntil = 0
	let lastMapActivityAt = 0
	let apiUnavailableUntil = 0
	let apiHealthProbeRequired = false
	let refreshInFlight = false
	let refreshQueued = false
	let requestedViewportApproximates = []

	let activeKeywordFilter = $state("")
	let pauseBackgroundSearch = $state(false)
	let lastProcessedSearchTerm = ""

	function parseSearchTerm(term) {
		const norm = String(term || "").trim()
		if (!norm) return { isNearMe: false, locationQuery: "", keyword: "" }

		// Check for "near me" as a whole phrase
		const hasNearMe = /\bnear\s+me\b/i.test(norm)
		if (hasNearMe) {
			const keyword = norm.replace(/\bnear\s+me\b/gi, "").replace(/\s+/g, " ").trim()
			return {
				isNearMe: true,
				locationQuery: "me",
				keyword
			}
		}

		// Check for "near" keyword
		const nearMatch = norm.match(/\b(near)\b/i)
		if (nearMatch) {
			const index = norm.toLowerCase().lastIndexOf("near")
			const before = norm.slice(0, index).trim()
			const after = norm.slice(index + 4).trim()
			if (after.toLowerCase() === "me") {
				return {
					isNearMe: true,
					locationQuery: "me",
					keyword: before
				}
			}
			return {
				isNearMe: false,
				locationQuery: after,
				keyword: before
			}
		}

		// No "near" or "near me"
		return {
			isNearMe: false,
			locationQuery: norm,
			keyword: ""
		}
	}

	async function resolveSearchLocation(term) {
		const parsed = parseSearchTerm(term)
		
		if (parsed.isNearMe) {
			return { type: "near-me", keyword: parsed.keyword }
		}

		if (!parsed.locationQuery) {
			return { type: "none", keyword: "" }
		}

		try {
			const res = await fetch("/api/geocode", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: parsed.locationQuery })
			})
			if (res.ok) {
				const data = await res.json()
				if (data && data.ok && typeof data.lat === "number" && typeof data.lon === "number") {
					const hasNear = String(term).toLowerCase().includes("near")
					const isProminent = 
						hasNear || 
						data.class === "boundary" || 
						data.class === "place" || 
						data.class === "highway" || 
						data.class === "railway" || 
						data.class === "postcode" ||
						(data.importance && data.importance > 0.35)

					if (isProminent) {
						return {
							type: "coordinates",
							lat: data.lat,
							lon: data.lon,
							keyword: parsed.keyword
						}
					}
				}
			}
		} catch (err) {
			console.error("Geocoding failed inside resolveSearchLocation:", err)
		}

		return { type: "keyword-only", keyword: term }
	}

	async function processSearch(current) {
		pauseBackgroundSearch = true
		mapLoadRequestId += 1
		
		const resolved = await resolveSearchLocation(current)
		
		if (resolved.type === "coordinates") {
			const zoom = 13
			await setSetting('love4dogs.map-search-location', {
				lat: resolved.lat,
				lon: resolved.lon,
				approximate: gpsToHash(resolved.lat, resolved.lon).approx,
				exact: gpsToHash(resolved.lat, resolved.lon).exact,
				zoom
			})
			if (mapInstance) {
				mapInstance.setView([resolved.lat, resolved.lon], zoom, { animate: true })
				lastLoadedViewportKey = ""
				requestedViewportKey = ""
				scheduleViewportRefresh()
			}
			activeKeywordFilter = resolved.keyword
		} else if (resolved.type === "near-me") {
			activeKeywordFilter = resolved.keyword
			if (mapInstance) {
				await searchNearMe()
			}
		} else {
			activeKeywordFilter = resolved.keyword
		}
		
		pauseBackgroundSearch = false
		
		if (resolved.type !== "coordinates" && resolved.type !== "near-me") {
			refreshViewportPosts()
		}
	}

	// Keep track of search term updates
	$effect(() => {
		const current = searchTerm
		if (current !== lastProcessedSearchTerm) {
			lastProcessedSearchTerm = current
			writeSearchTerm(current).catch(() => {})
			processSearch(current)
		}
	})

	$effect(() => {
		const trigger = refreshTrigger
		if (trigger > 0) {
			approxPostsCache.clear()
			approxErrorCache.clear()
			setSetting('love4dogs.map-approx-posts-cache.v2', {}).then(() => {
				lastLoadedViewportKey = ""
				requestedViewportKey = ""
				refreshViewportPosts()
			}).catch((err) => {
				console.error("Failed to clear DB cache:", err)
				lastLoadedViewportKey = ""
				requestedViewportKey = ""
				refreshViewportPosts()
			})
		}
	})

	$effect(() => {
		// Track all dependencies for rendering markers reactively
		const _posts = mapPosts
		const _term = activeKeywordFilter
		const _profileUuids = localProfileUuids
		const _blockedUuids = blockedUuids
		const _blockedAuthors = blockedAuthors
		renderMarkers()
	})

	async function searchNearMe() {
		findingNearMe = true
		if (!navigator.geolocation) {
			mapError = "Geolocation is not supported by your browser."
			findingNearMe = false
			return
		}
		return new Promise((resolve) => {
			navigator.geolocation.getCurrentPosition(
				async (position) => {
					const lat = position.coords.latitude
					const lon = position.coords.longitude
					const hash = gpsToHash(lat, lon)
					if (!hash?.approx || !hash?.exact) {
						mapError = "Could not compute a map hash for your location."
						findingNearMe = false
						resolve()
						return
					}
					
					const zoom = mapInstance ? mapInstance.getZoom() : 13
					await setSetting('love4dogs.map-search-location', {
						lat,
						lon,
						approximate: hash.approx,
						exact: hash.exact,
						zoom
					})

					if (mapInstance) {
						mapInstance.setView([lat, lon], zoom, {animate: true})
						lastLoadedViewportKey = ""
						requestedViewportKey = ""
						scheduleViewportRefresh()
					}
					findingNearMe = false
					resolve()
				},
				(err) => {
					mapError = err.message || "Unable to get your location."
					findingNearMe = false
					resolve()
				},
				{enableHighAccuracy: true, timeout: 10000}
			)
		})
	}

	function clamp(value, min, max) {
		return Math.max(min, Math.min(max, value))
	}

	function sleep(ms = 0) {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	function isThrottleBackoffActive() {
		return Date.now() < throttleBackoffUntil
	}

	function markThrottleBackoffNow() {
		throttleBackoffUntil = Date.now() + THROTTLE_BACKOFF_MS
	}

	function markMapActivity() {
		lastMapActivityAt = Date.now()
	}

	function isMapIdleLongEnough() {
		return Date.now() - lastMapActivityAt >= MAP_IDLE_BEFORE_SPEEDUP_MS
	}

	function currentRequestSpacingMs() {
		if (!isMapIdleLongEnough()) {
			return SLOW_WHILE_MOVING_REQUEST_SPACING_MS
		}
		return isThrottleBackoffActive()
			? THROTTLED_REQUEST_SPACING_MS
			: BASE_REQUEST_SPACING_MS
	}

	function currentFetchConcurrency() {
		return isThrottleBackoffActive() ? 1 : FETCH_CONCURRENCY
	}

	function isApiUnavailable() {
		return Date.now() < apiUnavailableUntil
	}

	function markApiUnavailableNow() {
		apiUnavailableUntil = Date.now() + API_DOWN_BACKOFF_MS
		apiHealthProbeRequired = true
	}

	function markApiHealthyNow() {
		apiUnavailableUntil = 0
		apiHealthProbeRequired = false
	}

	async function waitForApproxRequestSlot() {
		const now = Date.now()
		const slotAt = Math.max(now, nextApproxRequestAt)
		nextApproxRequestAt = slotAt + currentRequestSpacingMs()
		const waitMs = slotAt - now
		if (waitMs > 0) {
			await sleep(waitMs)
		}
	}

	function isRequestStale(requestId) {
		return requestId !== mapLoadRequestId
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
		return Math.max(Math.max(spanDriven, zoomDriven), MIN_GRID_SAMPLES)
	}

	function slugify(value = "") {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
	}

	// alt-payload parsing utilities
	function extractTagsFromAltPayload(alt = "") {
		const source = String(alt || "").trim()
		if (!source) return []

		try {
			const parsed = JSON.parse(source)
			const candidates = [
				parsed,
				parsed?.primary,
				parsed?.combined?.primary,
			]

			if (typeof parsed?.h === "string" && parsed.h.trim()) {
				try {
					const inner = JSON.parse(parsed.h)
					candidates.push(
						inner,
						inner?.primary,
						inner?.combined?.primary,
					)
				} catch {
					// Ignore malformed nested payloads.
				}
			}

			for (const candidate of candidates) {
				if (!candidate || typeof candidate !== "object") continue
				const rawTags = Array.isArray(candidate?.tags)
					? candidate.tags
					: []
				if (rawTags.length) {
					return rawTags
						.map((tag) =>
							String(tag || "")
								.trim()
								.toLowerCase(),
						)
						.filter(Boolean)
				}
			}
		} catch {
			return []
		}

		return []
	}

	function isProfilePost(post = {}) {
		let tags = Array.isArray(post?.tags) ? post.tags : []

		if (!tags.length) {
			for (const alt of post?.imageAlts || []) {
				const altTags = extractTagsFromAltPayload(alt)
				if (altTags.length) {
					tags = altTags
					break
				}
			}
		}

		if (!tags.length) {
			tags = extractTagsFromAltPayload(post?.video?.alt || "")
		}

		return tags.some((tag) => String(tag || "").toLowerCase() === "profile")
	}

	function extractAtUriRkey(uri = "") {
		const source = String(uri || "").trim()
		if (!source) return ""
		const match = source.match(
			/^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([^/?#]+)$/i,
		)
		return String(match?.[1] || "").trim()
	}

	function extractUuidFromAltPayload(alt = "") {
		const source = String(alt || "").trim()
		if (!source) return ""

		try {
			const parsed = JSON.parse(source)
			const candidates = [
				parsed,
				parsed?.primary,
				parsed?.combined?.primary,
			]

			if (typeof parsed?.h === "string" && parsed.h.trim()) {
				try {
					const inner = JSON.parse(parsed.h)
					candidates.push(
						inner,
						inner?.primary,
						inner?.combined?.primary,
					)
				} catch {
					// Ignore malformed nested payloads.
				}
			}

			for (const candidate of candidates) {
				if (!candidate || typeof candidate !== "object") continue
				const directUuid = String(
					candidate?.u || candidate?.uuid || candidate?.id || "",
				).trim()
				if (directUuid) return directUuid
			}
		} catch {
			return ""
		}

		return ""
	}

	function buildPostViewPath(post = {}) {
		const pathType = isProfilePost(post) ? "profile" : "post"
		let uuid = ""
		const bskyPostRkey = extractAtUriRkey(post?.uri || "")
		const directUuid = String(post?.uuid || "").trim()
		if (directUuid && (!bskyPostRkey || directUuid !== bskyPostRkey)) {
			const directSlug =
				slugify(String(post?.text || "").split("\n")[0]) || directUuid
			return `/${pathType}/view/${encodeURIComponent(directUuid)}/${encodeURIComponent(directSlug)}`
		}

		for (const alt of post?.imageAlts || []) {
			uuid = extractUuidFromAltPayload(alt)
			if (uuid) break
		}

		if (!uuid) {
			uuid = extractUuidFromAltPayload(post?.video?.alt || "")
		}

		if (!uuid || (bskyPostRkey && uuid === bskyPostRkey)) return ""
		const slug = slugify(String(post?.text || "").split("\n")[0]) || uuid
		return `/${pathType}/view/${encodeURIComponent(uuid)}/${encodeURIComponent(slug)}`
	}

	function extractAuthorIdFromAltPayload(alt = "") {
		const source = String(alt || "").trim()
		if (!source) return ""

		try {
			const parsed = JSON.parse(source)
			const candidates = [
				parsed,
				parsed?.primary,
				parsed?.combined?.primary,
			]

			if (typeof parsed?.h === "string" && parsed.h.trim()) {
				try {
					const inner = JSON.parse(parsed.h)
					candidates.push(
						inner,
						inner?.primary,
						inner?.combined?.primary,
					)
				} catch {
					// Ignore malformed nested payloads.
				}
			}

			for (const candidate of candidates) {
				if (!candidate || typeof candidate !== "object") continue
				const authorId = String(
					candidate?.authorid || candidate?.authorId || "",
				).trim()
				if (authorId) return authorId
			}
		} catch {
			return ""
		}

		return ""
	}

	function resolvePostUuid(post = {}) {
		const directUuid = String(post?.uuid || "").trim()
		if (directUuid) return directUuid

		for (const alt of post?.imageAlts || []) {
			const fromAlt = extractUuidFromAltPayload(alt)
			if (fromAlt) return fromAlt
		}

		return extractUuidFromAltPayload(post?.video?.alt || "")
	}

	function resolvePostAuthorId(post = {}) {
		const directAuthorId = String(post?.authorid || post?.authorId || "").trim()
		if (directAuthorId) return directAuthorId

		for (const alt of post?.imageAlts || []) {
			const fromAlt = extractAuthorIdFromAltPayload(alt)
			if (fromAlt) return fromAlt
		}

		return extractAuthorIdFromAltPayload(post?.video?.alt || "")
	}

	async function resolvePostViewHrefFromApi(post = {}) {
		const uri = String(post?.uri || "").trim()
		if (!uri) return ""

		try {
			const response = await fetch(
				`/api/post?uri=${encodeURIComponent(uri)}`,
			)
			const json = await response.json().catch(() => ({}))
			if (!response.ok) return ""
			const hydratedPost = json?.post
			if (!hydratedPost) return ""
			return buildPostViewPath({
				...post,
				...hydratedPost,
			})
		} catch {
			return ""
		}
	}

	async function openPostInNewTab(post = {}) {
		let href = buildPostViewPath(post)
		if (!href) {
			href = await resolvePostViewHrefFromApi(post)
		}
		if (!href) {
			console.warn("[map] unable to build post view url", {
				uri: String(post?.uri || ""),
				uuid: String(post?.uuid || ""),
			})
			return
		}
		window.open(href, "_blank", "noopener,noreferrer")
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
			<button type="button" class="pin-preview-close" data-close-popup="1" aria-label="Close">&times;</button>
			<div class="pin-preview">
				${thumb}
				<div class="pin-preview-text">${formatted || "No text"}</div>
				<button type="button" class="pin-preview-open" data-open-post="${escapeAttr(post?.uri || "")}">Open</button>
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
		const approxOrderScore = new Map()
		const gridSamples = gridSamplesForViewport({south, north, west, east})
		const centerIndex = (gridSamples - 1) / 2

		for (let row = 0; row < gridSamples; row += 1) {
			const latRatio = gridSamples === 1 ? 0.5 : row / (gridSamples - 1)
			const lat = south + (north - south) * latRatio
			for (let col = 0; col < gridSamples; col += 1) {
				const lonRatio =
					gridSamples === 1 ? 0.5 : col / (gridSamples - 1)
				const lon = west + (east - west) * lonRatio
				const hash = gpsToHash(lat, lon)
				if (!hash?.approx) continue
				const approx = String(hash.approx).toLowerCase()
				const distanceFromCenter = Math.hypot(
					row - centerIndex,
					col - centerIndex,
				)
				const prevScore = approxOrderScore.get(approx)
				if (
					typeof prevScore !== "number" ||
					distanceFromCenter < prevScore
				) {
					approxOrderScore.set(approx, distanceFromCenter)
				}
			}
		}

		return [...approxOrderScore.entries()]
			.sort((left, right) => left[1] - right[1])
			.map(([approx]) => approx)
	}

	async function fetchApproximatesBatched(
		approximates = [],
		onSettled = () => {},
		requestId = mapLoadRequestId,
		onPostsFound = () => {},
	) {
		const results = []
		const workers = []
		let cursor = 0
		let stopAfterThrottle = false
		let stopAfterApiUnavailable = false
		const workerCount = Math.min(
			currentFetchConcurrency(),
			approximates.length,
		)

		const runWorker = async () => {
			while (cursor < approximates.length) {
				if (isRequestStale(requestId)) return
				const index = cursor
				cursor += 1
				if (index >= approximates.length) return
				const approximate = approximates[index]
				if (stopAfterApiUnavailable || isApiUnavailable()) {
					results[index] = {
						status: "fulfilled",
						value: {
							approximate,
							posts: [],
							throttled: true,
							skipped: true,
							apiUnavailable: true,
						},
					}
					onSettled(approximate)
					continue
				}
				if (stopAfterThrottle) {
					results[index] = {
						status: "fulfilled",
						value: {
							approximate,
							posts: [],
							throttled: true,
							skipped: true,
						},
					}
					onSettled(approximate)
					continue
				}
				try {
					await waitForApproxRequestSlot()
					if (isRequestStale(requestId)) return
					if (stopAfterApiUnavailable || isApiUnavailable()) {
						results[index] = {
							status: "fulfilled",
							value: {
								approximate,
								posts: [],
								throttled: true,
								skipped: true,
								apiUnavailable: true,
							},
						}
						onSettled(approximate)
						continue
					}
					const params = new URLSearchParams({approximate})
					const res = await fetch(
						`/api/map-posts?${params.toString()}`,
					)
					if (isRequestStale(requestId)) return
					markApiHealthyNow()
					const json = await res.json().catch(() => ({}))
					if (!res.ok) {
						if (json.throttled) {
							markThrottleBackoffNow()
							stopAfterThrottle = true
							results[index] = {
								status: "fulfilled",
								value: {
									approximate,
									posts: [],
									throttled: true,
								},
							}
						} else {
							throw new Error(
								json.error ||
									`Unable to load posts for ${approximate}.`,
							)
						}
						continue
					}
					if (json.throttled) {
						markThrottleBackoffNow()
						stopAfterThrottle = true
						results[index] = {
							status: "fulfilled",
							value: {approximate, posts: [], throttled: true},
						}
						continue
					}
					const posts = Array.isArray(json.posts) ? json.posts : []
					approxPostsCache.set(approximate, {
						posts,
						savedAt: Date.now(),
						hasLocalPost: posts.some(p => p.isUserPost)
					})
					approxErrorCache.delete(approximate)
					results[index] = {
						status: "fulfilled",
						value: {approximate, posts, throttled: false},
					}
					if (posts.length > 0) onPostsFound(approximate, posts)
				} catch (error) {
					const message = String(error?.message || "").toLowerCase()
					const isConnectionFailure =
						message.includes("failed to fetch") ||
						message.includes("network") ||
						message.includes("connection")
					if (isConnectionFailure) {
						markApiUnavailableNow()
						stopAfterApiUnavailable = true
					}
					approxErrorCache.set(
						approximate,
						Date.now() + APPROX_ERROR_TTL_MS,
					)
					results[index] = {status: "rejected", reason: error}
				} finally {
					onSettled(approximate)
				}
			}
		}

		for (let worker = 0; worker < workerCount; worker += 1) {
			workers.push(runWorker())
		}

		await Promise.all(workers)
		return results
	}

	async function loadMapPosts(approximates = []) {
		if (pauseBackgroundSearch) return
		const requestId = ++mapLoadRequestId
		loadingPins = true
		mapError = ""
		hashLoadTotal = 0
		hashLoadDone = 0
		try {
			if (isApiUnavailable()) {
				console.log("[map] api unavailable backoff active", {
					remainingMs: apiUnavailableUntil - Date.now(),
				})
				return
			}
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
				let entry = approxPostsCache.get(approximate)
				if (!entry) {
					entry = await getApproxCacheEntry(approximate)
					if (entry && Array.isArray(entry.posts)) {
						approxPostsCache.set(approximate, entry)
					}
				}

				if (entry && Array.isArray(entry.posts)) {
					for (const p of entry.posts) {
						if (!cachedPosts.some(cp => cp.uri === p.uri)) {
							cachedPosts.push(p)
						}
					}
				}

				if (approxErrorCache.has(approximate)) {
					const retryAt = approxErrorCache.get(approximate)
					if (Date.now() < retryAt) continue
					approxErrorCache.delete(approximate)
				}
				missingApproximates.push(approximate)
			}

			hashLoadTotal = cleanApproximates.length
			hashLoadDone = cleanApproximates.length - missingApproximates.length
			const fetchApproximates = apiHealthProbeRequired
				? missingApproximates.slice(0, 1)
				: missingApproximates

			const postsByUri = new Map()
			for (const post of cachedPosts) {
				if (!post?.uri) continue
				postsByUri.set(post.uri, post)
			}
			if (postsByUri.size > 0) mapPosts = [...postsByUri.values()]

			const responses = await fetchApproximatesBatched(
				fetchApproximates,
				() => {
					if (requestId !== mapLoadRequestId) return
					hashLoadDone += 1
				},
				requestId,
				async (approximate, posts) => {
					if (requestId !== mapLoadRequestId) return
					await setApproxPostsInCache(approximate, posts)
					let changed = false
					for (const post of posts) {
						if (!post?.uri) continue
						await setPost(post.uri, post)
						const existing = postsByUri.get(post.uri)
						const nextPost = existing
							? {...existing, ...post}
							: post
						if (existing !== nextPost) changed = true
						postsByUri.set(post.uri, nextPost)
					}
					if (changed) {
						mapPosts = [...postsByUri.values()]
					}
				},
			)

			if (requestId !== mapLoadRequestId) return

			for (let i = 0; i < responses.length; i += 1) {
				const result = responses[i]
				if (result.status !== "fulfilled") {
					const approximate = fetchApproximates[i]
					if (approximate) {
						approxErrorCache.set(
							approximate,
							Date.now() + APPROX_ERROR_TTL_MS,
						)
					}
				}
			}
			mapPosts = [...postsByUri.values()]

			const rejected = responses.find(
				(result) => result.status === "rejected",
			)
			if (rejected && postsByUri.size === 0) {
				throw rejected.reason
			}
		} catch (error) {
			if (requestId !== mapLoadRequestId) return
			mapError = error.message || "Unable to load map posts."
			mapPosts = []
		} finally {
			if (requestId !== mapLoadRequestId) return
			loadingPins = false
			hashLoadDone = hashLoadTotal
		}
	}

	async function refreshViewportPosts() {
		if (pauseBackgroundSearch) return
		if (!mapInstance) return
		const approximates = collectViewportApproximates()
		const key = [...approximates].sort().join(",")
		if (key === requestedViewportKey && refreshInFlight) return
		if (key === lastLoadedViewportKey && !refreshInFlight) return

		requestedViewportApproximates = approximates
		requestedViewportKey = key
		viewportApproximates = approximates
		hashLoadTotal = approximates.length
		hashLoadDone = 0

		mapLoadRequestId += 1
		if (refreshInFlight) {
			refreshQueued = true
			return
		}
		refreshInFlight = true
		refreshQueued = false
		try {
			const loadKey = requestedViewportKey
			await loadMapPosts(requestedViewportApproximates)
			if (loadKey === requestedViewportKey) {
				lastLoadedViewportKey = loadKey
			}
		} finally {
			refreshInFlight = false
			if (refreshQueued) {
				refreshQueued = false
				refreshViewportPosts()
			}
		}
	}

	function scheduleViewportRefresh() {
		markMapActivity()
		if (!viewportRefreshTimer) {
			refreshViewportPosts()
		}
		if (viewportRefreshTimer) clearTimeout(viewportRefreshTimer)
		viewportRefreshTimer = setTimeout(() => {
			viewportRefreshTimer = null
			refreshViewportPosts()
		}, VIEWPORT_REFRESH_DEBOUNCE_MS)
	}

	function nudgeCoordinates(lat, lon, index = 0) {
		if (!Number.isFinite(lat) || !Number.isFinite(lon) || index <= 0) {
			return {lat, lon}
		}
		const angle = index * 2.399963229728653
		const radius = 0.00022 * Math.ceil(index / 2)
		return {
			lat: lat + Math.sin(angle) * radius,
			lon: lon + Math.cos(angle) * radius,
		}
	}

	function normalizeSearchTerm(value = "") {
		return String(value || "")
			.trim()
			.replace(/\s+/g, " ")
	}

	function getSearchTokens(value = "") {
		const withoutNearMe = String(value || "").replace(/\bnear\s+me\b/gi, "").trim().replace(/\s+/g, " ")
		return normalizeSearchTerm(withoutNearMe).split(" ").filter(Boolean).map(t => t.toLowerCase())
	}

	function validMapPosts() {
		const queryTokens = getSearchTokens(activeKeywordFilter)
		return mapPosts.filter(
			(post) => {
				if (!Number.isFinite(post?.lat) || !Number.isFinite(post?.lon)) return false

				// Block filters
				const postUuid = resolvePostUuid(post)
				const authorUuid = resolvePostAuthorId(post)
				if (postUuid && blockedUuids.includes(postUuid)) return false
				if (authorUuid && blockedAuthors.includes(authorUuid)) return false

				if (queryTokens.length > 0) {
					const text = String(post.text || '').toLowerCase()
					const name = String(post.name || '').toLowerCase()
					const desc = String(post.description || '').toLowerCase()
					const tags = (post.tags || []).map(t => String(t || '').toLowerCase())

					const matches = queryTokens.every(token => 
						text.includes(token) || 
						name.includes(token) || 
						desc.includes(token) ||
						tags.includes(token)
					)
					if (!matches) return false
				}

				return true
			}
		)
	}

	function loadingProgressPercent() {
		if (!hashLoadTotal) return 0
		return Math.max(0, Math.min(100, (hashLoadDone / hashLoadTotal) * 100))
	}

	function renderMarkers() {
		if (!leaflet || !mapInstance || !markerLayer) return

		markerLayer.clearLayers()
		const slotCounts = new Map()
		const slotKey = (lat, lon) => `${lat.toFixed(5)},${lon.toFixed(5)}`
		const reserveSlot = (lat, lon) => {
			const key = slotKey(lat, lon)
			const used = slotCounts.get(key) || 0
			slotCounts.set(key, used + 1)
			return used
		}

		for (const post of validMapPosts()) {
			const baseLat = Number(post.lat)
			const baseLon = Number(post.lon)
			const slotIndex = reserveSlot(baseLat, baseLon)
			const {lat, lon} = nudgeCoordinates(baseLat, baseLon, slotIndex)
			const marker = leaflet
				.circleMarker([lat, lon], {
					radius: 7,
					color: "#7d1f13",
					fillColor: "#c54433",
					fillOpacity: 0.96,
					weight: 2,
				})
				.addTo(markerLayer)
			marker.bindPopup(markerPreviewHtml(post), {
				maxWidth: 280,
				closeOnClick: false,
				autoClose: false,
				closeButton: false,
			})
			marker.on("popupopen", (event) => {
				const el = event.popup?.getElement?.()
				const openBtn = el?.querySelector?.("[data-open-post]")
				if (openBtn) {
					openBtn.addEventListener(
						"click",
						() => {
							openPostInNewTab(post)
						},
						{once: true},
					)
				}
				const closeBtn = el?.querySelector?.("[data-close-popup]")
				if (closeBtn) {
					closeBtn.addEventListener(
						"click",
						() => {
							marker.closePopup()
						},
						{once: true},
					)
				}
			})
		}
	}

	async function saveCurrentMapState() {
		if (!mapInstance) return
		try {
			const center = mapInstance.getCenter()
			const zoom = mapInstance.getZoom()
			const lat = Number(center.lat.toFixed(5))
			const lon = Number(center.lng.toFixed(5))
			const hash = gpsToHash(lat, lon)
			if (hash) {
				await setSetting('love4dogs.map-search-location', {
					lat,
					lon,
					approximate: hash.approx,
					exact: hash.exact,
					zoom
				})
			}
		} catch {}
	}

	async function refreshBlockedLists() {
		try {
			blockedUuids = await getSetting("love4dogs.blocked-uuids", [])
			blockedAuthors = await getSetting("love4dogs.blocked-authors", [])
		} catch (e) {
			console.error("Failed to load blocked lists inside MapView:", e)
		}
	}

	onMount(async () => {
		let destroyed = false
		let onFocusOrStorage
		if (typeof window !== "undefined") {
			try {
				const profilesList = await listStoredProfiles()
				localProfileUuids = profilesList.map(p => p.uuid).filter(Boolean)
			} catch {
				localProfileUuids = []
			}

			onFocusOrStorage = () => {
				refreshBlockedLists()
			}
			window.addEventListener("focus", onFocusOrStorage)
			window.addEventListener("storage", onFocusOrStorage)
			await refreshBlockedLists()
		}

		async function initMap() {
			if (typeof window === "undefined") return
			markMapActivity()

			async function getBrowserCoords() {
				if (!navigator.geolocation) {
					throw new Error("Geolocation is not supported by your browser.")
				}
				findingNearMe = true
				try {
					const position = await new Promise((resolve, reject) => {
						navigator.geolocation.getCurrentPosition(resolve, reject, {
							enableHighAccuracy: true,
							timeout: 10000
						})
					})
					return {
						lat: position.coords.latitude,
						lon: position.coords.longitude
					}
				} finally {
					findingNearMe = false
				}
			}

			let saved = null
			try {
				saved = await getSetting('love4dogs.map-search-location')
			} catch {}

			let lat, lon, zoom = 13
			let activeKeyword = ""

			const resolved = await resolveSearchLocation(searchTerm)
			if (resolved.type === "coordinates") {
				lat = resolved.lat
				lon = resolved.lon
				activeKeyword = resolved.keyword
			} else {
				activeKeyword = resolved.keyword
				let coords = null
				if (resolved.type !== "near-me" && saved) {
					coords = { lat: saved.lat, lon: saved.lon }
					zoom = saved.zoom || 13
				} else {
					try {
						coords = await getBrowserCoords()
						zoom = saved?.zoom || 13
						if (coords) {
							const hash = gpsToHash(coords.lat, coords.lon)
							if (hash?.approx && hash?.exact) {
								await setSetting('love4dogs.map-search-location', {
									lat: coords.lat,
									lon: coords.lon,
									approximate: hash.approx,
									exact: hash.exact,
									zoom
								})
							}
						}
					} catch (err) {
						console.error("Browser geolocation failed:", err)
						if (saved) {
							coords = { lat: saved.lat, lon: saved.lon }
							zoom = saved.zoom || 13
						} else {
							mapError = "Unable to get your location."
							return
						}
					}
				}
				if (coords) {
					lat = coords.lat
					lon = coords.lon
				}
			}

			lastProcessedSearchTerm = searchTerm
			activeKeywordFilter = activeKeyword

			if (destroyed) return

			const module = await import("leaflet")
			if (destroyed) return

			leaflet = module.default ?? module
			mapInstance = leaflet
				.map(mapEl, {
					zoomControl: true,
					attributionControl: true,
					dragging: true,
					touchZoom: true,
					scrollWheelZoom: true,
					doubleClickZoom: true,
					minZoom: MIN_ZOOM,
				})
				.setView([lat, lon], zoom)

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
			
			mapInstance.on("move", () => {
				scheduleViewportRefresh()
				saveCurrentMapState()
				const center = mapInstance.getCenter()
				mapCenter = {
					lat: Number(center.lat.toFixed(5)),
					lon: Number(center.lng.toFixed(5))
				}
			})
			mapInstance.on("zoom", () => {
				scheduleViewportRefresh()
				saveCurrentMapState()
				const center = mapInstance.getCenter()
				mapCenter = {
					lat: Number(center.lat.toFixed(5)),
					lon: Number(center.lng.toFixed(5))
				}
			})

			await refreshViewportPosts()
			renderMarkers()
			const center = mapInstance.getCenter()
			mapCenter = {
				lat: Number(center.lat.toFixed(5)),
				lon: Number(center.lng.toFixed(5))
			}
			setTimeout(() => mapInstance?.invalidateSize({pan: false}), 0)
		}

		initMap()

		return () => {
			destroyed = true
			if (typeof window !== "undefined" && onFocusOrStorage) {
				window.removeEventListener("focus", onFocusOrStorage)
				window.removeEventListener("storage", onFocusOrStorage)
			}
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

<div class="map-view-container">
	{#if mapError && !mapInstance}
		<div class="error-banner">
			<p class="error">{mapError}</p>
		</div>
	{/if}

	<div class="map-view" bind:this={mapEl}></div>

	{#if loadingPins}
		<div
			class="loading-bar"
			role="progressbar"
			aria-label="Loading map posts"
			aria-valuemin="0"
			aria-valuemax={hashLoadTotal || 0}
			aria-valuenow={Math.min(hashLoadDone, hashLoadTotal || 0)}
		>
			<span
				class="loading-bar__fill"
				style={`width: ${loadingProgressPercent()}%`}
			></span>
		</div>
		{#if isLocalHost}
		<p class="muted">
			Loading nearby posts... {Math.min(hashLoadDone, hashLoadTotal)} /
			{hashLoadTotal} parcels
		</p>
		{/if}
	{:else}
		{#if isLocalHost}	
		<p class="muted">
			Found {validMapPosts().length} post(s)
		</p>
		{/if}
	{/if}
</div>

<style>
	.map-view-container {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.error-banner {
		padding: 0.75rem;
		background: #fdf2f2;
		border: 1px solid #f8b4b4;
		border-radius: 8px;
		margin-bottom: 0.75rem;
	}

	.muted {
		color: #5f665f;
		margin: 0.45rem 0;
	}

	.error {
		color: #8e2f21;
		margin: 0;
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

	.loading-bar {
		position: relative;
		width: 100%;
		height: 8px;
		margin: 0.65rem 0 0.45rem;
		border-radius: 999px;
		background: rgba(59, 110, 79, 0.2);
		overflow: hidden;
	}

	.loading-bar__fill {
		position: absolute;
		top: 0;
		left: 0;
		width: 0%;
		height: 100%;
		background: linear-gradient(90deg, #3b6e4f, #6aa77f);
		border-radius: 999px;
		transition: width 0.15s ease-out;
	}

	:global(.leaflet-container) {
		width: 100%;
		height: 100%;
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

	:global(.leaflet-popup-content-wrapper) {
		position: relative !important;
	}

	:global(.pin-preview-close) {
		position: absolute;
		top: -10px;
		right: -10px;
		width: 26px;
		height: 26px;
		border: 2px solid #fff;
		background: #111;
		color: #fff;
		border-radius: 50%;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		z-index: 1000;
	}

	:global(.pin-preview-close:hover) {
		background: #333;
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
</style>
