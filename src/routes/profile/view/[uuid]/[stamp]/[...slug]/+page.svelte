<script>
	import {onMount} from "svelte"
	import {page} from "$app/state"
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

	function asUrl(value) {
		return typeof value === "string" ? value : ""
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
	{#if loading}
		<p class="loading">Loading profile...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if jsonData}
		<section class="panel hero">
			{#if asUrl(jsonData?.backgroundPic)}
				<img
					class="hero-bg"
					src={asUrl(jsonData?.backgroundPic)}
					alt="Background"
				/>
			{:else}
				<div class="hero-bg placeholder"></div>
			{/if}
			<div class="hero-overlay"></div>
			<div class="hero-content">
				{#if asUrl(jsonData?.profilePic)}
					<img
						class="avatar"
						src={asUrl(jsonData?.profilePic)}
						alt="Profile"
					/>
				{/if}
				<div>
					<h1 class="profile-name">{jsonData?.name || "Profile"}</h1>
					<p class="profile-description">
						{jsonData?.description || ""}
					</p>
				</div>
			</div>
		</section>

		<section class="panel details">
			<p><strong>UUID:</strong> {jsonData?.uuid || ""}</p>
			<p><strong>Version:</strong> {jsonData?.version || ""}</p>
			{#if jsonData?.canonicalurl}
				<p>
					<strong>Canonical URL:</strong>
					<a href={jsonData.canonicalurl}>{jsonData.canonicalurl}</a>
				</p>
			{/if}
			{#if jsonData?.email}
				<p>
					<strong>Private Email (Encrypted):</strong>
					{jsonData.email}
				</p>
			{/if}
		</section>

		{#if jsonLinks.length > 0}
			<section class="panel links">
				<h2>Links</h2>
				<ul>
					{#each jsonLinks as link}
						<li>
							<a
								href={link}
								target="_blank"
								rel="noopener noreferrer">{link}</a
							>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="panel content">
			<h2>Profile Content</h2>
			<div class="content-html">{@html jsonData?.html || ""}</div>
		</section>

		<section class="panel payload">
			<h2>Payload</h2>
			<pre>{JSON.stringify(jsonData, null, 2)}</pre>
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
		min-height: 240px;
		padding: 0;
	}

	.hero-bg {
		display: block;
		width: 100%;
		height: 260px;
		object-fit: cover;
	}

	.hero-bg.placeholder {
		background: linear-gradient(135deg, #dfe8df, #f6f0e7 60%, #d8e1d6);
	}

	.hero-overlay {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			to top,
			rgba(0, 0, 0, 0.45),
			transparent 55%
		);
	}

	.hero-content {
		position: absolute;
		inset: auto 0 0;
		padding: 1rem;
		display: flex;
		gap: 0.8rem;
		align-items: end;
		color: #fff;
	}

	.avatar {
		width: 96px;
		height: 96px;
		object-fit: cover;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.85);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		background: #fff;
	}

	.profile-name {
		margin: 0;
		font-size: 1.45rem;
	}

	.profile-description {
		margin: 0.25rem 0 0;
		line-height: 1.4;
	}

	.loading,
	.error {
		padding: 0.5rem 0;
	}

	.error {
		color: #8e2f21;
	}

	.details p {
		margin: 0.3rem 0;
	}

	.details a {
		word-break: break-all;
	}

	pre {
		white-space: pre-wrap;
		word-break: break-word;
		background: #fffdf8;
		border: 1px solid #e4d8c9;
		border-radius: 8px;
		padding: 1rem;
	}

	.links h2 {
		margin: 0 0 0.35rem;
		font-size: 1rem;
	}

	.links ul {
		margin: 0 0 0.8rem;
		padding-left: 1.25rem;
	}

	.links a {
		word-break: break-all;
	}

	.content h2,
	.payload h2 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}

	.content-html {
		line-height: 1.5;
		word-break: break-word;
	}

	.content-html :global(img),
	.content-html :global(video),
	.content-html :global(iframe) {
		max-width: 100%;
		height: auto;
	}

	@media (max-width: 768px) {
		.hero-content {
			align-items: center;
		}

		.avatar {
			width: 78px;
			height: 78px;
		}

		.profile-name {
			font-size: 1.2rem;
		}
	}
</style>
