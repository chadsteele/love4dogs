<script>
	import {onMount} from "svelte"
	import {gpsToHash} from "$lib/utils"
	import {
		CircleAlert,
		Hash,
		Heart,
		ImagePlus,
		MapPin,
		MessageCircle,
		PawPrint,
		Repeat2,
		Search,
		Send,
	} from "lucide-svelte"

	const ACCOUNT_HANDLE = "mylove4dogs.bsky.social"
	const LOCAL_TAG_KEY = "love4dogs.tag-counts"
	const MAX_CHARS = 300
	const MAP_BASE_URL = "https://love4dogs.com/map"

	let posts = $state([])
	let recentTags = $state([])
	let localTopTags = $state([])
	let searchTerm = $state("")
	let loadingPosts = $state(false)
	let feedError = $state("")

	let draft = $state("")
	let selectedFiles = $state([])
	let previews = $state([])
	let selectedLocation = $state(null)
	let locationError = $state("")
	let posting = $state(false)
	let postError = $state("")
	let postSuccess = $state("")
	let logoLoaded = $state(true)
	let isDraggingFiles = $state(false)

	let searchDebounceTimer = null
	let lastFeedRequestId = 0

	function extractHashtags(text = "") {
		const matches = text.match(/(^|\s)#([\p{L}\p{N}_-]+)/gu) || []
		return matches.map((tag) => tag.replace(/^[\s#]+/, "").toLowerCase())
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

	function incrementLocalTags(tags) {
		if (typeof window === "undefined" || !tags.length) return

		const counts = JSON.parse(localStorage.getItem(LOCAL_TAG_KEY) || "{}")
		for (const tag of tags) {
			counts[tag] = (counts[tag] || 0) + 1
		}

		localStorage.setItem(LOCAL_TAG_KEY, JSON.stringify(counts))
		loadLocalTagCounts()
	}

	async function loadFeed() {
		const requestId = ++lastFeedRequestId
		loadingPosts = true
		feedError = ""

		try {
			const query = searchTerm.trim()
			const res = await fetch(
				`/api/feed?query=${encodeURIComponent(query)}`,
			)
			const json = await res.json()

			if (!res.ok) {
				throw new Error(json.error || "Could not load posts.")
			}

			if (requestId !== lastFeedRequestId) {
				return
			}

			posts = json.posts || []
			recentTags = json.commonRecentTags || []
		} catch (error) {
			if (requestId !== lastFeedRequestId) {
				return
			}

			feedError = error.message || "Failed loading feed."
		} finally {
			if (requestId === lastFeedRequestId) {
				loadingPosts = false
			}
		}
	}

	function updatePreviews() {
		for (const old of previews) {
			URL.revokeObjectURL(old.url)
		}

		previews = selectedFiles.map((file) => ({
			name: file.name,
			url: URL.createObjectURL(file),
		}))
	}

	function addImages(files) {
		const nextFiles = files.filter(
			(file) => file instanceof File && file.type.startsWith("image/"),
		)

		if (!nextFiles.length) {
			return
		}

		const dedupe = new Map()
		for (const file of [...selectedFiles, ...nextFiles]) {
			const key = `${file.name}-${file.size}-${file.lastModified}`
			if (!dedupe.has(key)) {
				dedupe.set(key, file)
			}
		}

		const merged = [...dedupe.values()]
		if (merged.length > 4) {
			postError = "Only 4 photos are allowed."
		}

		selectedFiles = merged.slice(0, 4)
		updatePreviews()
	}

	function handleFiles(event) {
		postError = ""
		const files = [...(event.currentTarget.files || [])]
		addImages(files)
		event.currentTarget.value = ""
	}

	function onDragOver(event) {
		event.preventDefault()
		isDraggingFiles = true
	}

	function onDragLeave(event) {
		event.preventDefault()
		isDraggingFiles = false
	}

	function onDropFiles(event) {
		event.preventDefault()
		isDraggingFiles = false
		postError = ""
		addImages([...(event.dataTransfer?.files || [])])
	}

	function clearFiles() {
		for (const preview of previews) {
			URL.revokeObjectURL(preview.url)
		}
		selectedFiles = []
		previews = []
	}

	function useLocation() {
		locationError = ""

		if (!navigator.geolocation) {
			locationError = "Location services are unavailable in this browser."
			return
		}

		navigator.geolocation.getCurrentPosition(
			(position) => {
				selectedLocation = {
					lat: Number(position.coords.latitude).toFixed(5),
					lon: Number(position.coords.longitude).toFixed(5),
				}
			},
			() => {
				selectedLocation = null
				locationError =
					"Turn on location services to use the pin feature."
			},
			{enableHighAccuracy: true, timeout: 8000},
		)
	}

	function buildPostText() {
		const cleanText = draft.trim()
		if (!selectedLocation) return cleanText

		const hash = gpsToHash(
			Number(selectedLocation.lat),
			Number(selectedLocation.lon),
		)
		if (!hash) return cleanText

		const geo = `\n\n📍 ${MAP_BASE_URL}/${hash}`
		return `${cleanText}${geo}`
	}

	async function submitPost() {
		postError = ""
		postSuccess = ""
		const finalText = buildPostText()

		if (!finalText.trim()) {
			postError = "Write something before posting."
			return
		}

		if ([...finalText].length > MAX_CHARS) {
			postError = `Post exceeds ${MAX_CHARS} characters with location included.`
			return
		}

		if (selectedFiles.length > 4) {
			postError = "Only 4 photos are allowed."
			return
		}

		posting = true
		try {
			const formData = new FormData()
			formData.append("text", finalText)
			for (const file of selectedFiles) formData.append("images", file)

			const res = await fetch("/api/post", {
				method: "POST",
				body: formData,
			})
			const json = await res.json()

			if (!res.ok) {
				throw new Error(json.error || "Failed to publish post.")
			}

			incrementLocalTags(extractHashtags(finalText))
			draft = ""
			selectedLocation = null
			clearFiles()
			postSuccess = "Post published successfully."
			await loadFeed()
		} catch (error) {
			postError = error.message || "Unable to post right now."
		} finally {
			posting = false
		}
	}

	function remainingChars() {
		return MAX_CHARS - [...buildPostText()].length
	}

	function queueLiveSearch() {
		if (searchDebounceTimer) {
			clearTimeout(searchDebounceTimer)
		}

		searchDebounceTimer = setTimeout(() => {
			loadFeed()
		}, 350)
	}

	onMount(() => {
		loadLocalTagCounts()
		loadFeed()

		return () => {
			if (searchDebounceTimer) {
				clearTimeout(searchDebounceTimer)
			}

			for (const preview of previews) {
				URL.revokeObjectURL(preview.url)
			}
		}
	})
</script>

<svelte:head>
	<title>Love4Dogs on Bluesky</title>
</svelte:head>

<main class="page">
	<nav class="topbar">
		<div class="brand">
			<div class="logo-wrap">
				{#if logoLoaded}
					<img
						class="logo"
						src="/dog-logo.jpg"
						alt="Love4Dogs logo"
						onerror={() => (logoLoaded = false)}
					/>
				{:else}
					<span class="logo-fallback"><PawPrint size={20} /></span>
				{/if}
			</div>
			<div>
				<p class="kicker">Bluesky dogboard</p>
				<h1>Love4Dogs</h1>
			</div>
		</div>

		<form
			class="search"
			onsubmit={(event) => {
				event.preventDefault()
				if (searchDebounceTimer) {
					clearTimeout(searchDebounceTimer)
				}
				loadFeed()
			}}
		>
			<Search size={18} />
			<input
				type="search"
				bind:value={searchTerm}
				oninput={queueLiveSearch}
				placeholder={`Search ${ACCOUNT_HANDLE} posts`}
			/>
			<button type="submit">Search</button>
		</form>
	</nav>

	<section class="grid">
		<article class="panel compose">
			<h2>Write a post</h2>
			<p class="muted">
				Authenticated posting via your .env account with up to 4 photos.
			</p>

			<textarea
				bind:value={draft}
				placeholder="Share your dog moment... #doggo"
				rows="6"
			></textarea>

			<div class="toolbar">
				<label class="icon-btn file-btn" for="images">
					<ImagePlus size={17} />
					<span>Add photos</span>
				</label>
				<input
					id="images"
					type="file"
					accept="image/*"
					multiple
					onchange={handleFiles}
				/>

				<button class="icon-btn" type="button" onclick={useLocation}>
					<MapPin size={17} />
					<span>{selectedLocation ? "Location set" : "Use pin"}</span>
				</button>

				<button
					class="post-btn"
					type="button"
					onclick={submitPost}
					disabled={posting}
				>
					<Send size={16} />
					<span>{posting ? "Posting..." : "Post now"}</span>
				</button>
			</div>

			<div
				class="dropzone"
				class:is-dragging={isDraggingFiles}
				role="region"
				aria-label="Image upload dropzone"
				ondragover={onDragOver}
				ondragleave={onDragLeave}
				ondrop={onDropFiles}
			>
				<ImagePlus size={16} />
				<p>Drag and drop up to 4 photos here</p>
			</div>

			{#if locationError}
				<p class="warning"><CircleAlert size={15} /> {locationError}</p>
			{/if}

			{#if postError}
				<p class="warning"><CircleAlert size={15} /> {postError}</p>
			{/if}

			{#if postSuccess}
				<p class="success">{postSuccess}</p>
			{/if}

			<p class="counter" class:danger={remainingChars() < 0}>
				{remainingChars()} chars left
			</p>

			{#if previews.length}
				<div class="preview-grid">
					{#each previews as item}
						<img src={item.url} alt={item.name} />
					{/each}
				</div>
			{/if}
		</article>

		<article class="panel analytics">
			<h2><Hash size={18} /> Common tags in last 20 posts</h2>
			<ul>
				{#if recentTags.length === 0}
					<li>No tags found yet.</li>
				{:else}
					{#each recentTags as item}
						<li>
							<span>#{item.tag}</span><strong>{item.count}</strong
							>
						</li>
					{/each}
				{/if}
			</ul>

			<h2><Hash size={18} /> Top 20 local tags you use</h2>
			<ul>
				{#if localTopTags.length === 0}
					<li>No local tag history yet.</li>
				{:else}
					{#each localTopTags as item}
						<li>
							<span>#{item.tag}</span><strong>{item.count}</strong
							>
						</li>
					{/each}
				{/if}
			</ul>
		</article>

		<article class="panel feed">
			<h2>Posts by {ACCOUNT_HANDLE}</h2>

			{#if loadingPosts}
				<p class="muted">Loading posts...</p>
			{:else if feedError}
				<p class="warning"><CircleAlert size={15} /> {feedError}</p>
			{:else if posts.length === 0}
				<p class="muted">No posts match this search.</p>
			{:else}
				<div class="post-list">
					{#each posts as post}
						<article class="post-card">
							<p>{post.text}</p>
							{#if post.images.length}
								<div class="post-images">
									{#each post.images as image}
										<img
											src={image}
											alt="Dog post"
											loading="lazy"
										/>
									{/each}
								</div>
							{/if}
							<div class="meta">
								<small
									>{new Date(
										post.createdAt,
									).toLocaleString()}</small
								>
								<div class="stats">
									<span
										><MessageCircle size={14} />
										{post.replyCount}</span
									>
									<span
										><Repeat2 size={14} />
										{post.repostCount}</span
									>
									<span
										><Heart size={14} />
										{post.likeCount}</span
									>
								</div>
							</div>
						</article>
					{/each}
				</div>
			{/if}
		</article>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: "Avenir Next", "Trebuchet MS", sans-serif;
		background: radial-gradient(
				circle at 12% 5%,
				rgba(227, 172, 118, 0.35),
				transparent 35%
			),
			radial-gradient(
				circle at 88% 25%,
				rgba(73, 120, 83, 0.24),
				transparent 40%
			),
			linear-gradient(135deg, #f6ebde, #dce8da 55%, #b9d0bc);
		color: #2b1f17;
	}

	.page {
		max-width: 1120px;
		margin: 0 auto;
		padding: 1rem;
	}

	.topbar {
		position: sticky;
		top: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
		align-items: center;
		padding: 0.8rem 1rem;
		margin-bottom: 1rem;
		background: rgba(246, 240, 230, 0.84);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(96, 71, 49, 0.18);
		border-radius: 16px;
		z-index: 10;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.logo-wrap {
		position: relative;
		width: 54px;
		height: 54px;
		border-radius: 50%;
		overflow: hidden;
		border: 2px solid #8f633f;
		box-shadow: 0 8px 20px rgba(31, 44, 30, 0.25);
		background: #ca8f56;
	}

	.logo {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.logo-fallback {
		position: absolute;
		inset: 0;
		margin: auto;
		color: #f7f2e8;
	}

	.kicker {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.7rem;
		color: #6f5b47;
	}

	h1 {
		margin: 0.15rem 0 0;
		font-size: 1.35rem;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.55rem;
		border-radius: 999px;
		background: #fffdf8;
		border: 1px solid rgba(48, 80, 54, 0.2);
		min-width: min(100%, 470px);
	}

	.search input {
		border: none;
		outline: none;
		background: transparent;
		flex: 1;
		font-size: 0.95rem;
	}

	.search button {
		border: none;
		background: #436f4f;
		color: #fff;
		padding: 0.5rem 0.95rem;
		border-radius: 999px;
		font-weight: 600;
		cursor: pointer;
	}

	.grid {
		display: grid;
		grid-template-columns: 1.1fr 0.9fr;
		gap: 1rem;
	}

	.panel {
		background: rgba(255, 250, 241, 0.88);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 1rem;
		box-shadow: 0 10px 26px rgba(65, 42, 20, 0.12);
	}

	.compose,
	.feed {
		grid-column: 1 / 2;
	}

	.analytics {
		grid-column: 2 / 3;
		grid-row: 1 / 3;
	}

	h2 {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		font-size: 1rem;
	}

	.muted {
		color: #5f665f;
		margin: 0.45rem 0 0.85rem;
	}

	textarea {
		width: 100%;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		padding: 0.75rem;
		font: inherit;
		resize: vertical;
		box-sizing: border-box;
		min-height: 140px;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		margin-top: 0.75rem;
	}

	.icon-btn,
	.post-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.45rem 0.8rem;
		font: inherit;
		cursor: pointer;
	}

	.file-btn {
		cursor: pointer;
	}

	.post-btn {
		margin-left: auto;
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}

	.dropzone {
		margin-top: 0.7rem;
		padding: 0.75rem;
		border: 1px dashed #9e8d7d;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		background: #f7efe4;
		color: #5f665f;
	}

	.dropzone p {
		margin: 0;
		font-size: 0.9rem;
	}

	.dropzone.is-dragging {
		background: #ece8d7;
		border-color: #55724d;
		color: #2f4f3a;
	}

	input[type="file"] {
		display: none;
	}

	.warning,
	.success {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.9rem;
		margin: 0.7rem 0 0;
	}

	.warning {
		color: #8e2f21;
	}

	.success {
		color: #24633f;
	}

	.counter {
		font-size: 0.85rem;
		color: #506157;
		margin: 0.65rem 0 0;
	}

	.counter.danger {
		color: #8e2f21;
	}

	.preview-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.4rem;
		margin-top: 0.75rem;
	}

	.preview-grid img {
		width: 100%;
		height: 88px;
		object-fit: cover;
		border-radius: 10px;
	}

	.analytics ul {
		list-style: none;
		padding: 0;
		margin: 0.7rem 0 1.2rem;
		display: grid;
		gap: 0.35rem;
	}

	.analytics li {
		display: flex;
		justify-content: space-between;
		padding: 0.4rem 0.55rem;
		border-radius: 8px;
		background: #f0e7da;
	}

	.post-list {
		display: grid;
		gap: 0.8rem;
	}

	.post-card {
		border: 1px solid #e2d4c5;
		border-radius: 12px;
		padding: 0.75rem;
		background: #fff;
	}

	.post-card p {
		margin: 0;
		line-height: 1.35;
		white-space: pre-wrap;
	}

	.post-images {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.35rem;
		margin-top: 0.65rem;
	}

	.post-images img {
		width: 100%;
		height: 142px;
		object-fit: cover;
		border-radius: 9px;
	}

	.meta {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		margin-top: 0.6rem;
		color: #5f665f;
	}

	.stats {
		display: flex;
		gap: 0.6rem;
	}

	.stats span {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}

	@media (max-width: 900px) {
		.grid {
			grid-template-columns: 1fr;
		}

		.compose,
		.feed,
		.analytics {
			grid-column: 1;
			grid-row: auto;
		}

		.search {
			min-width: 100%;
		}
	}
</style>
