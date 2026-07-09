<script>
	import {onMount, tick} from "svelte"
	import {page} from "$app/state"
	import {goto} from "$app/navigation"
	import {CircleAlert} from "lucide-svelte"
	import OneCard from "$lib/OneCard.svelte"
	import NavBar from "$lib/NavBar.svelte"
	import FeedHeaderActions from "$lib/FeedHeaderActions.svelte"
	import {readSearchTerm, writeSearchTerm} from "$lib/searchStore"
	import { getSetting, getAllPosts, setPost } from "$lib/db"
	import { slowScrollIntoView } from "$lib/utils"
	import { getCurrentProfileUuid, readStoredProfileByUuid, listStoredProfiles } from "$lib/profileRegistry"
	import { processQueryForNearMe } from "$lib/locationUtils"

	const FAVORITE_SEARCH_TERMS_KEY =
		"love4dogs.settings.favorite-search-terms-v1"
	const DEFAULT_SEARCH_TERM_KEY = "love4dogs.settings.default-search-term-v1"
	const SEARCH_CACHE_TTL_MS = 20 * 60 * 1000
	const SESSION_SEARCH_RESULTS_KEY = "love4dogs.last-search-results"
	const SESSION_SEARCH_QUERY_KEY = "love4dogs.last-search-query"
	const SESSION_SEARCH_SORT_KEY = "love4dogs.last-search-sort"
	const SESSION_SEARCH_FETCHED_AT_KEY = "love4dogs.last-search-fetched-at"

	let posts = $state([])
	let searchTerm = $state("")
	let lastUsedQuery = $state("")
	let loadingPosts = $state(false)
	let refreshingPosts = $state(false)
	let blockedUuids = $state([])
	let blockedAuthors = $state([])
	let feedError = $state("")
	let searchSort = $state("latest")
	let showProfiles = $state(true)
	let showPosts = $state(true)
	let showComments = $state(true)
	let loadingMore = $state(false)
	let feedCursor = null
	let feedCursorHost = null
	let hasMorePosts = $state(true)
	let favoriteSearchTerms = $state([])
	let currentView = $state("feed")
	let automateFailed = $state(false)
	let showNoResultsInfo = $state("")
	let loadMoreBtn = $state(null)
	let searchTermsChanged = $state(false)

	let searchDebounceTimer = null
	let lastFeedRequestId = 0

	// Derive initial search term from URL path segments
	const urlTerms = $derived(
		String(page.params?.terms || "")
			.split("/")
			.map((s) => s.trim())
			.filter(Boolean)
			.join(" "),
	)

	const showBlockedOnly = $derived(
		searchTerm.trim().toLowerCase() === "blocked"
	)



	function normalizeSearchTerm(value = "") {
		return String(value || "")
			.trim()
			.replace(/\s+/g, " ")
	}

	async function readFavoriteSearchTerms() {
		try {
			const parsed = await getSetting(FAVORITE_SEARCH_TERMS_KEY, [])
			if (!Array.isArray(parsed)) return []
			const seen = new Set()
			const next = []
			for (const entry of parsed) {
				const normalized = normalizeSearchTerm(entry)
				if (!normalized) continue
				const key = normalized.toLowerCase()
				if (seen.has(key)) continue
				seen.add(key)
				next.push(normalized)
				if (next.length >= 20) break
			}
			return next
		} catch {
			return []
		}
	}

	async function readDefaultSearchTerm() {
		const val = await getSetting(DEFAULT_SEARCH_TERM_KEY, "")
		return normalizeSearchTerm(val)
	}

	function buildFeedQuery(rawQuery = "") {
		return String(rawQuery || "").trim()
	}

	function getSearchTokens(value = "") {
		const withoutNearMe = String(value || "").replace(/\bnear\s+me\b/gi, "").trim().replace(/\s+/g, " ")
		return normalizeSearchTerm(withoutNearMe).split(" ").filter(Boolean)
	}

	function toggleSearchTag(tag = "") {
		const token = String(tag || "")
			.trim()
			.toLowerCase()
			.replace(/^#/, "")
		if (!token) return
		const next = [...getSearchTokens(searchTerm)]
		const index = next.indexOf(token)
		if (index >= 0) {
			next.splice(index, 1)
		} else {
			next.push(token)
		}
		searchTerm = next.join(" ")
	}

	const altCandidatesCache = new Map()

	function getAltCandidates(alt = "") {
		const source = String(alt || "").trim()
		if (!source) return []
		if (altCandidatesCache.has(source)) {
			return altCandidatesCache.get(source)
		}

		let candidates = []
		try {
			const parsed = JSON.parse(source)
			candidates = [parsed, parsed?.primary, parsed?.combined?.primary]

			if (typeof parsed?.h === "string" && parsed.h.trim()) {
				try {
					const inner = JSON.parse(parsed.h)
					candidates.push(
						inner,
						inner?.primary,
						inner?.combined?.primary,
					)
				} catch {}
			}
		} catch {
			candidates = []
		}

		const normalized = candidates.filter(
			(candidate) => candidate && typeof candidate === "object",
		)
		altCandidatesCache.set(source, normalized)
		return normalized
	}

	function extractUuidFromBundleAlt(alt = "") {
		for (const candidate of getAltCandidates(alt)) {
			const directUuid = String(
				candidate?.u || candidate?.uuid || candidate?.id || "",
			).trim()
			if (directUuid) return directUuid
		}
		return ""
	}

	function resolvePostUuid(post = {}) {
		const directUuid = String(post?.uuid || "").trim()
		if (directUuid) return directUuid

		for (const alt of post?.imageAlts || []) {
			const fromAlt = extractUuidFromBundleAlt(alt)
			if (fromAlt) return fromAlt
		}

		return extractUuidFromBundleAlt(post?.video?.alt || "")
	}

	function extractAuthorIdFromBundleAlt(alt = "") {
		for (const candidate of getAltCandidates(alt)) {
			const authorId = String(
				candidate?.authorid || candidate?.authorId || "",
			).trim()
			if (authorId) return authorId
		}
		return ""
	}

	function resolvePostAuthorId(post = {}) {
		const directAuthorId = String(post?.authorid || post?.authorId || "").trim()
		if (directAuthorId) return directAuthorId

		for (const alt of post?.imageAlts || []) {
			const fromAlt = extractAuthorIdFromBundleAlt(alt)
			if (fromAlt) return fromAlt
		}

		return extractAuthorIdFromBundleAlt(post?.video?.alt || "")
	}

	function visiblePosts() {
		const seen = new Set()
		const seenUuids = new Set()
		const next = []
		for (const post of posts) {
			const key = String(post?.displayKey || post?.uri || "").trim()
			if (!key || seen.has(key)) continue

			const postUuid = resolvePostUuid(post)
			if (postUuid && seenUuids.has(postUuid)) {
				continue
			}

			const authorUuid = resolvePostAuthorId(post)

			const isPostBlocked = postUuid && blockedUuids.includes(postUuid)
			const isAuthorBlocked = authorUuid && blockedAuthors.includes(authorUuid)

			if (showBlockedOnly) {
				if (!isPostBlocked && !isAuthorBlocked) {
					continue
				}
			} else {
				if (isPostBlocked || isAuthorBlocked) {
					continue
				}
			}

			// Parse tags to determine if it is profile, post, or comment
			const tags = (post.tags || []).map(t => String(t || '').trim().toLowerCase())
			let isComment = tags.includes("chat")

			if (!isComment && post?.imageAlts && post.imageAlts.length > 0) {
				try {
					const parsed = JSON.parse(post.imageAlts[0])
					if (parsed && parsed.uuid && parsed.context) {
						isComment = true
					}
				} catch {}
			}

			const isProfile = !isComment && tags.includes("profile")
			const isNormalPost = !isComment && !isProfile

			if (isComment && !showComments) continue
			if (isProfile && !showProfiles) continue
			if (isNormalPost && !showPosts) continue

			seen.add(key)
			if (postUuid) {
				seenUuids.add(postUuid)
			}
			next.push(post)
		}
		return next
	}

	function isValidCanonicalUrl(value = "") {
		const source = String(value || "").trim()
		if (!source) return false
		try {
			const parsed = new URL(source)
			const parts = parsed.pathname.split("/").filter(Boolean)
			const profileIdx = parts.findIndex((part) => part === "profile")
			if (profileIdx >= 0 && parts[profileIdx + 1] === "view") {
				const uuid = String(parts[profileIdx + 2] || "").trim()
				return uuid.length > 0
			}
			return true
		} catch {
			return false
		}
	}

	function updateUrlFromSearch(term = "") {
		if (typeof window === "undefined") return
		const normalized = String(term || "")
			.replace(/,/g, " ")
			.trim()
			.replace(/\s+/g, " ")
		const segments = normalized
			? normalized
					.split(" ")
					.map((s) => encodeURIComponent(s))
					.join("/")
			: ""
		const target = segments ? `/search/${segments}` : "/search"
		const currentPath = window.location.pathname
		if (currentPath !== target) {
			goto(target, {replaceState: true, noScroll: true})
		}
	}

	function readSessionCachedResults(term = "", sort = "latest") {
		if (typeof sessionStorage === "undefined") return null
		try {
			const cachedQuery = normalizeSearchTerm(
				sessionStorage.getItem(SESSION_SEARCH_QUERY_KEY) || "",
			)
			const targetQuery = normalizeSearchTerm(term)
			if (cachedQuery.toLowerCase() !== targetQuery.toLowerCase()) {
				return null
			}

			const cachedSort = String(
				sessionStorage.getItem(SESSION_SEARCH_SORT_KEY) || "latest",
			)
			if (cachedSort !== String(sort || "latest")) {
				return null
			}

			const rawResults = sessionStorage.getItem(SESSION_SEARCH_RESULTS_KEY)
			if (!rawResults) return null

			const parsedResults = JSON.parse(rawResults)
			if (!Array.isArray(parsedResults)) return null

			const fetchedAtRaw = Number(
				sessionStorage.getItem(SESSION_SEARCH_FETCHED_AT_KEY) || 0,
			)
			const fetchedAt = Number.isFinite(fetchedAtRaw) ? fetchedAtRaw : 0
			const ageMs = fetchedAt > 0 ? Math.max(0, Date.now() - fetchedAt) : Number.MAX_SAFE_INTEGER

			return {
				posts: parsedResults,
				fetchedAt,
				ageMs,
			}
		} catch (error) {
			console.error("Failed to read search cache from sessionStorage:", error)
			return null
		}
	}

	function markSessionCacheFresh() {
		if (typeof sessionStorage === "undefined") return
		try {
			sessionStorage.setItem(SESSION_SEARCH_FETCHED_AT_KEY, String(Date.now()))
		} catch (error) {
			console.error("Failed to update search cache freshness:", error)
		}
	}

	async function loadFeed({forceFresh = false} = {}) {
		const requestId = ++lastFeedRequestId
		const cached = !forceFresh && !showBlockedOnly
			? readSessionCachedResults(searchTerm, searchSort)
			: null
		const hasCachedBaseline = Boolean(cached)

		if (cached) {
			posts = cached.posts
			lastUsedQuery = buildFeedQuery(searchTerm)
			feedCursor = null
			feedCursorHost = null
			hasMorePosts = false
			loadingPosts = false
			refreshingPosts = cached.ageMs > SEARCH_CACHE_TTL_MS
		} else {
			loadingPosts = true
			refreshingPosts = false
		}
		feedError = ""
		if (!cached) {
			feedCursor = null
			feedCursorHost = null
			hasMorePosts = true
		}
		automateFailed = false
		searchTermsChanged = false
		if (searchTerm.trim() !== "") {
			showNoResultsInfo = ""
		}

		if (cached && cached.posts.length > 0 && cached.ageMs <= SEARCH_CACHE_TTL_MS) {
			return
		}

		if (showBlockedOnly) {
			try {
				const allCached = await getAllPosts()
				posts = allCached.filter(post => {
					const postUuid = resolvePostUuid(post)
					const authorUuid = resolvePostAuthorId(post)
					const isPostBlocked = postUuid && blockedUuids.includes(postUuid)
					const isAuthorBlocked = authorUuid && blockedAuthors.includes(authorUuid)
					return isPostBlocked || isAuthorBlocked
				})
				
				posts.sort((a, b) => {
					const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
					const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
					return timeB - timeA
				})
				
				feedCursor = null
				hasMorePosts = false
				return
			} catch (err) {
				console.error("Failed loading blocked posts locally:", err)
				feedError = "Failed loading blocked posts."
			} finally {
				if (requestId === lastFeedRequestId) {
					loadingPosts = false
					refreshingPosts = false
				}
			}
			return
		}

		let activeQuery = await processQueryForNearMe(searchTerm)
		const initialActiveQuery = activeQuery
		let searchAttempts = 0
		const maxSearchAttempts = 15

		while (searchAttempts < maxSearchAttempts) {
			searchAttempts++
			try {
				const query = buildFeedQuery(activeQuery)
				const params = new URLSearchParams({
					query,
					sort: searchSort,
					limit: 20,
					chat: "all",
				})
				if (forceFresh) {
					params.set("refresh", "1")
					params.set("ts", String(Date.now()))
				}
				const res = await fetch(`/api/feed?${params.toString()}`, {
					cache: forceFresh ? "no-store" : "default",
				})
				const json = await res.json()

				if (!res.ok) {
					throw new Error(json.error || "Could not load posts.")
				}

				if (requestId !== lastFeedRequestId) return

				const foundPosts = json.posts || []
				if (foundPosts.length > 0 || activeQuery === "") {
					posts = foundPosts
					lastUsedQuery = activeQuery
					feedCursor = json.cursor || null
					feedCursorHost = json.cursorHost || null
					hasMorePosts = !!json.cursor
					markSessionCacheFresh()

					// Cache fetched posts to IndexedDB
					for (const post of posts) {
						if (post && post.uri) {
							await setPost(post.uri, post)
						}
					}

					if (posts.length === 0 && searchTerm.trim() !== "") {
						showNoResultsInfo = searchTerm
					}
					if (activeQuery !== initialActiveQuery && posts.length > 0) {
						searchTermsChanged = true
					}
					break
				} else {
					const words = activeQuery.split(/\s+/).filter(Boolean)
					if (words.length > 0) {
						words.pop()
						activeQuery = words.join(" ")
					} else {
						activeQuery = ""
					}
				}
			} catch (error) {
				if (requestId !== lastFeedRequestId) return

				// Offline fallback
				const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
				if (isOffline || error.message?.includes("failed to fetch") || error.message?.includes("network")) {
					try {
						const allCached = await getAllPosts()
						let offlineQuery = activeQuery
						const initialOfflineQuery = offlineQuery
						let offlineAttempts = 0

						while (offlineAttempts < maxSearchAttempts) {
							offlineAttempts++
							const queryTokens = offlineQuery.split(/\s+/).filter(Boolean).map(t => t.toLowerCase())
							let filtered = []

							if (queryTokens.length > 0) {
								filtered = allCached.filter(post => {
									const text = String(post.text || '').toLowerCase()
									const name = String(post.name || '').toLowerCase()
									const desc = String(post.description || '').toLowerCase()
									const tags = (post.tags || []).map(t => String(t || '').toLowerCase())
									return queryTokens.every(token => 
										text.includes(token) || 
										name.includes(token) || 
										desc.includes(token) ||
										tags.includes(token)
									)
								})
							} else {
								filtered = allCached
							}

							if (filtered.length > 0 || offlineQuery === "") {
								posts = filtered
								lastUsedQuery = offlineQuery
								if (posts.length === 0 && searchTerm.trim() !== "") {
									showNoResultsInfo = searchTerm
								}
								if (offlineQuery !== initialOfflineQuery && posts.length > 0) {
									searchTermsChanged = true
								}

								posts.sort((a, b) => {
									const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
									const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
									return timeB - timeA
								})
								feedCursor = null
								hasMorePosts = false
								feedError = "Offline mode. Showing cached search results."
								return
							} else {
								const words = offlineQuery.split(/\s+/).filter(Boolean)
								if (words.length > 0) {
									words.pop()
									offlineQuery = words.join(" ")
								} else {
									offlineQuery = ""
								}
							}
						}
					} catch (cacheErr) {
						console.error("Local search fallback failed:", cacheErr)
					}
				}
				if (!hasCachedBaseline) {
					feedError = error.message || "Failed loading feed."
				}
				break
			}
		}

		if (requestId === lastFeedRequestId) {
			loadingPosts = false
			refreshingPosts = false
		}
	}

	async function loadMorePosts(isManual = false) {
		if (loadingMore || !feedCursor || !hasMorePosts) return

		loadingMore = true
		const requestId = lastFeedRequestId
		const targetCount = 8
		let newlyAddedCount = 0
		let attempts = 0
		const maxAttempts = 5

		try {
			while (newlyAddedCount < targetCount && feedCursor && hasMorePosts && attempts < maxAttempts) {
				attempts++
				const query = buildFeedQuery(lastUsedQuery)
				const params = new URLSearchParams({
					query,
					sort: searchSort,
					limit: 20,
					cursor: feedCursor,
					chat: "all",
				})
				if (feedCursorHost) {
					params.set("cursorHost", String(feedCursorHost))
				}
				const res = await fetch(`/api/feed?${params.toString()}`)
				const json = await res.json()

				if (!res.ok) throw new Error(json.error || "Could not load more.")
				if (requestId !== lastFeedRequestId) return

				const newPosts = json.posts || []
				
				// Calculate how many of these posts are actually new unique visible posts
				const existingKeys = new Set()
				const existingUuids = new Set()
				for (const p of visiblePosts()) {
					existingKeys.add(String(p.displayKey || p.uri).trim())
					const u = resolvePostUuid(p)
					if (u) existingUuids.add(u)
				}
				
				let batchNewCount = 0
				for (const post of newPosts) {
					if (post) {
						const key = String(post.displayKey || post.uri).trim()
						const postUuid = resolvePostUuid(post)
						if (existingKeys.has(key) || (postUuid && existingUuids.has(postUuid))) {
							continue
						}
						batchNewCount++
						existingKeys.add(key)
						if (postUuid) existingUuids.add(postUuid)
					}
				}

				posts = [...posts, ...newPosts]

				// Cache fetched posts to IndexedDB
				for (const post of newPosts) {
					if (post && post.uri) {
						await setPost(post.uri, post)
					}
				}

				feedCursor = json.cursor || null
				feedCursorHost = json.cursorHost || feedCursorHost || null
				hasMorePosts = !!json.cursor
				markSessionCacheFresh()

				newlyAddedCount += batchNewCount

				if (!feedCursor || !hasMorePosts) {
					break
				}
			}
		} catch {
			// Silently fail on load more
		} finally {
			loadingMore = false
			if (isManual) {
				await tick()
				if (loadMoreBtn) {
					//slowScrollIntoView(loadMoreBtn, 3000)
				}
			}
		}
	}

	function setView(view = "feed") {
		currentView = String(view || "feed")
	}

	const isSearchResultsEmpty = $derived(
		searchTerm.trim().length > 0 && visiblePosts().length === 0,
	)

	async function refreshBlockedLists() {
		try {
			blockedUuids = await getSetting("love4dogs.blocked-uuids", [])
			blockedAuthors = await getSetting("love4dogs.blocked-authors", [])
		} catch (e) {
			console.error("Failed to load blocked lists:", e)
		}
	}

	let lastSeenUrlTerms = $state("")

	$effect(() => {
		const currentUrlTerms = urlTerms
		if (currentUrlTerms !== lastSeenUrlTerms) {
			lastSeenUrlTerms = currentUrlTerms
			searchTerm = currentUrlTerms
			loadFeed()
		}
	})

	onMount(async () => {
		lastSeenUrlTerms = urlTerms
		favoriteSearchTerms = await readFavoriteSearchTerms()
		await refreshBlockedLists()

		const onFocusOrStorage = () => {
			refreshBlockedLists()
		}
		if (typeof window !== "undefined") {
			window.addEventListener("focus", onFocusOrStorage)
			window.addEventListener("storage", onFocusOrStorage)
		}

		// Seed search from URL params, then ?q=, then localStorage, then default
		const qParam = new URLSearchParams(window.location.search).get("q")
		if (urlTerms) {
			searchTerm = urlTerms
		} else if (qParam) {
			searchTerm = normalizeSearchTerm(qParam)
		} else {
			const savedTerm = await readSearchTerm()
			searchTerm = savedTerm || await readDefaultSearchTerm()
		}

		await loadFeed()

		return () => {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
			if (typeof window !== "undefined") {
				window.removeEventListener("focus", onFocusOrStorage)
				window.removeEventListener("storage", onFocusOrStorage)
			}
		}
	})

	// Persist search term to localStorage whenever it changes
	$effect(() => {
		writeSearchTerm(searchTerm)
	})

	// Save the current search results and query to sessionStorage for the map view
	$effect(() => {
		const results = posts;
		if (typeof sessionStorage !== 'undefined') {
			try {
				sessionStorage.setItem(SESSION_SEARCH_RESULTS_KEY, JSON.stringify(results));
				sessionStorage.setItem(SESSION_SEARCH_QUERY_KEY, normalizeSearchTerm(lastUsedQuery || searchTerm));
				sessionStorage.setItem(SESSION_SEARCH_SORT_KEY, String(searchSort || "latest"));
			} catch (e) {
				console.error("Failed to save search results to sessionStorage:", e);
			}
		}
	})

	// Automate loading more if there are less than 12 visible posts
	$effect(() => {
		const visibleCount = visiblePosts().length
		if (
			visibleCount > 0 &&
			visibleCount < 12 &&
			hasMorePosts &&
			!loadingPosts &&
			!loadingMore &&
			!automateFailed
		) {
			const prevLength = posts.length
			loadMorePosts().then(() => {
				if (posts.length <= prevLength) {
					automateFailed = true
				}
			})
		}
	})
</script>

<svelte:head>
	<title>Search | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar
		bind:searchTerm
		showSearch={true}
		{currentView}
		onSetView={setView}
		onSearchSubmit={() => {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
			updateUrlFromSearch(searchTerm)
			loadFeed()
		}}
		onSearchInput={() => {
			if (!searchTerm.trim()) {
				updateUrlFromSearch("")
				loadFeed()
			}
		}}
	/>

	{#if favoriteSearchTerms.length > 0}
		<section class="favorite-searches" aria-label="Favorite searches">
			<p class="favorite-searches-label">Favorite searches</p>
			<div class="favorite-searches-chips">
				{#each favoriteSearchTerms as term}
					<button
						type="button"
						class="favorite-search-chip"
						onclick={() => {
							searchTerm = term
							updateUrlFromSearch(term)
							if (searchDebounceTimer)
								clearTimeout(searchDebounceTimer)
							loadFeed()
						}}
					>
						{term}
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<section class="grid">
		<article class="panel feed">
			<div class="feed-header">
				<div class="feed-header-left">
					<h2>
						{#if showBlockedOnly}
							Blocked Posts
						{:else}
							{#if searchTerm.trim().length > 0}
								Search Results
								{#if isSearchResultsEmpty && !loadingPosts}
									<span class="results-empty-pill">(empty)</span>
								{/if}
							{:else}
								Recent Posts
							{/if}
						{/if}
					</h2>
					<!-- <label class="sort-toggle" aria-label="Sort search results">
						<span class="sort-label">Most recent</span>
						<input
							type="checkbox"
							checked={searchSort === "top"}
							onchange={(event) => {
								searchSort = event.currentTarget.checked
									? "top"
									: "latest"
								loadFeed()
							}}
						/>
						<span class="sort-slider" aria-hidden="true"></span>
						<span class="sort-label">Most popular</span>
					</label> -->
					<div class="filter-group">
						<span class="filter-title">Show:</span>
						<div class="checkbox-container">
							<label class="custom-checkbox">
								<input type="checkbox" bind:checked={showProfiles} />
								<span class="checkbox-box">
									<svg class="checkmark" viewBox="0 0 24 24">
										<path d="M4.1 12.7L9 17.6 20 6.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								</span>
								<span class="checkbox-label">Profiles</span>
							</label>
							
							<label class="custom-checkbox">
								<input type="checkbox" bind:checked={showPosts} />
								<span class="checkbox-box">
									<svg class="checkmark" viewBox="0 0 24 24">
										<path d="M4.1 12.7L9 17.6 20 6.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								</span>
								<span class="checkbox-label">Posts</span>
							</label>

							<label class="custom-checkbox">
								<input type="checkbox" bind:checked={showComments} />
								<span class="checkbox-box">
									<svg class="checkmark" viewBox="0 0 24 24">
										<path d="M4.1 12.7L9 17.6 20 6.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								</span>
								<span class="checkbox-label">Comments</span>
							</label>
						</div>
					</div>
				</div>
				<FeedHeaderActions
					currentView="search"
					searchTerm={searchTerm}
					onRefresh={() => loadFeed({forceFresh: true})}
					refreshDisabled={loadingPosts}
				/>
			</div>

			{#if showNoResultsInfo}
				<div class="no-results-banner">
					<CircleAlert size={16} />
					<span>No posts matched "{showNoResultsInfo}". Showing all recent posts instead.</span>
					<button type="button" class="dismiss-btn" onclick={() => showNoResultsInfo = ""}>Dismiss</button>
				</div>
			{/if}

			{#if searchTermsChanged}
				<div class="no-results-banner">
					<CircleAlert size={16} />
					<span>Search terms have changed to match available results. Please order your search terms by priority (most important first).</span>
					<button type="button" class="dismiss-btn" onclick={() => searchTermsChanged = false}>Dismiss</button>
				</div>
			{/if}

			{#if refreshingPosts && visiblePosts().length > 0}
				<p class="muted">Refreshing cached results...</p>
			{/if}

			{#if loadingPosts}
				<p class="muted">Loading posts...</p>
			{:else if feedError}
				<p class="warning"><CircleAlert size={15} /> {feedError}</p>
			{:else if visiblePosts().length === 0}
				{#if showBlockedOnly}
					<p class="muted">No blocked posts to show.</p>
				{:else if searchTerm.trim().length > 0}
					<div class="empty-search-state">
						<p class="muted">No posts match this search.</p>
						<a class="create-post-btn" href="/post">
							Create a post
						</a>
					</div>
				{:else}
					<p class="muted">No posts to show.</p>
				{/if}
			{:else}
				<div class="post-list-mosaic">
					<div class="column">
						{#each visiblePosts().filter((_, i) => i % 2 === 0) as post (post.displayKey || post.uri)}
							<OneCard {post} onTagClick={toggleSearchTag} />
						{/each}
					</div>
					<div class="column">
						{#each visiblePosts().filter((_, i) => i % 2 !== 0) as post (post.displayKey || post.uri)}
							<OneCard {post} onTagClick={toggleSearchTag} />
						{/each}
					</div>
				</div>
			{/if}

			{#if !loadingPosts && visiblePosts().length > 0}
				<div class="load-more-actions">
					<button
						bind:this={loadMoreBtn}
						type="button"
						class="load-more-btn"
						onclick={() => loadMorePosts(true)}
						disabled={loadingMore || !hasMorePosts}
					>
						{#if loadingMore}
							Loading more...
						{:else if !hasMorePosts}
							Done
						{:else}
							More
						{/if}
					</button>
				</div>
			{/if}
		</article>
	</section>
</main>

<style>
	.no-results-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: rgba(215, 125, 78, 0.08);
		border: 1px solid rgba(215, 125, 78, 0.25);
		border-radius: 12px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		color: #9c4c23;
		font-size: 0.9rem;
	}

	.no-results-banner :global(svg) {
		color: #d77d4e;
		flex-shrink: 0;
	}

	.dismiss-btn {
		margin-left: auto;
		background: transparent;
		border: 1px solid rgba(215, 125, 78, 0.4);
		border-radius: 6px;
		padding: 0.25rem 0.55rem;
		color: #9c4c23;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.dismiss-btn:hover {
		background: rgba(215, 125, 78, 0.12);
		border-color: #9c4c23;
	}

	.page {
		max-width: 1120px;
		margin: 0 auto;
		padding: 1rem;
	}

	.grid {
		margin-bottom: 90dvh;
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	.favorite-searches {
		display: grid;
		gap: 0.45rem;
		margin: 0 0 0.75rem;
	}

	.favorite-searches-label {
		margin: 0;
		font-size: 0.84rem;
		font-weight: 600;
		color: #5f665f;
	}

	.favorite-searches-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.favorite-search-chip {
		border: 1px solid rgba(59, 110, 79, 0.34);
		background: rgba(59, 110, 79, 0.1);
		color: #305741;
		border-radius: 999px;
		padding: 0.22rem 0.65rem;
		font-size: 0.84rem;
		font-weight: 600;
		cursor: pointer;
	}

	.favorite-search-chip:hover {
		background: rgba(59, 110, 79, 0.18);
		border-color: #305741;
	}

	.panel {
		background: rgba(255, 250, 241, 0.88);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 1rem;
		box-shadow: 0 10px 26px rgba(65, 42, 20, 0.12);
	}

	h2 {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		font-size: 1rem;
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

	.results-empty-pill {
		margin-left: 0.35rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: #8e2f21;
	}

	.muted {
		color: #5f665f;
		margin: 0.45rem 0 0.85rem;
	}

	.load-more-actions {
		display: flex;
		justify-content: center;
		padding: 0.45rem 0 0.3rem;
	}

	.load-more-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.45rem 0.95rem;
		border-radius: 999px;
		border: 1px solid rgba(59, 110, 79, 0.34);
		background: #3b6e4f;
		color: #fff;
		font-size: 0.88rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(59, 110, 79, 0.18);
	}

	.load-more-btn:hover {
		background: #305741;
	}

	.load-more-btn:disabled {
		background: rgba(129, 129, 129, 0.36);
		color: #5f665f;
		border-color: rgba(129, 129, 129, 0.2);
		cursor: default;
		box-shadow: none;
	}

	.empty-search-state {
		display: grid;
		justify-items: start;
		gap: 0.45rem;
		margin-top: 0.5rem;
	}

	.create-post-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		border: 1px solid rgba(59, 110, 79, 0.34);
		background: #3b6e4f;
		color: #fff;
		text-decoration: none;
		font-size: 0.88rem;
		font-weight: 700;
		box-shadow: 0 4px 12px rgba(59, 110, 79, 0.18);
	}

	.create-post-btn:hover {
		background: #305741;
	}

	.warning {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.9rem;
		margin: 0.7rem 0 0;
		color: #8e2f21;
	}

	.post-list-mosaic {
		display: flex;
		gap: 0.9rem;
	}

	.post-list-mosaic .column {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.filter-group {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: rgba(255, 255, 255, 0.6);
		padding: 0.35rem 0.85rem;
		border-radius: 999px;
		border: 1px solid rgba(58, 91, 65, 0.12);
		margin-left: 0.5rem;
	}

	.filter-title {
		font-size: 0.75rem;
		font-weight: 700;
		color: #5f665f;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.checkbox-container {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.custom-checkbox {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		user-select: none;
		font-size: 0.8rem;
		font-weight: 600;
		color: #5f665f;
		transition: color 0.2s ease;
	}

	.custom-checkbox:hover {
		color: #3b6e4f;
	}

	.custom-checkbox input {
		position: absolute;
		opacity: 0;
		cursor: pointer;
		height: 0;
		width: 0;
	}

	.checkbox-box {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border: 2px solid rgba(58, 91, 65, 0.3);
		border-radius: 4px;
		background: #fff;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.custom-checkbox:active .checkbox-box {
		transform: scale(0.9);
	}

	.custom-checkbox input:checked + .checkbox-box {
		background: #3b6e4f;
		border-color: #3b6e4f;
		box-shadow: 0 2px 6px rgba(59, 110, 79, 0.25);
		animation: checkbox-bounce 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.checkmark {
		width: 10px;
		height: 10px;
		color: #fff;
		stroke-dasharray: 24;
		stroke-dashoffset: 24;
		transition: stroke-dashoffset 0.2s ease 0.05s;
	}

	.custom-checkbox input:checked + .checkbox-box .checkmark {
		stroke-dashoffset: 0;
	}

	@keyframes checkbox-bounce {
		0%, 100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.15);
		}
	}

	@media (max-width: 640px) {
		.post-list-mosaic {
			flex-direction: column;
		}

		.feed-header {
			flex-wrap: wrap;
		}
	}
</style>
