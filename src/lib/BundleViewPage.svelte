<script>
	import {onMount} from "svelte"
	import {page} from "$app/state"
	import {goto} from "$app/navigation"
	import NavBar from "$lib/NavBar.svelte"
	import Linkify from "$lib/Linkify.svelte"
	import ProfilePostHeader from "$lib/ProfilePostHeader.svelte"
	import AuthorRow from "$lib/AuthorRow.svelte"
	import {User} from "lucide-svelte"
	import {readSearchTerm, writeSearchTerm} from "$lib/searchStore"

	// ── props ──────────────────────────────────────────────────────────────────
	let {type = "post"} = $props()
	const isProfile = $derived(type === "profile")

	// ── profile-only cache constants ───────────────────────────────────────────
	const PROFILE_VIEW_CACHE_PREFIX = "love4dogs.profile-view-cache"
	const PROFILE_VIEW_CACHE_TTL_MS = 5 * 60 * 1000
	const SESSION_BUNDLE_CACHE_PREFIX = "love4dogs.bundle-session"

	// ── reactive state ─────────────────────────────────────────────────────────
	let currentView = $state("feed")
	let loading = $state(true)
	let error = $state("")
	let jsonData = $state(null)
	let derivedCreatedAtMs = $state(0)
	let editProfileUrl = $state("")
	let chunkUris = $state([])
	let searchTerm = $state("")

	function setView(view = "feed") {
		currentView = String(view || "feed")
	}

	function asUrl(value) {
		return typeof value === "string" ? value : ""
	}

	function normalizeSearchTerm(value = "") {
		return String(value || "")
			.trim()
			.replace(/\s+/g, " ")
	}

	function normalizeTagToken(value = "") {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/^#/, "")
			.replace(/\s+/g, " ")
	}

	function collectTagTokens(...sources) {
		const tokens = []
		for (const source of sources) {
			if (!source) continue
			const candidates = Array.isArray(source) ? source : [source]
			for (const candidate of candidates) {
				if (!candidate || typeof candidate !== "object") continue
				const raw = Array.isArray(candidate?.tags)
						? candidate.tags
						: []
				for (const entry of raw) {
					const token = normalizeTagToken(entry)
					if (token) tokens.push(token)
				}
			}
		}
		return [...new Set(tokens)]
	}

	function isProfileData(data = {}) {
		const tags = collectTagTokens(data, data?.primary, data?.combined?.primary)
		return tags.includes("profile")
	}

	function bundleHasProfileData(bundle = {}, primary = {}) {
		const tags = collectTagTokens(
			primary,
			bundle?.combined?.primary,
			Array.isArray(bundle?.posts) ? bundle.posts : [],
		)
		return tags.includes("profile")
	}

	function getCorrectPathType(data = {}) {
		return isProfileData(data) ? "profile" : "post"
	}

	function collectDisplayTags(data = {}) {
		const raw = Array.isArray(data?.tags) ? data.tags : []
		const seen = new Set()
		const tags = []
		for (const entry of raw) {
			const token = normalizeTagToken(entry)
			if (!token || seen.has(token)) continue
			seen.add(token)
			tags.push(token)
			if (tags.length >= 20) break
		}
		return tags
	}

	function getSearchTokens(value = "") {
		return normalizeSearchTerm(value)
			.split(" ")
			.map((entry) => normalizeTagToken(entry))
			.filter(Boolean)
	}

	function toggleSearchTag(tag = "") {
		const token = normalizeTagToken(tag)
		if (!token) return
		const next = [...getSearchTokens(searchTerm)]
		const index = next.indexOf(token)
		if (index >= 0) {
			next.splice(index, 1)
		} else {
			next.push(token)
		}
		searchTerm = next.join(" ")
		// Note: This intentionally only updates searchTerm; it does NOT trigger a search
	}

	// ── timestamp helpers ──────────────────────────────────────────────────────
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
			if (diffMs >= 0 && diffMs < 45 * 1000) return "just now"
			if (diffMs >= 0 && diffMs < 60 * 60 * 1000) {
				return rtf.format(
					-Math.max(1, Math.floor(diffMs / 60000)),
					"minute",
				)
			}
			if (diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
				return rtf.format(
					-Math.max(1, Math.floor(diffMs / 3600000)),
					"hour",
				)
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
				(startOfToday.getTime() - startOfStampDay.getTime()) / 86400000,
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

	// ── media helpers ──────────────────────────────────────────────────────────
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
					images.push({src, alt: cleanMediaAlt(image?.alt || "")})
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

	function extractAuthorFromBundle(bundle = {}) {
		const posts = Array.isArray(bundle?.posts) ? bundle.posts : []
		for (const entry of posts) {
			const post = entry?.post || entry || {}
			const author = post?.author || {}
			const authorName = String(
				author?.displayName || author?.handle || "",
			).trim()
			const authorAvatar = String(
				author?.avatar || author?.avatarUrl || "",
			).trim()
			if (authorName || authorAvatar) return {authorName, authorAvatar}
		}
		return {authorName: "", authorAvatar: ""}
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

	function buildMapHref(data = {}) {
		const lat = Number(data?.location?.lat)
		const lon = Number(data?.location?.lon)
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			return `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}&z=15`
		}
		const lines = buildLocationLines(data)
		if (lines.length === 0) return ""
		return `https://maps.google.com/maps?q=${encodeURIComponent(lines.join(", "))}&z=15`
	}

	// ── profile-only: chunk URI helpers ───────────────────────────────────────
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

	function collectChunkUrisFromPosts(posts = [], targetUuid = "") {
		const expectedUuid = String(targetUuid || "").trim()
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

	// ── profile-only: local/session cache helpers ──────────────────────────────
	function readSessionBundle(targetUuid) {
		if (typeof sessionStorage === "undefined") return null
		try {
			return JSON.parse(
				sessionStorage.getItem(
					`${SESSION_BUNDLE_CACHE_PREFIX}:${targetUuid}`,
				) || "null",
			)
		} catch {
			return null
		}
	}

	function writeSessionBundle(targetUuid, bundle) {
		if (typeof sessionStorage === "undefined" || !bundle) return
		try {
			sessionStorage.setItem(
				`${SESSION_BUNDLE_CACHE_PREFIX}:${targetUuid}`,
				JSON.stringify(bundle),
			)
		} catch {}
	}

	function readLocalProfile(targetUuid) {
		if (typeof localStorage === "undefined") return null
		const key = `${PROFILE_VIEW_CACHE_PREFIX}:${targetUuid}`
		try {
			const parsed = JSON.parse(localStorage.getItem(key) || "null")
			if (!parsed?.cachedAt || !parsed?.data) {
				localStorage.removeItem(key)
				return null
			}
			if (Date.now() - parsed.cachedAt > PROFILE_VIEW_CACHE_TTL_MS) {
				localStorage.removeItem(key)
				return null
			}
			return parsed.data
		} catch {
			localStorage.removeItem(key)
			return null
		}
	}

	function writeLocalProfile(targetUuid, data) {
		if (typeof localStorage === "undefined" || !data) return
		try {
			localStorage.setItem(
				`${PROFILE_VIEW_CACHE_PREFIX}:${targetUuid}`,
				JSON.stringify({cachedAt: Date.now(), data}),
			)
		} catch {}
	}

	// ── derived values ─────────────────────────────────────────────────────────
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
	const mapHref = $derived(buildMapHref(jsonData))
	const displayTags = $derived(collectDisplayTags(jsonData || {}))
	const activeSearchTokens = $derived(new Set(getSearchTokens(searchTerm)))

	// ── data loading ───────────────────────────────────────────────────────────
	onMount(async () => {
		try {
			if (typeof window !== "undefined") {
				const pathTerms = window.location.pathname.startsWith(
					"/search/",
				)
					? window.location.pathname
							.slice("/search/".length)
							.split("/")
							.map((segment) => decodeURIComponent(segment || ""))
							.join(" ")
					: ""
				const qParam = new URLSearchParams(window.location.search).get(
					"q",
				)
				// Priority: URL terms > query param > localStorage > nothing
				if (pathTerms) {
					searchTerm = normalizeSearchTerm(pathTerms)
				} else if (qParam) {
					searchTerm = normalizeSearchTerm(qParam)
				} else {
					const savedTerm = readSearchTerm()
					searchTerm = savedTerm || ""
				}
			}

			if (!uuid) throw new Error("UUID is required")
			const slug = String(page.params?.slug || "")
			const slugPath = slug ? `/${slug}` : ""

			if (isProfile) {
				const sessionBundle = readSessionBundle(uuid)
				if (sessionBundle) {
					const {primary, subsequent} = sessionBundle?.combined || {}
					jsonData = {
						...(primary || {}),
						html: Array.isArray(subsequent)
							? subsequent.join("")
							: "",
					}
					chunkUris = collectChunkUrisFromPosts(
						Array.isArray(sessionBundle?.posts)
							? sessionBundle.posts
							: [],
						uuid,
					)
					editProfileUrl = `/profile/edit/${encodeURIComponent(uuid)}${slugPath}`
					return
				}
				const cached = readLocalProfile(uuid)
				if (cached) {
					jsonData = cached
					editProfileUrl = `/profile/edit/${encodeURIComponent(uuid)}${slugPath}`
					return
				}
			}

			const response = await fetch(
				`/api/profile-bundle?uuid=${encodeURIComponent(uuid)}`,
			)
			const bundle = await response.json().catch(() => ({}))
			if (!response.ok) {
				throw new Error(bundle?.error || "Failed to load data")
			}

			const {primary, subsequent} = bundle?.combined || {}
			const htmlChunks = Array.isArray(subsequent)
				? subsequent.join("")
				: ""

			if (isProfile) {
				derivedCreatedAtMs = deriveCreatedAtMsFromBundle(bundle)
				let stampValue = ""
				if (
					typeof primary?.stamp === "string" &&
					primary.stamp.trim()
				) {
					stampValue = primary.stamp.trim()
				} else if (derivedCreatedAtMs > 0) {
					stampValue = String(derivedCreatedAtMs)
				}
				jsonData = {
					...(primary || {}),
					html: htmlChunks,
					stamp: stampValue,
				}
				writeLocalProfile(uuid, jsonData)
				writeSessionBundle(uuid, bundle)
				chunkUris = collectChunkUrisFromPosts(
					Array.isArray(bundle?.posts) ? bundle.posts : [],
					uuid,
				)
				editProfileUrl = `/profile/edit/${encodeURIComponent(uuid)}${slugPath}`
				// Route if data doesn't have profile tag
				if (!bundleHasProfileData(bundle, jsonData)) {
					return goto(`/post/view/${encodeURIComponent(uuid)}${slugPath}`, {
						replaceState: true,
					})
				}
			} else {
				const media = collectBundleMedia(bundle)
				const author = extractAuthorFromBundle(bundle)
				derivedCreatedAtMs = deriveCreatedAtMsFromBundle(bundle)
				jsonData = {
					...(primary || {}),
					html: htmlChunks,
					images: media.images,
					videos: media.videos,
					authorName:
						String(primary?.authorName || "").trim() ||
						author.authorName,
					authorAvatar:
						String(primary?.authorAvatar || "").trim() ||
						author.authorAvatar,
				}
				// Route if data has profile tag
				if (bundleHasProfileData(bundle, jsonData)) {
					return goto(`/profile/view/${encodeURIComponent(uuid)}${slugPath}`, {
						replaceState: true,
					})
				}
			}
		} catch (e) {
			error = e?.message || "Failed to load"
		} finally {
			loading = false
		}
	})

	// Persist search term to localStorage whenever it changes
	$effect(() => {
		writeSearchTerm(searchTerm)
	})
</script>

<svelte:head>
	<title>{isProfile ? "Profile" : "Post"} | Love4Dogs</title>
</svelte:head>

<main
	class="page{isProfile ? ' is-profile' : ''} {isProfile
		? 'profile-view-page'
		: 'post-view-page'}"
>
	<NavBar
		bind:searchTerm
		{currentView}
		{editProfileUrl}
		onSetView={setView}
	/>

	{#if loading || (!error && !jsonData)}
		<section
			class="panel hero loading-skeleton"
			aria-busy="true"
			aria-label="Loading {isProfile ? 'profile' : 'post'}"
		>
			{#if isProfile}
				<div class="skeleton-cover"></div>
			{/if}
			<div class="hero-body">
				<div class="skeleton-row">
					<div class="skeleton skeleton-avatar"></div>
					<div class="skeleton-stack">
						<div
							class="skeleton skeleton-line skeleton-line-lg"
						></div>
						<div
							class="skeleton skeleton-line skeleton-line-sm"
						></div>
					</div>
				</div>
				{#if !isProfile}
					<div class="skeleton skeleton-pill"></div>
				{/if}
				<div class="skeleton skeleton-line skeleton-line-xl"></div>
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				{#if !isProfile}
					<div class="skeleton skeleton-media"></div>
				{/if}
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				<!-- Profile-specific skeletons can remain conditional if needed -->
				{#if isProfile}
					<div class="skeleton skeleton-chunk-header"></div>
					<div
						class="skeleton skeleton-line skeleton-line-wide"
					></div>
				{/if}
			</div>
		</section>
	{:else if error}
		<p class="error">{error}</p>
	{:else if jsonData}
		<section class="panel hero">
			{#if isProfile}
				<ProfilePostHeader
					profilePic={asUrl(jsonData?.profilePic)}
					backgroundPic={asUrl(jsonData?.backgroundPic)}
					url={asUrl(jsonData?.canonicalurl)}
				/>
			{/if}

			<div class="hero-body">
				{#if displayTags.length > 0}
					<div class="tag-pills" aria-label="Description tags">
						{#each displayTags as tag}
							<button
								type="button"
								class="tag-pill{activeSearchTokens.has(tag)
									? ' is-active'
									: ''}"
								aria-pressed={activeSearchTokens.has(tag)}
								onclick={(event) => {
									event.preventDefault()
									event.stopPropagation()
									toggleSearchTag(tag)
								}}
							>
								#{tag}
							</button>
						{/each}
					</div>
				{/if}
				<AuthorRow
					avatar={!isProfile ? jsonData?.authorAvatar : null}
					name={(isProfile
						? jsonData?.name || jsonData?.title || jsonData?.authorName
						: jsonData?.authorName) || "Anonymous"}
					date={formattedStamp}
					href={isProfile
						? asUrl(jsonData?.canonicalurl) || undefined
						: authorSearchHref || undefined}
					location={mapHref && locationLines.length > 0
						? locationLines.join(", ")
						: null}
					locationHref={mapHref || null}
					hideAvatar={isProfile}
				/>
				{#if !isProfile && jsonData?.name}
					<h2 class="hero-name">{jsonData.name}</h2>
				{/if}

				{#if jsonData?.description}
					<div class="hero-description">
						<Linkify>{jsonData.description}</Linkify>
					</div>
				{/if}

				{#if !isProfile && !bodyHtmlContainsMedia(jsonData?.html) && (jsonData?.images?.length || jsonData?.videos?.length)}
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

				<div class="content-html">
					{@html jsonData?.html || ""}
				</div>
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

	/* ── post-only: location ──────────────────────────────────────────────── */

	/* Location styles are now handled by AuthorRow component */

	/* ── shared: name + description ───────────────────────────────────────── */
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
		padding: 1rem;
		font-size: 1rem;
		color: #51463a;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.tag-pills {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.5rem 0 0.45rem;
	}

	.tag-pill {
		border: 1px solid rgba(59, 110, 79, 0.3);
		background: rgba(59, 110, 79, 0.1);
		color: #305741;
		border-radius: 999px;
		padding: 0.22rem 0.65rem;
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.2;
		cursor: pointer;
	}

	.tag-pill:hover,
	.tag-pill:focus-visible {
		border-color: #305741;
		background: rgba(59, 110, 79, 0.18);
	}

	.tag-pill.is-active {
		background: #305741;
		border-color: #305741;
		color: #fffaf1;
	}

	/* ── post-only: media gallery ─────────────────────────────────────────── */
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

	/* ── shared: content HTML ─────────────────────────────────────────────── */
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

	/* ── shared: error ────────────────────────────────────────────────────── */
	.error {
		padding: 0.5rem 0;
		color: #8e2f21;
	}

	/* ── skeleton ─────────────────────────────────────────────────────────── */
	.loading-skeleton {
		min-height: 360px;
		overflow: hidden;
	}

	.skeleton-cover {
		width: 100%;
		height: 220px;
		background: linear-gradient(
			90deg,
			#e8e1d7 25%,
			#f6efe6 37%,
			#e8e1d7 63%
		);
		background-size: 400% 100%;
		animation: skeleton-shimmer 1.4s ease-in-out infinite;
	}

	.skeleton-row {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}

	.skeleton-stack {
		display: grid;
		gap: 0.35rem;
		flex: 1;
	}

	.skeleton {
		position: relative;
		overflow: hidden;
		border-radius: 999px;
		background: linear-gradient(
			90deg,
			#e8e1d7 25%,
			#f6efe6 37%,
			#e8e1d7 63%
		);
		background-size: 400% 100%;
		animation: skeleton-shimmer 1.4s ease-in-out infinite;
	}

	.skeleton::after {
		content: "";
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent,
			rgba(255, 255, 255, 0.35),
			transparent
		);
		transform: translateX(-100%);
		animation: skeleton-sweep 1.4s ease-in-out infinite;
	}

	.skeleton-avatar {
		width: 60px;
		height: 60px;
		border-radius: 50%;
		flex: 0 0 60px;
		border: 4px solid rgba(255, 250, 241, 0.9);
	}

	.skeleton-line {
		height: 12px;
		border-radius: 999px;
	}

	.skeleton-line-sm {
		width: 100%;
	}

	.skeleton-line-lg {
		width: 100%;
	}

	.skeleton-line-xl {
		width: 100%;
		height: 20px;
		margin-top: 0.8rem;
	}

	.skeleton-line-wide {
		width: 100%;
	}

	.skeleton-pill {
		width: 88px;
		height: 22px;
		margin-top: 0.55rem;
	}

	.skeleton-media {
		width: min(100%, 720px);
		aspect-ratio: 16 / 9;
		border-radius: 14px;
		margin: 0.8rem 0 0.2rem;
	}

	.skeleton-chunk-header {
		width: 140px;
		height: 18px;
		margin-top: 1.1rem;
	}

	@keyframes skeleton-shimmer {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: 0 0;
		}
	}

	@keyframes skeleton-sweep {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(100%);
		}
	}

	@media (max-width: 768px) {
		.hero-body {
			padding: 0 0.8rem 0.8rem;
		}
	}
</style>
