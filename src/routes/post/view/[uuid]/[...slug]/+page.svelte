<script>
	import {onMount} from "svelte"
	import {page} from "$app/state"
	import NavBar from "$lib/NavBar.svelte"
	import Linkify from "$lib/Linkify.svelte"
	import {MapPin, User} from "lucide-svelte"

	let currentView = $state("feed")
	let loading = $state(true)
	let error = $state("")
	let jsonData = $state(null)
	let derivedCreatedAtMs = $state(0)

	function setView(view = "feed") {
		currentView = String(view || "feed")
	}

	function formatCompressedStamp(value = "") {
		const raw = String(value || "").trim()
		if (!raw) return ""
		const asBase10 = Number(raw)
		const stampMs = Number.isFinite(asBase10)
			? asBase10
			: Number.parseInt(raw, 36)
		if (!Number.isFinite(stampMs) || stampMs <= 0) return raw
		try {
			const stampDate = new Date(stampMs)
			const now = new Date()
			const rtf = new Intl.RelativeTimeFormat(undefined, {
				numeric: "auto",
			})

			const timeLabel = stampDate.toLocaleTimeString([], {
				hour: "numeric",
				minute: "2-digit",
			})
			const diffMs = now.getTime() - stampMs
			if (diffMs >= 0 && diffMs < 45 * 1000) {
				return "just now"
			}
			if (diffMs >= 0 && diffMs < 60 * 60 * 1000) {
				const minutesAgo = Math.floor(diffMs / (60 * 1000))
				return rtf.format(-Math.max(1, minutesAgo), "minute")
			}
			if (diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
				const hoursAgo = Math.floor(diffMs / (60 * 60 * 1000))
				return rtf.format(-Math.max(1, hoursAgo), "hour")
			}

			const startOfToday = new Date(
				now.getFullYear(),
				now.getMonth(),
				now.getDate(),
			)
			const startOfStampDay = new Date(
				stampDate.getFullYear(),
				stampDate.getMonth(),
				stampDate.getDate(),
			)
			const dayDiff = Math.round(
				(startOfToday.getTime() - startOfStampDay.getTime()) /
					(24 * 60 * 60 * 1000),
			)

			if (dayDiff === 0) return `today at ${timeLabel}`
			if (dayDiff === 1) return `yesterday at ${timeLabel}`

			const includeYear = stampDate.getFullYear() !== now.getFullYear()
			const dateLabel = stampDate.toLocaleDateString(
				[],
				includeYear
					? {year: "numeric", month: "short", day: "numeric"}
					: {month: "short", day: "numeric"},
			)
			return `${dateLabel} at ${timeLabel}`
		} catch {
			return raw
		}
	}

	function parseBskyPostTimestampMs(post = {}) {
		const candidates = [
			post?.indexedAt,
			post?.record?.createdAt,
			post?.value?.createdAt,
			post?.createdAt,
		]
		for (const candidate of candidates) {
			const ms = Date.parse(String(candidate || ""))
			if (Number.isFinite(ms) && ms > 0) return ms
		}
		return 0
	}

	function deriveCreatedAtMsFromBundle(bundle = {}) {
		const posts = Array.isArray(bundle?.posts) ? bundle.posts : []
		let earliest = 0
		for (const post of posts) {
			const ms = parseBskyPostTimestampMs(post)
			if (!ms) continue
			earliest = earliest === 0 ? ms : Math.min(earliest, ms)
		}
		return earliest
	}

	function cleanMediaAlt(value = "") {
		const raw = String(value || "").trim()
		if (!raw) return ""
		if (raw.startsWith("{") || raw.startsWith("[")) return ""
		return raw
	}

	function collectBundleMedia(bundle = {}) {
		const posts = Array.isArray(bundle?.posts) ? bundle.posts : []
		const images = []
		const videos = []
		const seenImages = new Set()
		const seenVideos = new Set()

		for (const entry of posts) {
			const post = entry?.post || entry || {}
			const embedView = post?.embed
			const mediaView =
				embedView?.$type === "app.bsky.embed.recordWithMedia#view"
					? embedView.media
					: embedView

			if (mediaView?.$type === "app.bsky.embed.images#view") {
				for (const image of mediaView.images || []) {
					const src = String(
						image?.fullsize || image?.thumb || "",
					).trim()
					if (!src || seenImages.has(src)) continue
					seenImages.add(src)
					images.push({
						src,
						alt: cleanMediaAlt(image?.alt || ""),
					})
				}
			}

			if (mediaView?.$type === "app.bsky.embed.video#view") {
				const playlist = String(mediaView?.playlist || "").trim()
				if (!playlist || seenVideos.has(playlist)) continue
				seenVideos.add(playlist)
				videos.push({
					src: playlist,
					poster: String(mediaView?.thumbnail || "").trim(),
					alt: cleanMediaAlt(mediaView?.alt || ""),
				})
			}
		}

		return {images, videos}
	}

	function bodyHtmlContainsMedia(html = "") {
		return /<(img|video|iframe)\b/i.test(String(html || ""))
	}

	function buildLocationLines(data = {}) {
		const address = String(data?.address || "").trim()
		const city = String(data?.city || data?.location?.city || "").trim()
		const state = String(data?.state || data?.location?.state || "").trim()
		const zip = String(data?.zip || data?.location?.zip || "").trim()
		const country = String(
			data?.country || data?.location?.country || "",
		).trim()

		const locality = [city, state, zip].filter(Boolean).join(", ")
		return [address, locality, country].filter(Boolean)
	}

	function buildDirectionsHref(data = {}) {
		const lat = Number(data?.location?.lat)
		const lon = Number(data?.location?.lon)
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			return `https://maps.google.com/?daddr=${encodeURIComponent(`${lat},${lon}`)}`
		}

		const lines = buildLocationLines(data)
		if (lines.length === 0) return ""
		return `https://maps.google.com/?daddr=${encodeURIComponent(lines.join(", "))}`
	}

	function buildMapPreviewHref(data = {}) {
		const lat = Number(data?.location?.lat)
		const lon = Number(data?.location?.lon)
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			return `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}&z=15&output=embed`
		}

		const lines = buildLocationLines(data)
		if (lines.length === 0) return ""
		return `https://maps.google.com/maps?q=${encodeURIComponent(lines.join(", "))}&z=15&output=embed`
	}

	function isSyntheticAuthorId(value = "") {
		return /^author-[a-z0-9]+$/i.test(String(value || "").trim())
	}

	const uuid = $derived(String(page.params?.uuid || "").trim())
	const authorId = $derived(
		String(jsonData?.authorid || jsonData?.authorId || "").trim(),
	)
	const authorSearchHref = $derived(
		authorId
			? `/search/${encodeURIComponent("uuid")}/${encodeURIComponent(authorId)}`
			: "",
	)
	const formattedStamp = $derived(
		formatCompressedStamp(
			jsonData?.stamp ||
				(derivedCreatedAtMs > 0 ? String(derivedCreatedAtMs) : ""),
		),
	)
	const locationLines = $derived(buildLocationLines(jsonData))
	const directionsHref = $derived(buildDirectionsHref(jsonData))
	const mapPreviewHref = $derived(buildMapPreviewHref(jsonData))

	onMount(async () => {
		try {
			if (!uuid) {
				throw new Error("UUID is required")
			}

			const response = await fetch(
				`/api/profile-bundle?uuid=${encodeURIComponent(uuid)}`,
			)
			const bundle = await response.json().catch(() => ({}))
			if (!response.ok) {
				throw new Error(bundle?.error || "Failed to load post data")
			}

			const {primary, subsequent} = bundle?.combined || {}
			const media = collectBundleMedia(bundle)
			derivedCreatedAtMs = deriveCreatedAtMsFromBundle(bundle)
			jsonData = {
				...(primary || {}),
				html: Array.isArray(subsequent) ? subsequent.join("") : "",
				images: media.images,
				videos: media.videos,
			}
		} catch (e) {
			error = e?.message || "Failed to load post data"
		} finally {
			loading = false
			console.log({postView: jsonData})
		}

		const authorid = jsonData?.authorid || jsonData?.authorId
		if (authorid && !isSyntheticAuthorId(authorid)) {
			try {
				const profileRes = await fetch(
					`/api/profile-bundle?uuid=${encodeURIComponent(authorid)}`,
				)
				const profileJson = await profileRes.json().catch(() => ({}))
				if (profileRes.ok && profileJson?.combined?.primary) {
					const profilePrimary = profileJson.combined.primary
					jsonData = {
						...jsonData,
						authorName: profilePrimary.name || "",
						authorAvatar: profilePrimary.profilePic || "",
					}
				}
			} catch (e) {
				console.error("Failed to load author profile", {
					authorid,
					message: e?.message || String(e),
					error: e,
				})
			}
		} else if (authorid) {
			console.debug(
				"[post/view] skipping synthetic author profile lookup",
				{
					authorid,
				},
			)
		}
	})
