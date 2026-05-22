<script>
	import {onMount} from "svelte"
	import {page} from "$app/state"
	import NavBar from "$lib/NavBar.svelte"
	import ProfilePostHeader from "$lib/ProfilePostHeader.svelte"
	import {collectLinksFromValue} from "$lib/bskyChunkStore"
	import Linkify from "$lib/Linkify.svelte"

	const PROFILE_VIEW_CACHE_PREFIX = "love4dogs.profile-view-cache"
	const PROFILE_VIEW_CACHE_TTL_MS = 5 * 60 * 1000
	const SESSION_BUNDLE_CACHE_PREFIX = "love4dogs.bundle-session"

	let jsonData = $state(null)
	let jsonLinks = $state([])
	let chunkUris = $state([])
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

	function parseChunkAltPayload(alt = "") {
		const source = String(alt || "").trim()
		if (!source) return null
		try {
			const parsed = JSON.parse(source)
			if (!parsed || typeof parsed !== "object") return null
			if (!Number.isFinite(Number(parsed?.i))) return null
			if (!Object.prototype.hasOwnProperty.call(parsed, "h")) return null
			return parsed
		} catch {
			return null
		}
	}

	function collectChunkUrisFromPosts(posts = [], uuid = "") {
		const expectedUuid = String(uuid || "").trim()
		const uris = []
		for (const post of Array.isArray(posts) ? posts : []) {
			const uri = String(post?.uri || "").trim()
			if (!uri || uris.includes(uri)) continue
			const embed = post?.embed
			const media =
				embed?.$type === "app.bsky.embed.recordWithMedia#view"
					? embed.media
					: embed
			const images =
				media?.$type === "app.bsky.embed.images#view"
					? media.images || []
					: []
			let isChunk = false
			for (const image of images) {
				const payload = parseChunkAltPayload(image?.alt || "")
				if (!payload) continue
				const payloadUuid = String(
					payload?.u || payload?.uuid || "",
				).trim()
				if (expectedUuid && payloadUuid !== expectedUuid) continue
				isChunk = true
				break
			}
			if (isChunk) uris.push(uri)
		}
		return uris
	}

	function atUriToBskyUrl(uri = "") {
		const match = String(uri || "")
			.trim()
			.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/i)
		if (!match) return ""
		return `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`
	}

	function updateChunkUris(uuid = "", bundle = null) {
		const posts = Array.isArray(bundle?.posts) ? bundle.posts : []
		chunkUris = collectChunkUrisFromPosts(posts, uuid)
	}

	function downloadChunkUris() {
		if (!chunkUris.length) return
		const blob = new Blob([`${chunkUris.join("\n")}\n`], {
			type: "text/plain;charset=utf-8",
		})
		const url = URL.createObjectURL(blob)
		const anchor = document.createElement("a")
		anchor.href = url
		anchor.download = `love4dogs-chunks-${page.params?.uuid || "bundle"}.txt`
		anchor.click()
		URL.revokeObjectURL(url)
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
				updateChunkUris(uuid, sessionBundle)
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
				updateChunkUris(uuid, readBundleSessionCache(uuid))
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
			updateChunkUris(uuid, loaded)
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

<main class="page profile-view-page">
	<NavBar {currentView} {editProfileUrl} onSetView={setView} />

	{#if loading}
		<p class="loading">Loading profile...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if jsonData}
		<section class="panel hero">
			<ProfilePostHeader
				profilePic={asUrl(jsonData?.profilePic)}
				backgroundPic={asUrl(jsonData?.backgroundPic)}
				title={jsonData?.name || ""}
				name={jsonData?.name || ""}
				url={asUrl(jsonData?.canonicalurl)}
			/>

			<div class="hero-body">
				{#if jsonData?.description}
					<p class="hero-description">
						<Linkify>{jsonData?.description}</Linkify>
					</p>
				{/if}
				<div class="content-html">{@html jsonData?.html || ""}</div>

				{#if chunkUris.length}
					<section class="chunk-manifest">
						<div class="chunk-manifest-header">
							<div>
								<p class="chunk-manifest-label">Chunks</p>
								<h3>Standalone chunk posts</h3>
							</div>
							<button
								type="button"
								class="chunk-download"
								onclick={downloadChunkUris}
							>
								Download list
							</button>
						</div>
						<ul class="chunk-list">
							{#each chunkUris as uri}
								<li>
									<a
										href={atUriToBskyUrl(uri)}
										target="_blank"
										rel="noreferrer">{uri}</a
									>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
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
		overflow: visible;
		padding: 0;
		border: 0;
		border-radius: 16px;
		box-shadow: 0 8px 20px rgba(65, 42, 20, 0.1);
	}

	.hero-body {
		padding: 0 1rem 1rem;
	}

	.hero-description {
		margin: 0;
		padding: 0.1rem 0 0.7rem;
		font-size: 1rem;
		color: #51463a;
		line-height: 1.45;
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

	.chunk-manifest {
		margin-top: 1rem;
		padding: 0.9rem;
		border-radius: 14px;
		background: rgba(245, 239, 225, 0.9);
		border: 1px solid rgba(58, 91, 65, 0.14);
	}

	.chunk-manifest-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.chunk-manifest-label {
		margin: 0 0 0.25rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #6d5f4c;
	}

	.chunk-manifest h3 {
		margin: 0;
		font-size: 1rem;
		color: #2f2b24;
	}

	.chunk-download {
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 999px;
		padding: 0.45rem 0.8rem;
		background: #fffaf1;
		color: #38543b;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.chunk-list {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.35rem;
	}

	.chunk-list a {
		color: #375d46;
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
		.hero-body {
			padding: 0 0.8rem 0.8rem;
		}
	}
</style>
