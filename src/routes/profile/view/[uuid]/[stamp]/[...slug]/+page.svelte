<script>
	import {onMount} from "svelte"
	import {page} from "$app/state"
	import NavBar from "$lib/NavBar.svelte"
	import {
		collectLinksFromValue,
		loadProfileBundleFromPublicBsky,
	} from "$lib/bskyChunkStore"

	const PROFILE_VIEW_CACHE_PREFIX = "love4dogs.profile-view-cache"
	const PROFILE_VIEW_CACHE_TTL_MS = 5 * 60 * 1000

	let jsonData = $state(null)
	let jsonLinks = $state([])
	let loading = $state(true)
	let error = $state("")
	let currentView = $state("feed")

	function asUrl(value) {
		return typeof value === "string" ? value : ""
	}

	function setView(view = "feed") {
		currentView = String(view || "feed")
	}

	function buildCacheKey(uuid = "", stamp = "") {
		return `${PROFILE_VIEW_CACHE_PREFIX}:${uuid}:${stamp}`
	}

	function readCachedProfile(uuid = "", stamp = "") {
		if (typeof localStorage === "undefined") return null
		const cacheKey = buildCacheKey(uuid, stamp)
		const raw = localStorage.getItem(cacheKey)
		if (!raw) return null

		try {
			const parsed = JSON.parse(raw)
			const cachedAt = Number(parsed?.cachedAt || 0)
			const data = parsed?.data
			if (!cachedAt || !data || typeof data !== "object") {
				localStorage.removeItem(cacheKey)
				return null
			}
			if (Date.now() - cachedAt > PROFILE_VIEW_CACHE_TTL_MS) {
				localStorage.removeItem(cacheKey)
				return null
			}
			return data
		} catch {
			localStorage.removeItem(cacheKey)
			return null
		}
	}

	function writeCachedProfile(uuid = "", stamp = "", data = null) {
		if (typeof localStorage === "undefined") return
		if (!data || typeof data !== "object") return
		const cacheKey = buildCacheKey(uuid, stamp)
		localStorage.setItem(
			cacheKey,
			JSON.stringify({
				cachedAt: Date.now(),
				data,
			}),
		)
	}

	onMount(async () => {
		try {
			const uuid = String(page.params?.uuid || "")
			const stamp = String(page.params?.stamp || "")
			console.log("[profile/view] load:start", {uuid, stamp})

			const cached = readCachedProfile(uuid, stamp)
			if (cached) {
				jsonData = cached
				jsonLinks = Array.from(collectLinksFromValue(jsonData))
				console.log("[profile/view] load:cache-hit", {
					uuid,
					stamp,
					linkCount: jsonLinks.length,
				})
				return
			}

			const loaded = await loadProfileBundleFromPublicBsky({
				fetchImpl: fetch,
				uuid,
				version: stamp,
				author: "love4dogs.club",
				debug: true,
			})
			const {primary, subsequent} = loaded?.combined || {}
			jsonData = {...primary, html: subsequent?.join("")}
			writeCachedProfile(uuid, stamp, jsonData)
			jsonLinks = Array.from(collectLinksFromValue(jsonData))
			console.log("[profile/view] load:success", {
				uuid,
				stamp,
				postCount: Array.isArray(loaded?.posts)
					? loaded.posts.length
					: 0,
				chunkCount: Array.isArray(loaded?.payloads)
					? loaded.payloads.length
					: 0,
				linkCount: jsonLinks.length,
			})
		} catch (e) {
			console.error("[profile/view] error", {
				uuid: String(page.params?.uuid || ""),
				stamp: String(page.params?.stamp || ""),
				message: e?.message || String(e),
				details: e?.details || null,
				error: e,
			})
			error = e.message || "Failed to load profile"
		} finally {
			loading = false
		}
	})
</script>

<svelte:head>
	<title>Profile | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar {currentView} onSetView={setView} />

	{#if loading}
		<p class="loading">Loading profile...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if jsonData}
		<section class="panel hero">
			<img class="hero-bg" src="/background.jpg" alt="Background" />

			{#if asUrl(jsonData?.profilePic)}
				<img
					class="avatar"
					src={asUrl(jsonData?.profilePic)}
					alt="Profile"
				/>
			{/if}

			<div class="hero-body">
				<div class="content-html">{@html jsonData?.html || ""}</div>
			</div>
		</section>
	{/if}
</main>

<style>
	.page {
		max-width: 1080px;
		margin: 0 auto;
		padding: 1rem;
		display: grid;
		gap: 0.8rem;
	}

	.panel {
		background: rgba(255, 250, 241, 0.9);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 0.9rem;
		box-shadow: 0 8px 20px rgba(65, 42, 20, 0.1);
	}

	.hero {
		position: relative;
		overflow: hidden;
		padding: 0;
		border-radius: 16px;
		box-shadow: 0 8px 20px rgba(65, 42, 20, 0.1);
	}

	.hero-bg {
		display: block;
		width: 100%;
		height: 260px;
		object-fit: cover;
	}

	.avatar {
		position: absolute;
		left: 1rem;
		top: calc(260px - 5rem);
		z-index: 1;
		width: 10rem;
		height: 10rem;
		object-fit: cover;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.85);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	}

	.hero-body {
		padding-top: 5.5rem;
	}

	.loading,
	.error {
		padding: 0.5rem 0;
	}

	.error {
		color: #8e2f21;
	}

	.content-html {
		padding: 1rem;
		margin-top: 0;
		line-height: 1.55;
		word-break: break-word;
	}

	.content-html :global(img) {
		display: block;
		width: auto;
		max-width: 720px;
		height: auto;
		margin: 1rem auto;
		border-radius: 14px;
		box-shadow: 0 12px 28px rgba(65, 42, 20, 0.18);
		background: #fff;
	}

	.content-html :global(video) {
		display: block;
		width: 100%;
		max-width: 720px;
		height: auto;
		margin: 1rem auto;
		border-radius: 14px;
		box-shadow: 0 12px 28px rgba(65, 42, 20, 0.18);
		background: #fff;
	}

	.content-html :global(iframe) {
		display: block;
		width: 100%;
		max-width: 900px;
		min-height: 320px;
		aspect-ratio: 16 / 9;
		margin: 1rem auto;
		border: 0;
		border-radius: 14px;
		box-shadow: 0 12px 28px rgba(65, 42, 20, 0.18);
		background: #fff;
	}

	.content-html :global(p:first-child),
	.content-html :global(h1:first-child),
	.content-html :global(h2:first-child),
	.content-html :global(h3:first-child) {
		margin-top: 0;
	}

	.content-html :global(p:last-child) {
		margin-bottom: 0;
	}

	.content-html :global(a) {
		word-break: break-all;
	}

	.content-html :global(figure) {
		margin: 1rem auto;
		max-width: 720px;
	}

	.content-html :global(figcaption) {
		margin-top: 0.4rem;
		text-align: center;
		font-size: 0.85rem;
		color: #5f665f;
	}

	@media (max-width: 768px) {
		.avatar {
			width: 78px;
			height: 78px;
			top: calc(220px - 39px);
			left: 0.8rem;
		}

		.hero-body {
			padding-top: 4.4rem;
		}

		.hero-bg {
			height: 220px;
		}
	}
</style>
