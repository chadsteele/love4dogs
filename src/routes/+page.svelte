<script>
	import {onMount} from "svelte"
	import {isLocalHost} from "$lib/utils"
	import {CircleAlert, Map as MapIcon} from "lucide-svelte"
	import About from "$lib/About.svelte"
	import PostCard from "$lib/PostCard.svelte"
	import NavBar from "$lib/NavBar.svelte"

	const ACCOUNT_HANDLE = "love4dogs.club"
	const LOCAL_TAG_KEY = "love4dogs.tag-counts"
	const LOCAL_MY_POSTS_KEY = "love4dogs.my-post-uris"
	const BOOKMARK_KEY = "love4dogs.bookmarks"
	const TRASH_KEY = "love4dogs.trash"
	const ABOUT_MODAL_SEEN_KEY = "love4dogs.about-modal-seen-at"
	const ABOUT_PAGE_VISIT_KEY = "love4dogs.about-page-visited-at"
	const ABOUT_MODAL_WINDOW_MS = 36 * 60 * 60 * 1000
	const MAX_SAVED_ITEMS = 100

	let posts = $state([])
	let recentTags = $state([])
	let localTopTags = $state([])
	let searchTerm = $state("")
	let loadingPosts = $state(false)
	let feedError = $state("")
	let bookmarkedUris = $state([])
	let trashedUris = $state([])
	let selectedUris = $state([])
	let selectionMenuOpen = $state(false)
	let currentView = $state("feed")
	let tagCloudSignal = $state(0)
	let myPostUris = $state([])
	let myPostsByUri = $state({})
	let loadingHistory = $state(false)
	let showAboutModal = $state(false)
	let searchSort = $state("latest")
	let loadingMore = $state(false)
	let feedCursor = null
	let hasMorePosts = $state(true)

	let searchDebounceTimer = null
	let lastFeedRequestId = 0

	function cappedUniqueList(values = []) {
		const cleaned = []
		for (const value of values) {
			if (typeof value !== "string") continue
			const next = value.trim()
			if (!next || cleaned.includes(next)) continue
			cleaned.push(next)
			if (cleaned.length === MAX_SAVED_ITEMS) break
		}
		return cleaned
	}

	function readStoredList(key) {
		if (typeof window === "undefined") return []
		try {
			const parsed = JSON.parse(localStorage.getItem(key) || "[]")
			return cappedUniqueList(Array.isArray(parsed) ? parsed : [])
		} catch {
			return []
		}
	}

	function saveStoredList(key, list) {
		if (typeof window === "undefined") return
		localStorage.setItem(key, JSON.stringify(cappedUniqueList(list)))
	}

	function readTimestamp(key) {
		if (typeof window === "undefined") return 0
		const raw = localStorage.getItem(key)
		const parsed = Number(raw)
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
	}

	function hasRecentTimestamp(key) {
		const ts = readTimestamp(key)
		if (!ts) return false
		return Date.now() - ts < ABOUT_MODAL_WINDOW_MS
	}

	function evaluateAboutModalVisibility() {
		const seenRecently = hasRecentTimestamp(ABOUT_MODAL_SEEN_KEY)
		const visitedAboutRecently = hasRecentTimestamp(ABOUT_PAGE_VISIT_KEY)
		showAboutModal = !seenRecently && !visitedAboutRecently
	}

	function closeAboutModal() {
		showAboutModal = false
		if (typeof window === "undefined") return
		localStorage.setItem(ABOUT_MODAL_SEEN_KEY, String(Date.now()))
	}

	function openAboutModal() {
		showAboutModal = true
	}

	function loadLocalTagCounts() {
		if (typeof window === "undefined") return

		try {
			const parsed = JSON.parse(
				localStorage.getItem(LOCAL_TAG_KEY) || "{}",
			)
			localTopTags = Object.entries(parsed)
				.filter(([, count]) => Number.isFinite(count) && count > 0)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 20)
				.map(([tag, count]) => ({tag, count}))
		} catch {
			localTopTags = []
		}
	}

	function storeRecentTag(tag) {
		if (typeof window === "undefined") return
		const normalized = String(tag || "")
			.trim()
			.toLowerCase()
			.replace(/^#/, "")
			.replace(/[^\p{L}\p{N}_-]+/gu, "")
		if (!normalized) return

		try {
			const counts = JSON.parse(
				localStorage.getItem(LOCAL_TAG_KEY) || "{}",
			)
			counts[normalized] = (Number(counts[normalized]) || 0) + 1
			localStorage.setItem(LOCAL_TAG_KEY, JSON.stringify(counts))
			loadLocalTagCounts()
		} catch {
			// Ignore storage errors.
		}
	}

	async function loadFeed() {
		const requestId = ++lastFeedRequestId
		loadingPosts = true
		feedError = ""
		feedCursor = null
		hasMorePosts = true

		try {
			const query = searchTerm.trim()
			const params = new URLSearchParams({
				query,
				sort: searchSort,
				limit: 20,
			})
			const res = await fetch(`/api/feed?${params.toString()}`)
			const json = await res.json()

			if (!res.ok) {
				throw new Error(json.error || "Could not load posts.")
			}

			if (requestId !== lastFeedRequestId) return

			posts = json.posts || []
			recentTags = json.commonRecentTags || []
			feedCursor = json.cursor || null
			hasMorePosts = !!json.cursor
			console.log(
				"[loadFeed] loaded posts:",
				posts.length,
				"cursor:",
				feedCursor,
				"hasMorePosts:",
				hasMorePosts,
			)
		} catch (error) {
			if (requestId !== lastFeedRequestId) return
			feedError = error.message || "Failed loading feed."
		} finally {
			if (requestId === lastFeedRequestId) loadingPosts = false
		}
	}

	async function loadMorePosts() {
		console.log("[loadMorePosts] check:", {
			loadingMore,
			feedCursor,
			hasMorePosts,
		})
		if (loadingMore || !feedCursor || !hasMorePosts) {
			console.log("[loadMorePosts] blocked by conditions")
			return
		}

		console.log("[loadMorePosts] starting fetch")
		loadingMore = true
		const requestId = lastFeedRequestId

		try {
			const query = searchTerm.trim()
			const params = new URLSearchParams({
				query,
				sort: searchSort,
				limit: 20,
				cursor: feedCursor,
			})
			console.log(
				"[loadMorePosts] fetch url:",
				`/api/feed?${params.toString()}`,
			)
			const res = await fetch(`/api/feed?${params.toString()}`)
			const json = await res.json()

			if (!res.ok) {
				throw new Error(json.error || "Could not load more posts.")
			}

			if (requestId !== lastFeedRequestId) return

			console.log(
				"[loadMorePosts] success, got posts:",
				json.posts?.length,
			)
			posts = [...posts, ...(json.posts || [])]
			feedCursor = json.cursor || null
			hasMorePosts = !!json.cursor
			console.log("[loadMorePosts] updated cursor and hasMorePosts:", {
				feedCursor,
				hasMorePosts,
				totalPosts: posts.length,
			})
		} catch (error) {
			console.log("[loadMorePosts] error:", error.message)
			if (requestId !== lastFeedRequestId) return
			// Silently fail on load more, don't show error to user
		} finally {
			loadingMore = false
			console.log("[loadMorePosts] finished, loadingMore set to false")
		}
	}

	function isValidAtUri(value = "") {
		return /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/?#]+$/i.test(
			String(value || "").trim(),
		)
	}

	function loadMyPostUris() {
		const uris = readStoredList(LOCAL_MY_POSTS_KEY)
		return uris.filter((uri) => isValidAtUri(uri))
	}

	async function fetchPostByUri(uri = "") {
		const res = await fetch(`/api/post?uri=${encodeURIComponent(uri)}`)
		const json = await res.json().catch(() => ({}))
		if (!res.ok) {
			throw new Error(json.error || "Unable to load post.")
		}
		return json.post
	}

	async function hydrateMyPosts(uris = []) {
		const missing = uris.filter((uri) => uri && !myPostsByUri[uri])
		if (!missing.length) return

		loadingHistory = true
		const updates = {}
		for (const uri of missing) {
			try {
				const post = await fetchPostByUri(uri)
				updates[uri] = {
					...post,
					uri,
					likeCount: Number(post.likeCount) || 0,
					repostCount: Number(post.repostCount) || 0,
					replyCount: Number(post.replyCount) || 0,
					comments: Array.isArray(post.comments) ? post.comments : [],
				}
			} catch {
				// Keep rendering even if some saved posts are unavailable.
			}
		}

		if (Object.keys(updates).length) {
			myPostsByUri = {...myPostsByUri, ...updates}
		}
		loadingHistory = false
	}

	function visiblePosts() {
		if (currentView === "history") {
			return myPostUris.map((uri) => {
				return (
					myPostsByUri[uri] || {
						uri,
						text: "Post unavailable. It may have been deleted from Bluesky.",
						createdAt: null,
						images: [],
						video: null,
						facets: [],
						comments: [],
						likeCount: 0,
						repostCount: 0,
						replyCount: 0,
					}
				)
			})
		}

		if (currentView === "trash") {
			return posts.filter((post) => trashedUris.includes(post.uri))
		}

		if (currentView === "bookmarks") {
			return posts.filter((post) => bookmarkedUris.includes(post.uri))
		}

		if (!trashedUris.length) return posts
		return posts.filter((post) => !trashedUris.includes(post.uri))
	}

	function allVisibleSelected() {
		const uris = visiblePosts().map((post) => post.uri)
		return (
			uris.length > 0 && uris.every((uri) => selectedUris.includes(uri))
		)
	}

	function toggleCardSelection(uri) {
		if (selectedUris.includes(uri)) {
			selectedUris = selectedUris.filter((item) => item !== uri)
		} else {
			selectedUris = [...selectedUris, uri]
		}

		if (selectedUris.length === 0) selectionMenuOpen = false
	}

	function toggleSelectAllVisible() {
		const visibleUris = visiblePosts().map((post) => post.uri)
		if (visibleUris.length === 0) return

		if (allVisibleSelected()) {
			selectedUris = selectedUris.filter(
				(uri) => !visibleUris.includes(uri),
			)
			if (selectedUris.length === 0) selectionMenuOpen = false
			return
		}

		selectedUris = cappedUniqueList([...selectedUris, ...visibleUris])
	}

	function setView(view) {
		currentView = view
		selectedUris = []
		selectionMenuOpen = false
		if (view === "history") {
			hydrateMyPosts(myPostUris)
		}
	}

	async function applySelectionAction(action) {
		if (!selectedUris.length) return

		if (action === "deleteRemote") {
			const urisToDelete = [...selectedUris]
			const confirmed = window.confirm(
				`Delete ${urisToDelete.length} selected post(s) from Bluesky? This cannot be undone.`,
			)
			if (!confirmed) return

			try {
				const res = await fetch("/api/post", {
					method: "DELETE",
					headers: {"content-type": "application/json"},
					body: JSON.stringify({uris: urisToDelete}),
				})
				const json = await res.json().catch(() => ({}))

				if (!res.ok || !json.ok) {
					throw new Error(
						json.error ||
							"Failed to delete selected posts from Bluesky.",
					)
				}

				const deletedUris = Array.isArray(json.deleted)
					? json.deleted
					: urisToDelete

				posts = posts.filter((post) => !deletedUris.includes(post.uri))
				bookmarkedUris = bookmarkedUris.filter(
					(uri) => !deletedUris.includes(uri),
				)
				trashedUris = trashedUris.filter(
					(uri) => !deletedUris.includes(uri),
				)
				saveStoredList(BOOKMARK_KEY, bookmarkedUris)
				saveStoredList(TRASH_KEY, trashedUris)
			} catch (error) {
				feedError =
					error.message || "Failed deleting posts from Bluesky."
			}

			selectedUris = []
			selectionMenuOpen = false
			return
		}

		if (action === "bookmark") {
			bookmarkedUris = cappedUniqueList([
				...selectedUris,
				...bookmarkedUris,
			])
			saveStoredList(BOOKMARK_KEY, bookmarkedUris)
		}

		if (action === "trash") {
			trashedUris = cappedUniqueList([...selectedUris, ...trashedUris])
			saveStoredList(TRASH_KEY, trashedUris)
		}

		if (action === "restore") {
			trashedUris = trashedUris.filter(
				(uri) => !selectedUris.includes(uri),
			)
			saveStoredList(TRASH_KEY, trashedUris)
		}

		if (action === "unbookmark") {
			bookmarkedUris = bookmarkedUris.filter(
				(uri) => !selectedUris.includes(uri),
			)
			saveStoredList(BOOKMARK_KEY, bookmarkedUris)
		}

		selectedUris = []
		selectionMenuOpen = false
	}

	function toggleSearchTag(tag) {
		const normalized = String(tag || "")
			.trim()
			.replace(/^#/, "")
			.toLowerCase()
		if (!normalized) return

		storeRecentTag(normalized)

		const current = searchTerm.split(/\s+/).filter(Boolean)
		const next = current.filter(
			(token) => token.toLowerCase().replace(/^#/, "") !== normalized,
		)

		if (next.length === current.length) next.push(normalized)

		searchTerm = next.join(" ")
		tagCloudSignal += 1
	}

	const isSearchResultsEmpty = $derived(
		currentView === "feed" &&
			searchTerm.trim().length > 0 &&
			visiblePosts().length === 0,
	)

	let observer = null

	onMount(() => {
		loadLocalTagCounts()
		bookmarkedUris = readStoredList(BOOKMARK_KEY)
		trashedUris = readStoredList(TRASH_KEY)
		evaluateAboutModalVisibility()
		loadFeed()
		myPostUris = loadMyPostUris()
		hydrateMyPosts(myPostUris)

		return () => {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
			if (observer) observer.disconnect()
		}
	})

	$effect(() => {
		if (posts.length === 0) return

		const postList = document.querySelector(".post-list")
		console.log("[effect] postList element:", postList)

		if (!postList) return

		if (observer) observer.disconnect()

		observer = new IntersectionObserver(
			(entries) => {
				console.log("[IntersectionObserver] triggered:", {
					isIntersecting: entries[0].isIntersecting,
					loadingMore,
					hasMorePosts,
				})
				if (entries[0].isIntersecting && !loadingMore && hasMorePosts) {
					console.log("[IntersectionObserver] calling loadMorePosts")
					loadMorePosts()
				}
			},
			{threshold: 0.1},
		)
		observer.observe(postList)
		console.log("[effect] observer set up and observing postList")
	})
</script>

<svelte:head>
	<title>Love4Dogs on Bluesky</title>
</svelte:head>

<main class="page">
	{#if showAboutModal}
		<div
			class="about-modal-backdrop"
			role="button"
			tabindex="0"
			aria-label="Close about modal"
			onclick={closeAboutModal}
			onkeydown={(event) => {
				if (event.key === "Enter" || event.key === " ")
					closeAboutModal()
			}}
		>
			<div
				class="about-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="about-modal-title"
				tabindex="-1"
				onclick={(event) => event.stopPropagation()}
				onkeydown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.stopPropagation()
					}
				}}
			>
				<div id="about-modal-title">
					<About mode="modal" onClose={closeAboutModal} />
				</div>
			</div>
		</div>
	{/if}

	<NavBar
		bind:searchTerm
		bind:selectionMenuOpen
		showSearch={true}
		historyCount={myPostUris.length}
		selectedCount={selectedUris.length}
		{currentView}
		bookmarkedCount={bookmarkedUris.length}
		trashedCount={trashedUris.length}
		onSetView={setView}
		onSelectionAction={applySelectionAction}
		onOpenAbout={openAboutModal}
		onSearchSubmit={() => {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
			loadFeed()
		}}
		onSearchInput={() => {
			if (!searchTerm.trim()) loadFeed()
		}}
	/>

	<section class="grid">
		<article class="panel feed">
			<div class="feed-header">
				<div class="feed-header-left">
					<button
						type="button"
						class="select-all-btn"
						class:is-active={allVisibleSelected()}
						onclick={toggleSelectAllVisible}
						disabled={visiblePosts().length === 0}
						aria-label={allVisibleSelected()
							? "Unselect all visible cards"
							: "Select all visible cards"}
					>
						<span class="select-all-dot"
							>{allVisibleSelected() ? "✓" : ""}</span
						>
					</button>
					<h2>
						{#if currentView === "history"}
							History
						{:else if currentView === "trash"}
							Trash
						{:else if currentView === "bookmarks"}
							Favorites
						{:else if searchTerm.trim().length > 0}
							Search Results
							{#if isSearchResultsEmpty}
								<span class="results-empty-pill">(empty)</span>
							{/if}
						{:else}
							Recent Posts
						{/if}
					</h2>
					{#if currentView === "feed"}
						<label
							class="sort-toggle"
							aria-label="Sort search results"
						>
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
					{/if}
				</div>
				{#if currentView === "feed"}
					<a href="/map" class="map-view-btn">
						<MapIcon size={14} /> Map View
					</a>
				{/if}
			</div>

			{#if loadingPosts || (currentView === "history" && loadingHistory)}
				<p class="muted">Loading posts...</p>
			{:else if feedError}
				<p class="warning"><CircleAlert size={15} /> {feedError}</p>
			{:else if visiblePosts().length === 0}
				{#if searchTerm.trim().length > 0 && currentView === "feed"}
					<p class="muted">No posts match this search.</p>
					<p class="muted empty-search-results">
						Search Results: empty
					</p>
				{:else}
					<p class="muted">No posts match this view.</p>
				{/if}
			{:else}
				<div class="post-list">
					{#each visiblePosts() as post}
						<PostCard
							{post}
							selected={selectedUris.includes(post.uri)}
							bookmarked={bookmarkedUris.includes(post.uri)}
							onToggleSelect={toggleCardSelection}
							onToggleSearchTag={toggleSearchTag}
						/>
					{/each}
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
		vertical-align: top;
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
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
	}

	.feed-header-left {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 10px;
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

	.results-empty-pill {
		margin-left: 0.35rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: #8e2f21;
	}

	.select-all-btn {
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
	}

	.select-all-btn.is-active {
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}

	.select-all-dot {
		font-size: 0.85rem;
		line-height: 1;
		font-weight: 700;
	}

	.select-all-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.muted {
		color: #5f665f;
		margin: 0.45rem 0 0.85rem;
	}

	.empty-search-results {
		margin-top: -0.45rem;
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
		column-gap: 0.8rem;
	}

	.about-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(16, 20, 15, 0.58);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 60;
	}

	.about-modal {
		position: relative;
		display: flex;
		flex-direction: column;
		width: min(580px, 100%);
		max-height: min(80vh, 100%);
		overflow-y: auto;
		background: rgba(255, 250, 241, 0.97);
		border: 1px solid rgba(58, 91, 65, 0.24);
		border-radius: 16px;
		box-shadow: 0 18px 45px rgba(65, 42, 20, 0.28);
		padding: 1rem 1rem 0.9rem;
	}

	@media (max-width: 900px) {
		.grid {
			grid-template-columns: 1fr;
		}

		.post-list {
			column-count: 1;
		}

		.about-modal-backdrop {
			padding: 0.5rem;
		}
	}
</style>
