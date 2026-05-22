<script>
	import {
		Heart,
		MessageCircle,
		PawPrint,
		Pencil,
		Repeat2,
	} from "lucide-svelte"
	import {rewriteLove4DogsUrlForLocalhost} from "$lib/utils"
	import PostImageViewer from "$lib/PostImageViewer.svelte"
	import Share from "$lib/Share.svelte"
	import ProfilePostHeader from "$lib/ProfilePostHeader.svelte"

	import {siBluesky} from "simple-icons"

	let {
		post,
		selected = false,
		bookmarked = false,
		selectable = false,
		selectionEnabled = true,
		onToggleSelect = () => {},
	} = $props()
	let showImageModal = $state(false)
	let activeImageIndex = $state(0)

	const BSKY_HANDLE = "love4dogs.club"

	function bskyUrl(uri = "") {
		const rkey = uri.split("/").pop()
		return `https://bsky.app/profile/${BSKY_HANDLE}/post/${rkey}`
	}

	function formatDate(iso = "") {
		if (!iso) return ""
		const d = new Date(iso)
		return d.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			year: "numeric",
		})
	}
	const utf8Encoder = new TextEncoder()

	function uniqueImageUrls(images = []) {
		if (!Array.isArray(images) || images.length === 0) return []
		const seen = new Set()
		const unique = []
		for (const image of images) {
			const value = String(image || "").trim()
			if (!value || seen.has(value)) continue
			seen.add(value)
			unique.push(value)
		}
		return unique
	}

	function normalizeComparableImageUrl(value = "") {
		const source = String(value || "").trim()
		if (!source) return ""
		const unescaped = source.replace(/\\\//g, "/")
		const localized = rewriteLove4DogsUrlForLocalhost(unescaped)
		try {
			const parsed = new URL(localized)
			const host = String(parsed.hostname || "").toLowerCase()
			const segments = parsed.pathname
				.split("/")
				.map((segment) => segment.trim())
				.filter(Boolean)
			if (
				host === "cdn.bsky.app" &&
				segments.length >= 5 &&
				segments[0] === "img" &&
				segments[2] === "plain"
			) {
				const did = segments[3]
				const cid = segments[4].split("@")[0]
				if (did && cid) return `bsky:${did}/${cid}`.toLowerCase()
			}
			return `${parsed.origin}${parsed.pathname}`
				.replace(/\/+$/g, "")
				.toLowerCase()
		} catch {
			return localized.replace(/\/+$/g, "").toLowerCase()
		}
	}

	function normalizeProfileImageUrl(value = "") {
		const next = normalizeEscapedUrl(value)
		if (!next) return ""
		if (/^~c~/i.test(next)) return ""
		if (!/^https?:\/\//i.test(next)) return ""
		return rewriteLove4DogsUrlForLocalhost(next)
	}

	function escapeHtml(text = "") {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
	}

	function escapeAttr(text = "") {
		return text
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
	}

	function byteOffsetToJsIndex(text, byteOffset) {
		let totalBytes = 0
		let jsIndex = 0

		for (const ch of text) {
			const nextBytes = totalBytes + utf8Encoder.encode(ch).length
			if (nextBytes > byteOffset) return jsIndex
			if (nextBytes === byteOffset) return jsIndex + ch.length
			totalBytes = nextBytes
			jsIndex += ch.length
		}

		return text.length
	}

	function linkifyText(text = "", facets = []) {
		const renderWithUrlRegex = (plainText = "") => {
			const urlRegex = /(https?:\/\/[^\s<]+)/g
			let html = ""
			let cursor = 0

			for (const match of plainText.matchAll(urlRegex)) {
				const url = rewriteLove4DogsUrlForLocalhost(match[0])
				const start = match.index ?? 0
				html += escapeHtml(plainText.slice(cursor, start))
				html += `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
				cursor = start + match[0].length
			}

			html += escapeHtml(plainText.slice(cursor))
			return html
		}

		if (!Array.isArray(facets) || facets.length === 0) {
			return renderWithUrlRegex(text)
		}

		const linkFacets = []
		for (const facet of facets) {
			if (!facet?.index || !Array.isArray(facet.features)) continue
			const linkFeature = facet.features.find(
				(feature) =>
					feature?.$type === "app.bsky.richtext.facet#link" &&
					typeof feature.uri === "string" &&
					feature.uri,
			)
			if (linkFeature) {
				linkFacets.push({
					byteStart: facet.index.byteStart,
					byteEnd: facet.index.byteEnd,
					uri: rewriteLove4DogsUrlForLocalhost(linkFeature.uri),
				})
				continue
			}

			continue
		}

		if (linkFacets.length === 0) {
			return escapeHtml(text)
		}

		linkFacets.sort((a, b) => a.byteStart - b.byteStart)

		let html = ""
		let cursor = 0
		for (const facet of linkFacets) {
			const start = byteOffsetToJsIndex(text, facet.byteStart)
			const end = byteOffsetToJsIndex(text, facet.byteEnd)
			if (start < cursor || end <= start) continue

			html += escapeHtml(text.slice(cursor, start))
			html += `<a href="${escapeAttr(facet.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text.slice(start, end))}</a>`
			cursor = end
		}

		html += escapeHtml(text.slice(cursor))
		return html
	}

	function utf8ByteLength(text = "") {
		return utf8Encoder.encode(text).length
	}

	function openImageModal(index) {
		activeImageIndex = index
		showImageModal = true
	}

	function closeImageModal() {
		showImageModal = false
	}

	function getLineFacets(text, facets, lineByteStart, lineByteEnd) {
		return (facets || [])
			.map((facet) => {
				if (!facet?.index) return null
				const start = facet.index.byteStart
				const end = facet.index.byteEnd
				if (start < lineByteStart || end > lineByteEnd) return null
				return {
					...facet,
					index: {
						...facet.index,
						byteStart: start - lineByteStart,
						byteEnd: end - lineByteStart,
					},
				}
			})
			.filter(Boolean)
	}

	function buildBodyLines(body = "", bodyFacets = []) {
		if (!body) return []
		const lines = body.split("\n")
		const output = []
		let byteCursor = 0

		for (let index = 0; index < lines.length; index += 1) {
			const raw = lines[index]
			const lineByteLength = utf8ByteLength(raw)
			const lineByteStart = byteCursor
			const lineByteEnd = lineByteStart + lineByteLength
			const lineFacets = getLineFacets(
				raw,
				bodyFacets,
				lineByteStart,
				lineByteEnd,
			)

			output.push({
				index,
				html: linkifyText(raw, lineFacets),
			})

			byteCursor = lineByteEnd + (index < lines.length - 1 ? 1 : 0)
		}

		return output
	}

	function getPostParts(inputPost) {
		const normalized = String(inputPost?.text || "").replace(/\r\n/g, "\n")
		const newlineIndex = normalized.indexOf("\n")

		if (newlineIndex === -1) {
			return {
				title: normalized.trim(),
				body: "",
				bodyFacets: [],
			}
		}

		const title = normalized.slice(0, newlineIndex).trim()
		const body = normalized.slice(newlineIndex + 1)
		const bodyStartBytes = utf8Encoder.encode(
			normalized.slice(0, newlineIndex + 1),
		).length

		const bodyFacets = (inputPost?.facets || [])
			.map((facet) => {
				const index = facet?.index
				if (!index) return null

				const byteStart = Math.max(0, index.byteStart - bodyStartBytes)
				const byteEnd = index.byteEnd - bodyStartBytes
				if (byteEnd <= 0 || byteEnd <= byteStart) return null

				return {
					...facet,
					index: {
						...index,
						byteStart,
						byteEnd,
					},
				}
			})
			.filter(Boolean)

		return {title, body, bodyFacets}
	}

	function cleanExtractedUrl(raw = "") {
		return String(raw || "")
			.replace(/[),.!?:;\\]+$/g, "")
			.replace(/[\\]+$/g, "")
	}

	function extractCanonicalUrlFromText(source = "") {
		const text = String(source || "")
		if (!text) return ""

		const canonicalPattern =
			/https?:\/\/(?:www\.)?(?:love4dogs\.club|localhost(?::\d+)?)\/profile\/view\/[^\s"'<>]+/i
		const canonicalMatch = text.match(canonicalPattern)
		if (canonicalMatch?.[0]) {
			return cleanExtractedUrl(canonicalMatch[0])
		}

		const keyValuePattern = /canonicalurl\s*[:=]\s*(https?:\/\/\S+)/i
		const keyValueMatch = text.match(keyValuePattern)
		if (keyValueMatch?.[1]) {
			return cleanExtractedUrl(keyValueMatch[1])
		}

		const genericUrlPattern = /https?:\/\/[^\s"'<>]+/i
		const genericMatch = text.match(genericUrlPattern)
		if (genericMatch?.[0]) {
			return cleanExtractedUrl(genericMatch[0])
		}

		return ""
	}

	function normalizeEscapedUrl(value = "") {
		const raw = String(value || "").trim()
		if (!raw) return ""
		return cleanExtractedUrl(raw.replace(/\\\//g, "/"))
	}

	function extractCanonicalUrlFromAltPayload(alt = "") {
		const source = String(alt || "").trim()
		if (!source) return ""

		const fromText = extractCanonicalUrlFromText(source)
		if (fromText) return fromText

		try {
			const parsed = JSON.parse(source)
			const direct = normalizeEscapedUrl(
				parsed?.canonicalurl || parsed?.primary?.canonicalurl || "",
			)
			if (direct) return direct

			if (typeof parsed?.h === "string" && parsed.h.trim()) {
				const fromHText = extractCanonicalUrlFromText(parsed.h)
				if (fromHText) return fromHText
				try {
					const inner = JSON.parse(parsed.h)
					const nested = normalizeEscapedUrl(
						inner?.canonicalurl ||
							inner?.primary?.canonicalurl ||
							"",
					)
					if (nested) return nested
				} catch {
					// Continue with regex fallback below.
				}
			}
		} catch {
			// Not JSON alt payload; continue with escaped regex fallback.
		}

		const escapedPattern = new RegExp(
			"https?:\\\\/\\\\/(?:www\\\\.)?(?:love4dogs\\\\.club|localhost(?::\\\\d+)?)\\\\/profile\\\\/view\\\\/[^\\\\s\"'<>]+",
			"i",
		)
		const escapedMatch = source.match(escapedPattern)
		if (escapedMatch?.[0]) {
			return normalizeEscapedUrl(escapedMatch[0])
		}

		return ""
	}

	function extractCanonicalUrl(inputPost = {}) {
		for (const facet of inputPost?.facets || []) {
			for (const feature of facet?.features || []) {
				if (feature?.$type !== "app.bsky.richtext.facet#link") continue
				const uri = String(feature?.uri || "").trim()
				if (!uri) continue
				if (/\/profile\/view\//i.test(uri)) {
					return rewriteLove4DogsUrlForLocalhost(
						cleanExtractedUrl(uri),
					)
				}
			}
		}

		for (const alt of inputPost?.imageAlts || []) {
			const fromAlt = extractCanonicalUrlFromAltPayload(alt)
			if (fromAlt) return rewriteLove4DogsUrlForLocalhost(fromAlt)
		}

		const fromVideoAlt = extractCanonicalUrlFromAltPayload(
			inputPost?.video?.alt || "",
		)
		if (fromVideoAlt) return rewriteLove4DogsUrlForLocalhost(fromVideoAlt)

		return ""
	}

	function collectCanonicalDebug(inputPost = {}) {
		const facetLinks = []
		for (const facet of inputPost?.facets || []) {
			for (const feature of facet?.features || []) {
				if (feature?.$type !== "app.bsky.richtext.facet#link") continue
				const uri = String(feature?.uri || "").trim()
				if (uri) facetLinks.push(uri)
			}
		}

		const imageAltSamples = (inputPost?.imageAlts || [])
			.filter((entry) => typeof entry === "string")
			.slice(0, 2)
			.map((entry) => entry.slice(0, 200))

		return {
			uri: String(inputPost?.uri || ""),
			title: getPostParts(inputPost).title,
			textSnippet: String(inputPost?.text || "").slice(0, 200),
			facetLinks,
			imageAltsCount: Array.isArray(inputPost?.imageAlts)
				? inputPost.imageAlts.length
				: 0,
			imageAltSamples,
			videoAltSnippet: String(inputPost?.video?.alt || "").slice(0, 200),
		}
	}

	function extractUuidFromCanonical(url = "") {
		const canonical = String(url || "").trim()
		if (!canonical) return null

		const viewMatch = canonical.match(/profile\/view\/([^/]+)/i)
		if (viewMatch) {
			return {
				uuid: viewMatch[1],
			}
		}

		const pathMatch = canonical.match(
			/https?:\/\/[^/]+\/([^/?#]+)(?:\/|\?|#|$)/i,
		)
		if (pathMatch) {
			return {
				uuid: pathMatch[1],
			}
		}

		return null
	}

	function slugifyProfileTitle(value = "") {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
	}

	function extractSlugFromCanonical(rawCanonical = "", uuid = "") {
		const source = String(rawCanonical || "").trim()
		if (!source) return ""

		try {
			const base =
				typeof window !== "undefined"
					? window.location.origin
					: "http://localhost"
			const normalized = new URL(source, base)
			const segments = (normalized.pathname || "")
				.split("/")
				.map((segment) => segment.trim())
				.filter(Boolean)

			const viewIndex = segments.findIndex((segment) =>
				/^view$/i.test(segment),
			)
			if (viewIndex >= 0 && segments[viewIndex + 2]) {
				return segments[viewIndex + 2]
			}

			if (uuid && segments[0] === uuid && segments[1]) {
				return segments[1]
			}
		} catch {
			// Fall back to title-derived slug.
		}

		return ""
	}

	function buildViewPath(
		rawCanonical = "",
		fallbackTitle = "",
		basePath = "",
		fallbackReturn = "",
	) {
		const source = String(rawCanonical || "").trim()
		const parsed = extractUuidFromCanonical(source)
		const uuid = String(parsed?.uuid || "").trim()
		if (!uuid) return fallbackReturn

		const slugFromCanonical = extractSlugFromCanonical(source, uuid)
		const fallbackSlug = slugifyProfileTitle(fallbackTitle) || uuid
		const slug = slugFromCanonical || fallbackSlug

		return `${basePath}/${encodeURIComponent(uuid)}/${encodeURIComponent(slug)}`
	}

	function buildProfileViewPath(rawCanonical = "", fallbackTitle = "") {
		return buildViewPath(rawCanonical, fallbackTitle, "/profile/view", "")
	}

	function buildPostViewPath(rawCanonical = "", fallbackTitle = "") {
		return buildViewPath(
			rawCanonical,
			fallbackTitle,
			"/post/view",
			"/post/view",
		)
	}

	function extractProfileDataFromBundle(alt = "") {
		if (!alt) return null
		const source = String(alt || "").trim()
		if (!source) return null

		try {
			const parsed = JSON.parse(source)

			const candidates = [
				parsed,
				parsed?.primary,
				parsed?.combined?.primary,
			]

			if (typeof parsed?.h === "string" && parsed.h.trim()) {
				try {
					const inner = JSON.parse(parsed.h)
					candidates.push(
						inner,
						inner?.primary,
						inner?.combined?.primary,
					)
				} catch {
					// Keep best-effort parsing from known candidate roots.
				}
			}

			const pick = (keys = []) => {
				for (const candidate of candidates) {
					if (!candidate || typeof candidate !== "object") continue
					for (const key of keys) {
						const rawValue = candidate?.[key]
						if (typeof rawValue !== "string") continue
						const value = rawValue.trim()
						if (value) return value
					}
				}
				return ""
			}

			const profilePic = normalizeProfileImageUrl(
				pick(["profilePic", "profilepic"]),
			)
			const backgroundPic = normalizeProfileImageUrl(
				pick(["backgroundPic", "backgroundpic"]),
			)
			const name = pick(["name", "title", "n"])
			const description = pick(["description", "desc"])
			const canonicalurl = normalizeEscapedUrl(
				pick(["canonicalurl", "canonicalUrl"]),
			)

			if (
				!profilePic &&
				!backgroundPic &&
				!canonicalurl &&
				!name &&
				!description
			)
				return null

			return {
				profilePic: profilePic || null,
				backgroundPic: backgroundPic || null,
				profileName: name || null,
				profileDescription: description || null,
				canonicalUrl: canonicalurl || null,
			}
		} catch {
			return null
		}
	}

	function extractPostDataFromBundle(alt = "") {
		if (!alt) return null
		const source = String(alt || "").trim()
		if (!source) return null

		try {
			const parsed = JSON.parse(source)

			const candidates = [
				parsed,
				parsed?.primary,
				parsed?.combined?.primary,
			]

			if (typeof parsed?.h === "string" && parsed.h.trim()) {
				try {
					const inner = JSON.parse(parsed.h)
					candidates.push(
						inner,
						inner?.primary,
						inner?.combined?.primary,
					)
				} catch {
					// Keep best-effort parsing from known candidate roots.
				}
			}

			const pick = (keys = []) => {
				for (const candidate of candidates) {
					if (!candidate || typeof candidate !== "object") continue
					for (const key of keys) {
						const rawValue = candidate?.[key]
						if (typeof rawValue !== "string") continue
						const value = rawValue.trim()
						if (value) return value
					}
				}
				return ""
			}

			const title = pick(["title", "name", "n"])
			const description = pick(["summary", "description", "desc"])

			if (!title && !description) return null

			return {
				title: title || null,
				description: description || null,
			}
		} catch {
			return null
		}
	}

	function detectProfilePost(inputPost = {}, fallbackCanonicalUrl = "") {
		if (!inputPost) return null
		const explicitType = String(inputPost?.postType || "")
			.trim()
			.toLowerCase()
		if (explicitType && explicitType !== "profile") return null

		const withImageFallback = (profile = null) => {
			if (!profile) return null
			const nextProfilePic = profile?.profilePic || null
			if (!nextProfilePic) return null
			return {
				...profile,
				profilePic: nextProfilePic,
				backgroundPic: profile?.backgroundPic || null,
			}
		}

		for (const alt of inputPost?.imageAlts || []) {
			const profileData = extractProfileDataFromBundle(alt)
			if (profileData) {
				return withImageFallback({
					...profileData,
					canonicalUrl:
						profileData?.canonicalUrl ||
						fallbackCanonicalUrl ||
						null,
				})
			}
		}

		const videoAlt = extractProfileDataFromBundle(
			inputPost?.video?.alt || "",
		)
		if (videoAlt) {
			return withImageFallback({
				...videoAlt,
				canonicalUrl:
					videoAlt?.canonicalUrl || fallbackCanonicalUrl || null,
			})
		}

		return null
	}

	const parts = $derived(getPostParts(post))
	const canonicalUrl = $derived(extractCanonicalUrl(post))
	const detectedProfileData = $derived(detectProfilePost(post, canonicalUrl))
	const profileData = $derived.by(() => {
		if (!detectedProfileData) return null
		if (
			String(post?.postType || "")
				.trim()
				.toLowerCase() !== "profile"
		) {
			return null
		}
		if (!detectedProfileData?.profilePic) return null
		return {
			...detectedProfileData,
			canonicalUrl:
				detectedProfileData?.canonicalUrl || canonicalUrl || null,
		}
	})
	const profileViewHref = $derived.by(() => {
		if (!profileData) return ""
		return buildProfileViewPath(
			profileData?.canonicalUrl || canonicalUrl || "",
			parts?.title || "",
		)
	})
	const detectedPostData = $derived.by(() => {
		if (profileData) return null

		for (const alt of post?.imageAlts || []) {
			const payload = extractPostDataFromBundle(alt)
			if (payload) return payload
		}

		const videoPayload = extractPostDataFromBundle(post?.video?.alt || "")
		if (videoPayload) return videoPayload

		return null
	})
	const postViewHref = $derived.by(() =>
		buildPostViewPath(canonicalUrl || "", parts?.title || ""),
	)
	const displayTitle = $derived.by(() => {
		if (profileData) return ""
		if (parts?.title) return parts.title
		return String(detectedPostData?.title || "").trim()
	})
	const displayDescription = $derived.by(() => {
		if (profileData) return ""
		const directDescription = String(post?.description || "").trim()
		if (directDescription) return directDescription
		const bodyDescription = String(parts?.body || "").trim()
		if (bodyDescription) return bodyDescription
		return String(detectedPostData?.description || "").trim()
	})
	const titleHref = $derived(canonicalUrl)
	const titleHtml = $derived(escapeHtml(parts.title))
	const bodyLines = $derived(buildBodyLines(parts.body, parts.bodyFacets))

	const comments = $derived(post.comments || [])
	const postVideo = $derived(post.video || null)
	const uniqueImages = $derived(uniqueImageUrls(post.images || []))
	const cardImages = $derived.by(() => {
		if (profileData) return []
		return uniqueImages.slice(0, 4)
	})

	$effect(() => {
		if (!post?.uri) return

		if (!profileData) {
			console.log("[PostCard] profile header: not detected", {
				uri: post.uri,
				galleryCount: uniqueImages.length,
			})
			return
		}

		const headerImages = [
			profileData?.profilePic,
			profileData?.backgroundPic,
		]
			.map((image) => normalizeComparableImageUrl(image))
			.filter(Boolean)

		const removedImages = uniqueImages.filter((image) => {
			const normalized = normalizeComparableImageUrl(image)
			return headerImages.includes(normalized)
		})

		console.log("[PostCard] profile header/gallery reconciliation", {
			uri: post.uri,
			profilePic: profileData?.profilePic || null,
			backgroundPic: profileData?.backgroundPic || null,
			headerImageCount: headerImages.length,
			galleryBeforeCount: uniqueImages.length,
			galleryAfterCount: cardImages.length,
			removedCount: removedImages.length,
			removedImages,
		})
	})

	$effect(() => {
		if (!parts.title) return

		if (titleHref) {
			console.log("[PostCard] canonical URL resolved", {
				uri: post?.uri || "",
				title: parts.title,
				titleHref,
			})
			return
		}

		console.warn("[PostCard] missing canonical URL", {
			...collectCanonicalDebug(post),
		})
	})
</script>

<article class="post-card">
	{#if selectionEnabled}
		<button
			type="button"
			class="select-btn"
			class:is-selected={selected}
			onclick={() => onToggleSelect(post.uri)}
			aria-label={selected ? "Unselect card" : "Select card"}
		>
			<span class="select-dot">{selected ? "✓" : ""}</span>
		</button>
	{/if}

	{#if bookmarked || selectable}
		<div class="post-card-right-badges">
			{#if bookmarked}
				<div class="bookmark-badge" title="Favorited">
					<PawPrint size={16} />
				</div>
			{/if}
			{#if selectable}
				<a
					href={`/post?uri=${encodeURIComponent(post.uri)}`}
					class="edit-badge"
					title="Edit this post"
					aria-label="Edit this post"
					onclick={(e) => e.stopPropagation()}
				>
					<Pencil size={14} />
				</a>
			{/if}
		</div>
	{/if}

	{#if profileData}
		<ProfilePostHeader
			profilePic={profileData.profilePic}
			backgroundPic={profileData.backgroundPic}
			title={profileData.profileName}
			description={profileData.profileDescription}
			url={profileViewHref || postViewHref}
		/>
	{:else if displayTitle || displayDescription}
		<a class="post-view-link" href={postViewHref}>
			{#if displayTitle}
				<h3 class="post-title">{displayTitle}</h3>
			{/if}
			{#if displayDescription}
				<p class="post-description">
					{displayDescription}
				</p>
			{/if}
		</a>
	{/if}

	{#if !profileData && parts.body}
		<div class="post-text">
			{#each bodyLines as line (line.index)}
				{#if line.html}
					<div class="post-line">{@html line.html}</div>
				{:else}
					<div
						class="post-line post-line-spacer"
						aria-hidden="true"
					></div>
				{/if}
			{/each}
		</div>
	{/if}
	{#if cardImages.length}
		<div
			class="post-images"
			class:single-image={cardImages.length === 1}
			class:two-images={cardImages.length === 2}
			class:three-images={cardImages.length === 3}
			class:four-images={cardImages.length === 4}
		>
			{#each cardImages as image, index}
				<button
					type="button"
					class="post-image-btn"
					class:image-large-left={cardImages.length === 3 &&
						index === 0}
					onclick={() => openImageModal(index)}
					aria-label={`Open image ${index + 1} of ${cardImages.length}`}
				>
					<img src={image} alt="Dog post" loading="lazy" />
				</button>
			{/each}
		</div>
	{/if}

	{#if postVideo?.playlist}
		<div class="post-video">
			<!-- svelte-ignore a11y_media_has_caption (source does not provide caption tracks) -->
			<video
				controls
				playsinline
				preload="metadata"
				poster={postVideo.thumbnail || undefined}
				src={postVideo.playlist}
			></video>
		</div>
	{/if}

	<PostImageViewer
		open={showImageModal}
		images={cardImages}
		activeIndex={activeImageIndex}
		onClose={closeImageModal}
		onChangeIndex={(index) => (activeImageIndex = index)}
	/>

	<a
		class="post-footer"
		href={bskyUrl(post.uri)}
		target="_blank"
		rel="noopener noreferrer"
	>
		<div class="post-stats">
			<span class="stat"><Heart size={13} />{post.likeCount}</span>
			<span class="stat"><Repeat2 size={13} />{post.repostCount}</span>
			<span class="stat"
				><MessageCircle size={13} />{post.replyCount}</span
			>
			{#if post.createdAt}<span class="stat-date"
					>{formatDate(post.createdAt)}</span
				>{/if}
		</div>
		{#if post.replyCount > 0 && comments.length > 0}
			<ul class="comments-list">
				{#each comments as c}
					<li class="comment">
						{#if c.avatar}
							<img
								class="comment-avatar"
								src={c.avatar}
								alt={`@${c.handle}`}
								loading="lazy"
							/>
						{:else}
							<span
								class="comment-avatar comment-avatar-fallback"
								aria-hidden="true"
							></span>
						{/if}
						<div class="comment-main">
							<span class="comment-author">@{c.handle}</span>
							<span class="comment-text">{c.text}</span>
						</div>
					</li>
				{/each}
			</ul>
			<div class="comment-compose-disabled" aria-hidden="true">
				<div class="comment-input-disabled">
					Add your comments on BlueSky {@html siBluesky.svg}
				</div>
				<div class="comment-submit-disabled">Submit</div>
			</div>
		{:else}
			<div class="comment-compose-disabled" aria-hidden="true">
				<div class="comment-input-disabled">
					Be the first to comment on BlueSky {@html siBluesky.svg}
				</div>
				<div class="comment-submit-disabled">Submit</div>
			</div>
		{/if}
	</a>

	<Share {post} shareUrl={bskyUrl(post.uri)} />
</article>

<style>
	.post-card {
		position: relative;
		border: 1px solid #e2d4c5;
		border-radius: 12px;
		padding: 0.75rem;
		background: #fff;
		box-shadow: 0 2px 8px rgba(46, 28, 12, 0.08);
		box-sizing: border-box;
		overflow: hidden;
		break-inside: avoid;
		-webkit-column-break-inside: avoid;
		page-break-inside: avoid;
		display: block;
		width: auto;
		margin: 0 0 0.8rem;
	}

	.select-btn {
		position: absolute;
		top: 0.45rem;
		left: 0.45rem;
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
		z-index: 2;
	}

	.select-btn.is-selected {
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}

	.select-dot {
		font-size: 0.85rem;
		line-height: 1;
		font-weight: 700;
	}

	.post-card-right-badges {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		flex-direction: row;
		gap: 0.35rem;
		z-index: 2;
	}

	.bookmark-badge {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: rgba(251, 236, 178, 0.95);
		border: 1px solid #d5b650;
		color: #7a5f00;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.edit-badge {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: rgba(235, 245, 255, 0.95);
		border: 1px solid #93b8e0;
		color: #2d5f9a;
		display: flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
	}

	.edit-badge:hover {
		background: #dbeafe;
		border-color: #2d5f9a;
	}

	.post-view-link {
		display: block;
		color: inherit;
		text-decoration: none;
		margin-top: 0.15rem;
	}

	.post-view-link:hover .post-title,
	.post-view-link:hover .post-description {
		color: #1a4a7a;
	}

	.post-title {
		margin: 0;
		margin-left: 2rem;
		font-family: inherit;
		font-size: 1.35rem;
		line-height: 1.05;
		font-weight: 700;
		color: #1f1f1f;
		word-break: break-word;
	}

	.post-description {
		margin: 0.35rem 0 0;
		font-size: 0.92rem;
		line-height: var(--line-height-body);
		color: var(--color-text-body);
		word-break: break-word;
	}

	.post-text {
		margin: 0.35rem 0 0;
		line-height: 1.35;
		word-break: break-word;
	}

	.post-line-spacer {
		height: 1em;
	}

	.post-text :global(a) {
		color: #2d5f9a;
		text-decoration: underline;
	}

	.post-image-btn {
		padding: 0;
		margin: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		width: 100%;
		text-align: left;
	}

	.post-image-btn.image-large-left {
		grid-row: span 2;
	}

	.post-images {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.45rem;
		margin-top: 0.65rem;
	}

	.post-images.single-image {
		grid-template-columns: 1fr;
	}

	.post-images.two-images {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.post-images.three-images,
	.post-images.four-images {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.post-images.three-images {
		grid-template-rows: repeat(2, minmax(110px, 1fr));
	}

	.post-images img {
		width: 100%;
		aspect-ratio: 1 / 1;
		height: auto;
		object-fit: cover;
		border-radius: 9px;
		box-shadow: 0 2px 7px rgba(39, 23, 10, 0.12);
		display: block;
	}

	.post-images.single-image img,
	.post-images .post-image-btn.image-large-left img {
		aspect-ratio: 4 / 5;
	}

	.post-images.single-image img {
		aspect-ratio: 16 / 10;
		max-height: 460px;
	}

	.post-video {
		margin-top: 0.65rem;
	}

	.post-video video {
		width: 100%;
		max-height: 460px;
		display: block;
		border-radius: 9px;
		background: #000;
		box-shadow: 0 2px 7px rgba(39, 23, 10, 0.12);
	}

	.post-footer {
		display: block;
		margin-top: 0.6rem;
		border-top: 1px solid #ede5d8;
		text-decoration: none;
		cursor: pointer;
	}

	.post-stats {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		flex-wrap: wrap;
	}

	.stat {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: #6b7280;
	}

	.stat-date {
		font-size: 0.78rem;
		color: #9ca3af;
		margin-left: auto;
	}

	.post-footer .post-stats {
		padding: 0.4rem 0;
	}

	.post-footer:hover .stat {
		color: #1a4a7a;
	}

	.comments-list {
		list-style: none;
		margin: 0 -0.75rem;
		padding: 0.55rem 0.75rem 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: calc(100% + 1.5rem);
		background: #faf7f3;
		border-top: 1px solid #ede5d8;
	}

	.comment {
		font-size: 0.82rem;
		line-height: 1.35;
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.comment-avatar {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		object-fit: cover;
		border: 1px solid #d9ccb9;
		background: #fff;
		flex: 0 0 32px;
		margin-top: 1px;
	}

	.comment-avatar-fallback {
		background: #e4ddd2;
	}

	.comment-main {
		display: flex;
		flex-direction: column;
		gap: 0.08rem;
		min-width: 0;
	}

	.comment-author {
		font-weight: 600;
		color: #3b6e4f;
		font-size: 0.78rem;
	}

	.comment-text {
		color: #374151;
		word-break: break-word;
	}

	.comment-compose-disabled {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 -0.75rem;
		padding: 0.5rem 0.75rem 0.2rem;
		width: calc(100% + 1.5rem);
		box-sizing: border-box;
	}

	.comment-input-disabled {
		flex: 1;
		height: 34px;
		display: flex;
		align-items: center;
		padding: 0 0.7rem;
		border-radius: 999px;
		border: 1px solid #d8d3ca;
		background: #f5f2ed;
		color: #9a9388;
		font-size: 0.82rem;
	}

	.comment-input-disabled :global(svg) {
		width: 1em;
		height: 1em;
		vertical-align: middle;
		margin-left: 0.3em;
		fill: currentColor;
		flex-shrink: 0;
	}

	.comment-submit-disabled {
		height: 34px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 0.9rem;
		border-radius: 999px;
		border: 1px solid #cfd7cf;
		background: #e7ece7;
		color: #8f998f;
		font-size: 0.78rem;
		font-weight: 600;
	}
</style>