</script>

<svelte:head>
	<title>Post View | Love4Dogs</title>
</svelte:head>

<main class="page post-view-page">
	<NavBar {currentView} onSetView={setView} />

	{#if loading}
		<p class="loading">Loading post...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if jsonData}
		<section class="panel hero">
			<div class="hero-body">
				<a class="author-info" href={authorSearchHref || undefined}>
					<div class="author-row">
						{#if jsonData?.authorAvatar}
							<img
								src={jsonData.authorAvatar}
								alt="Author Avatar"
								class="author-avatar"
							/>
						{:else}
							<span class="author-icon" aria-hidden="true"
								><User size={16} /></span
							>
						{/if}
						<div class="author-meta">
							<div class="author-name">
								{jsonData?.authorName || "Anonymous"}
								{#if formattedStamp}
									<div class="date-time">
										{formattedStamp}
									</div>
								{/if}
							</div>
						</div>
					</div>
				</a>
				{#if directionsHref && locationLines.length > 0}
					<div class="location-actions">
						<a
							class="directions-link"
							href={directionsHref}
							target="_blank"
							rel="noreferrer"
						>
							<MapPin size={16} aria-hidden="true" />
							{locationLines.join(", ")}
						</a>
					</div>
				{/if}

				{#if jsonData?.name}
					<h2 class="hero-name">{jsonData.name}</h2>
				{/if}
				{#if jsonData?.description}
					<p class="hero-description">
						<Linkify>{jsonData.description}</Linkify>
					</p>
				{/if}
				{#if !bodyHtmlContainsMedia(jsonData?.html) && (jsonData?.images?.length || jsonData?.videos?.length)}
					<section class="media-gallery" aria-label="Post media">
						{#each jsonData?.images || [] as image}
							<figure class="media-card">
								<img
									src={image.src}
									alt={image.alt || "Post image"}
									loading="lazy"
								/>
								{#if image.alt}
									<figcaption>{image.alt}</figcaption>
								{/if}
							</figure>
						{/each}
						{#each jsonData?.videos || [] as video}
							<figure class="media-card">
								<video
									controls
									playsinline
									preload="metadata"
									poster={video.poster || undefined}
								>
									<source src={video.src} />
								</video>
								{#if video.alt}
									<figcaption>{video.alt}</figcaption>
								{/if}
							</figure>
						{/each}
					</section>
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
		overflow: visible;
		padding: 0;
		border-radius: 16px;
		box-shadow: 0 8px 20px rgba(65, 42, 20, 0.1);
	}

	.hero-body {
		padding: 0 1rem 1rem;
	}

	.author-info {
		display: block;
		padding-top: 0.9rem;
		text-decoration: none;
		color: inherit;
	}

	.author-row {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}

	.author-info:hover .author-name,
	.author-info:focus-visible .author-name {
		text-decoration: underline;
	}

	.author-avatar {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid rgba(58, 91, 65, 0.24);
		box-shadow: 0 6px 18px rgba(65, 42, 20, 0.08);
	}

	.author-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		box-sizing: border-box;
		border-radius: 50%;
		border: 1px solid rgba(58, 91, 65, 0.24);
		background: rgba(255, 255, 255, 0.72);
		box-shadow: 0 6px 18px rgba(65, 42, 20, 0.08);
		color: #5f665f;
	}

	.author-meta {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}

	.author-name {
		margin: 0;
		font-size: clamp(1.05rem, 2vw, 1.3rem);
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: -0.01em;
		color: #2f4336;
	}

	.date-time {
		margin: 0;
		padding-top: 0.12rem;
		font-size: clamp(0.82rem, 1.45vw, 0.96rem);
		font-weight: 600;
		line-height: 1.25;
		color: #6e756f;
	}

	.hero-name {
		margin: 0;
		padding: 1rem 0 0.7rem;
		font-size: clamp(1.35rem, 2.5vw, 1.95rem);
		line-height: 1.15;
		color: #2b271f;
		word-break: break-word;
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

	.media-gallery {
		display: grid;
		gap: 1rem;
		padding: 0.25rem 0 1rem;
	}

	.media-card {
		margin: 0;
	}

	.media-card img,
	.media-card video {
		display: block;
		width: 100%;
		max-width: 720px;
		height: auto;
		margin: 0 auto;
		border-radius: 14px;
		box-shadow: 0 12px 28px rgba(65, 42, 20, 0.18);
		background: #fff;
	}

	.media-card figcaption {
		margin-top: 0.4rem;
		text-align: center;
		font-size: 0.85rem;
		color: #5f665f;
	}

	.location-actions {
		margin: 0;
	}

	.location-actions {
		margin-top: 0.45rem;
	}

	.directions-link {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		color: #6e756f;
		font-size: clamp(0.82rem, 1.45vw, 0.96rem);
		font-weight: 600;
		line-height: 1.25;
		text-decoration: none;
	}

	.directions-link :global(svg) {
		flex: none;
		stroke-width: 2.15;
	}

	.directions-link:hover,
	.directions-link:focus-visible {
		text-decoration: underline;
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
		.hero-body {
			padding: 0 0.8rem 0.8rem;
		}
	}
</style>
