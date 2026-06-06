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

	const FAVORITE_SEARCH_TERMS_KEY =
		"love4dogs.settings.favorite-search-terms-v1"
	const DEFAULT_SEARCH_TERM_KEY = "love4dogs.settings.default-search-term-v1"

	let posts = $state([])
	let searchTerm = $state("")
	let loadingPosts = $state(false)
	let blockedUuids = $state([])
	let blockedAuthors = $state([])
	let feedError = $state("")
	let searchSort = $state("latest")
	let loadingMore = $state(false)
	let feedCursor = null
	let feedCursorHost = null
	let hasMorePosts = $state(true)
	let favoriteSearchTerms = $state([])
	let currentView = $state("feed")
	let automateFailed = $state(false)
	let showNoResultsInfo = $state("")
	let loadMoreBtn = null

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
		const next = []
		for (const post of posts) {
			const key = String(post?.displayKey || post?.uri || "").trim()
			if (!key || seen.has(key)) continue

			// Filter out blocked posts
			const postUuid = resolvePostUuid(post)
			if (postUuid && blockedUuids.includes(postUuid)) {
				continue
			}

			// Filter out blocked authors
			const authorUuid = resolvePostAuthorId(post)
			if (authorUuid && blockedAuthors.includes(authorUuid)) {
				continue
			}

			seen.add(key)
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

	async function loadFeed({forceFresh = false} = {}) {
		const requestId = ++lastFeedRequestId
		loadingPosts = true
		feedError = ""
		feedCursor = null
		feedCursorHost = null
		hasMorePosts = true
		automateFailed = false
		if (searchTerm.trim() !== "") {
			showNoResultsInfo = ""
		}

		try {
			const query = buildFeedQuery(searchTerm)
			const params = new URLSearchParams({
				query,
				sort: searchSort,
				limit: 20,
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

			posts = json.posts || []
			feedCursor = json.cursor || null
			feedCursorHost = json.cursorHost || null
			hasMorePosts = !!json.cursor

			// Cache fetched posts to IndexedDB
			for (const post of posts) {
				if (post && post.uri) {
					await setPost(post.uri, post)
				}
			}

			if (posts.length === 0 && searchTerm.trim() !== "") {
				showNoResultsInfo = searchTerm
				searchTerm = ""
				updateUrlFromSearch("")
				await loadFeed()
				return
			}
		} catch (error) {
			if (requestId !== lastFeedRequestId) return

			// Offline fallback
			const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
			if (isOffline || error.message?.includes("failed to fetch") || error.message?.includes("network")) {
				try {
					const allCached = await getAllPosts()
					const queryTokens = getSearchTokens(searchTerm).map(t => t.toLowerCase())
					if (queryTokens.length > 0) {
						posts = allCached.filter(post => {
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
						posts = allCached
					}

					if (posts.length === 0 && searchTerm.trim() !== "") {
						showNoResultsInfo = searchTerm
						searchTerm = ""
						updateUrlFromSearch("")
						posts = allCached
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
				} catch (cacheErr) {
					console.error("Local search fallback failed:", cacheErr)
				}
			}
			feedError = error.message || "Failed loading feed."
		} finally {
			if (requestId === lastFeedRequestId) loadingPosts = false
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
				const query = buildFeedQuery(searchTerm)
				const params = new URLSearchParams({
					query,
					sort: searchSort,
					limit: 20,
					cursor: feedCursor,
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
				const existingKeys = new Set(visiblePosts().map(p => String(p.displayKey || p.uri).trim()))
				let batchNewCount = 0
				for (const post of newPosts) {
					if (post) {
						const key = String(post.displayKey || post.uri).trim()
						if (key && !existingKeys.has(key)) {
							batchNewCount++
							existingKeys.add(key)
						}
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
					slowScrollIntoView(loadMoreBtn, 3000)
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

	onMount(async () => {
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
						{#if searchTerm.trim().length > 0}
							Search Results
							{#if isSearchResultsEmpty && !loadingPosts}
								<span class="results-empty-pill">(empty)</span>
							{/if}
						{:else}
							Recent Posts
						{/if}
					</h2>
					<label class="sort-toggle" aria-label="Sort search results">
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
					</label>
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

			{#if loadingPosts}
				<p class="muted">Loading posts...</p>
			{:else if feedError}
				<p class="warning"><CircleAlert size={15} /> {feedError}</p>
			{:else if visiblePosts().length === 0}
				{#if searchTerm.trim().length > 0}
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

	.sort-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: 0.35rem;
		font-size: 0.8rem;
		color: #5f665f;
		user-select: none;
	}

	.sort-toggle input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.sort-slider {
		position: relative;
		width: 38px;
		height: 21px;
		border-radius: 999px;
		background: rgba(129, 129, 129, 0.36);
		transition: background 0.16s ease;
	}

	.sort-slider::after {
		content: "";
		position: absolute;
		top: 2px;
		left: 2px;
		width: 17px;
		height: 17px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
		transition: transform 0.16s ease;
	}

	.sort-toggle input:checked + .sort-slider {
		background: #3b6e4f;
	}

	.sort-toggle input:checked + .sort-slider::after {
		transform: translateX(17px);
	}

	.sort-label {
		white-space: nowrap;
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

	.load-more-indicator {
		text-align: center;
		padding: 0.5rem 0;
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

	@media (max-width: 640px) {
		.post-list-mosaic {
			flex-direction: column;
		}

		.feed-header {
			flex-wrap: wrap;
		}
	}
</style>
