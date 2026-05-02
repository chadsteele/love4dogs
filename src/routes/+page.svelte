<script>
	import {onMount} from "svelte"
	import {
		CircleAlert,
		Hash,
		Heart,
		MessageCircle,
		PawPrint,
		Repeat2,
		Search,
	} from "lucide-svelte"

	const ACCOUNT_HANDLE = "mylove4dogs.bsky.social"
	const LOCAL_TAG_KEY = "love4dogs.tag-counts"

	let posts = $state([])
	let recentTags = $state([])
	let localTopTags = $state([])
	let searchTerm = $state("")
	let loadingPosts = $state(false)
	let feedError = $state("")
	let logoLoaded = $state(true)

	let searchDebounceTimer = null
	let lastFeedRequestId = 0

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

			if (requestId !== lastFeedRequestId) return

			posts = json.posts || []
			recentTags = json.commonRecentTags || []
		} catch (error) {
			if (requestId !== lastFeedRequestId) return
			feedError = error.message || "Failed loading feed."
		} finally {
			if (requestId === lastFeedRequestId) loadingPosts = false
		}
	}

	function queueLiveSearch() {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
		searchDebounceTimer = setTimeout(() => {
			loadFeed()
		}, 350)
	}

	onMount(() => {
		loadLocalTagCounts()
		loadFeed()

		return () => {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
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
				<p class="kicker">Join us!</p>
				<h1>Love4Dogs</h1>
			</div>
		</div>

		<form
			class="search"
			onsubmit={(event) => {
				event.preventDefault()
				if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
				loadFeed()
			}}
		>
			<Search size={18} />
			<input
				type="search"
				bind:value={searchTerm}
				oninput={queueLiveSearch}
				placeholder={`Search`}
			/>
			<button type="submit">Search</button>
		</form>

		<a class="post-route-btn" href="/post">Create Post</a>
	</nav>

	<section class="grid">
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
			<h2>Posts...</h2>

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

	.post-route-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 40px;
		padding: 0 1rem;
		border-radius: 999px;
		border: 1px solid #305741;
		background: #3b6e4f;
		color: #fff;
		font-weight: 600;
		text-decoration: none;
	}

	.grid {
		display: grid;
		grid-template-columns: 0.9fr 1.1fr;
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

	.muted {
		color: #5f665f;
		margin: 0.45rem 0 0.85rem;
	}

	.warning {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.9rem;
		margin: 0.7rem 0 0;
		color: #8e2f21;
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

		.search {
			min-width: 100%;
		}

		.post-route-btn {
			width: 100%;
		}
	}
</style>
