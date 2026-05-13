<script>
	import {onMount} from "svelte"
	import {page} from "$app/state"
	import NavBar from "$lib/NavBar.svelte"
	import {collectLinksFromValue} from "$lib/bskyChunkStore"

	const PROFILE_VIEW_CACHE_PREFIX = "love4dogs.profile-view-cache"
	const PROFILE_VIEW_CACHE_TTL_MS = 5 * 60 * 1000
	const SESSION_BUNDLE_CACHE_PREFIX = "love4dogs.bundle-session"

	let jsonData = $state(null)
	let jsonLinks = $state([])
	let loading = $state(true)
	let error = $state("")
	let currentView = $state("feed")
	let editProfileUrl = $state("")

	function asUrl(value) {
		return typeof value === "string" ? value : ""
	}

	function buildBundleCacheKey(uuid = "") {
		return `${SESSION_BUNDLE_CACHE_PREFIX}:${uuid}`
	}

	function readBundleSessionCache(uuid = "") {
		if (typeof sessionStorage === "undefined") return null
		const cacheKey = buildBundleCacheKey(uuid)
		const raw = sessionStorage.getItem(cacheKey)
		if (!raw) return null
		try {
			return JSON.parse(raw)
		} catch {
			return null
		}
	}

	function writeBundleSessionCache(uuid = "", bundle = null) {
		if (typeof sessionStorage === "undefined") return
		if (!bundle || typeof bundle !== "object") return
		const cacheKey = buildBundleCacheKey(uuid)
		sessionStorage.setItem(cacheKey, JSON.stringify(bundle))
	}

	function setView(view = "feed") {
		currentView = String(view || "feed")
	}

	function buildCacheKey(uuid = "") {
		return `${PROFILE_VIEW_CACHE_PREFIX}:${uuid}`
	}

	function readCachedProfile(uuid = "") {
		if (typeof localStorage === "undefined") return null
		const cacheKey = buildCacheKey(uuid)
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

	function writeCachedProfile(uuid = "", data = null) {
		if (typeof localStorage === "undefined") return
		if (!data || typeof data !== "object") return
		const cacheKey = buildCacheKey(uuid)
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
			const slug = String(page.params?.slug || "")
			const slugPath = slug ? `/${slug}` : ""

			if (!uuid) {
				throw new Error("UUID is required")
			}

			console.log("[profile/view] load:start", {
				uuid,
				slugPath,
			})

			const sessionBundle = readBundleSessionCache(uuid)
			if (sessionBundle) {
				const {primary, subsequent} = sessionBundle?.combined || {}
				jsonData = {...primary, html: subsequent?.join("")}
				jsonLinks = Array.from(collectLinksFromValue(jsonData))
				editProfileUrl = `/profile/edit/${encodeURIComponent(uuid)}${slugPath}`
				console.log("[profile/view] load:session-cache-hit", {
					uuid,
					linkCount: jsonLinks.length,
				})
				return
			}

			const cached = readCachedProfile(uuid)
			if (cached) {
				jsonData = cached
				jsonLinks = Array.from(collectLinksFromValue(jsonData))
				editProfileUrl = `/profile/edit/${encodeURIComponent(uuid)}${slugPath}`
				console.log("[profile/view] load:cache-hit", {
					uuid,
					linkCount: jsonLinks.length,
				})
				return
			}

			const bundleRes = await fetch(
				`/api/profile-bundle?uuid=${encodeURIComponent(uuid)}`,
			)
			const bundleJson = await bundleRes.json().catch(() => ({}))
			if (
				!bundleRes.ok ||
				!bundleJson ||
				typeof bundleJson !== "object"
			) {
				const message = String(
					bundleJson?.error || "Failed to load profile bundle",
				)
				const err = new Error(message)
				err.details = bundleJson?.details || null
				throw err
			}
			const loaded = bundleJson

			console.log("[profile/view] load:latest", {
				uuid,
			})

			const {primary, subsequent} = loaded?.combined || {}
			jsonData = {...primary, html: subsequent?.join("")}
			writeCachedProfile(uuid, jsonData)
			writeBundleSessionCache(uuid, loaded)
			editProfileUrl = `/profile/edit/${encodeURIComponent(uuid)}${slugPath}`
			jsonLinks = Array.from(collectLinksFromValue(jsonData))
			console.log("[profile/view] load:success", {
				uuid,
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
	<NavBar {currentView} {editProfileUrl} onSetView={setView} />

	{#if loading}
		<p class="loading">Loading profile...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if jsonData}
		<section class="panel hero">
			<img
				class="hero-bg"
				src={jsonData?.backgroundPic || "/background.jpg"}
				alt="Background"
			/>

			{#if asUrl(jsonData?.profilePic)}
				<img
					class="avatar"
					src={asUrl(jsonData?.profilePic)}
					alt="Profile"
				/>
			{/if}

			<div class="hero-body">
				{#if jsonData?.name || jsonData?.description}
					<div class="hero-meta">
						{#if jsonData?.name}
							<h1 class="hero-name">{jsonData?.name}</h1>
						{/if}
						{#if jsonData?.description}
							<p class="hero-description">
								{jsonData?.description}
							</p>
						{/if}
					</div>
				{/if}
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

	.hero-meta {
		padding: 1rem 1rem 0;
		display: grid;
		gap: 0.4rem;
	}

	.hero-name {
		margin: 0;
		font-size: clamp(1.2rem, 2.4vw, 1.8rem);
		line-height: 1.2;
	}

	.hero-description {
		margin: 0;
		font-size: 1rem;
		line-height: 1.45;
		color: #51463a;
		white-space: pre-wrap;
		word-break: break-word;
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
