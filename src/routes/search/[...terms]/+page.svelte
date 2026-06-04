<script>
	import {onMount} from "svelte"
	import {page} from "$app/state"
	import {goto} from "$app/navigation"
	import {CircleAlert, Map as MapIcon, RefreshCw} from "lucide-svelte"
	import OneCard from "$lib/OneCard.svelte"
	import NavBar from "$lib/NavBar.svelte"
	import {readSearchTerm, writeSearchTerm} from "$lib/searchStore"

	const FAVORITE_SEARCH_TERMS_KEY =
		"love4dogs.settings.favorite-search-terms-v1"
	const DEFAULT_SEARCH_TERM_KEY = "love4dogs.settings.default-search-term-v1"

	let posts = $state([])
	let searchTerm = $state("")
	let loadingPosts = $state(false)
	let feedError = $state("")
	let searchSort = $state("latest")
	let loadingMore = $state(false)
	let feedCursor = null
	let feedCursorHost = null
	let hasMorePosts = $state(true)
	let favoriteSearchTerms = $state([])
	let currentView = $state("feed")

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

	function readFavoriteSearchTerms() {
		if (typeof window === "undefined") return []
		try {
			const parsed = JSON.parse(
				localStorage.getItem(FAVORITE_SEARCH_TERMS_KEY) || "[]",
			)
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

	function readDefaultSearchTerm() {
		if (typeof window === "undefined") return ""
		return normalizeSearchTerm(
			localStorage.getItem(DEFAULT_SEARCH_TERM_KEY) || "",
		)
	}

	function buildFeedQuery(rawQuery = "") {
		return String(rawQuery || "").trim()
	}

	function getSearchTokens(value = "") {
		return normalizeSearchTerm(value).split(" ").filter(Boolean)
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

	function visiblePosts() {
		const seen = new Set()
		const next = []
		for (const post of posts) {
			const key = String(post?.displayKey || post?.uri || "").trim()
			if (!key || seen.has(key)) continue
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
		const normalized = normalizeSearchTerm(term)
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
		} catch (error) {
			if (requestId !== lastFeedRequestId) return
			feedError = error.message || "Failed loading feed."
		} finally {
			if (requestId === lastFeedRequestId) loadingPosts = false
		}
	}

	async function loadMorePosts() {
		if (loadingMore || !feedCursor || !hasMorePosts) return

		loadingMore = true
		const requestId = lastFeedRequestId

		try {
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

			posts = [...posts, ...(json.posts || [])]
			feedCursor = json.cursor || null
			feedCursorHost = json.cursorHost || feedCursorHost || null
			hasMorePosts = !!json.cursor
		} catch {
			// Silently fail on load more
		} finally {
			loadingMore = false
		}
	}

	function setView(view = "feed") {
		currentView = String(view || "feed")
	}

	const isSearchResultsEmpty = $derived(
		searchTerm.trim().length > 0 && visiblePosts().length === 0,
	)

	onMount(() => {
		favoriteSearchTerms = readFavoriteSearchTerms()

		// Seed search from URL params, then ?q=, then localStorage, then default
		const qParam = new URLSearchParams(window.location.search).get("q")
		if (urlTerms) {
			searchTerm = urlTerms
		} else if (qParam) {
			searchTerm = normalizeSearchTerm(qParam)
		} else {
			const savedTerm = readSearchTerm()
			searchTerm = savedTerm || readDefaultSearchTerm()
		}

		loadFeed()

		return () => {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
		}
	})

	// Persist search term to localStorage whenever it changes
	$effect(() => {
		writeSearchTerm(searchTerm)
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
				<div class="feed-header-actions">
					<button
						type="button"
						class="refresh-feed-btn"
						onclick={() => loadFeed({forceFresh: true})}
						disabled={loadingPosts}
						aria-label="Refresh search results from Bluesky"
						title="Refresh from Bluesky"
					>
						<RefreshCw size={14} />
					</button>
					<a href="/map" class="map-view-btn">
						<MapIcon size={14} /> Map View
					</a>
				</div>
			</div>

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
				<div class="post-list">
					{#each visiblePosts() as post (post.displayKey || post.uri)}
						<OneCard {post} onTagClick={toggleSearchTag} />
					{/each}
				</div>
			{/if}

			{#if loadingMore}
				<p class="muted load-more-indicator">Loading more...</p>
			{:else if hasMorePosts && !loadingPosts && visiblePosts().length > 0}
				<div class="load-more-actions">
					<button
						type="button"
						class="load-more-btn"
						onclick={loadMorePosts}
					>
						More
					</button>
				</div>
			{/if}
		</article>
	</section>
</main>

<style>
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

	.feed-header-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
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

	.map-view-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		font-size: 0.8rem;
		font-weight: 600;
		color: #305741;
		background: rgba(59, 110, 79, 0.1);
		border: 1px solid rgba(59, 110, 79, 0.3);
		border-radius: 999px;
		padding: 0.2rem 0.65rem;
		text-decoration: none;
		white-space: nowrap;
	}

	.map-view-btn:hover {
		background: rgba(59, 110, 79, 0.2);
		border-color: #305741;
	}

	.refresh-feed-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 999px;
		border: 1px solid rgba(59, 110, 79, 0.3);
		background: rgba(59, 110, 79, 0.1);
		color: #305741;
		cursor: pointer;
	}

	.refresh-feed-btn:hover {
		background: rgba(59, 110, 79, 0.2);
		border-color: #305741;
	}

	.refresh-feed-btn:disabled {
		opacity: 0.5;
		cursor: default;
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

	.post-list {
		columns: 2;
		column-gap: 0.9rem;
	}

	@media (max-width: 1000px) {
		.post-list {
			columns: 2;
		}
	}

	@media (max-width: 640px) {
		.post-list {
			columns: 1;
		}

		.feed-header {
			flex-wrap: wrap;
		}
	}
</style>
