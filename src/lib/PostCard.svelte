<script>
	import {
		Heart,
		MessageCircle,
		PawPrint,
		Pencil,
		Repeat2,
	} from "lucide-svelte"
	import {onMount} from "svelte"
	import {CONTACT_LOCK_PREFIX, decryptContact} from "$lib/utils"
	import PostImageViewer from "$lib/PostImageViewer.svelte"
	import Share from "$lib/Share.svelte"

	import {siBluesky} from "simple-icons"

	let {
		post,
		selected = false,
		bookmarked = false,
		selectable = true,
		onToggleSelect = () => {},
	} = $props()

	let isMyPost = $state(false)

	const MY_POSTS_KEY = "love4dogs.my-post-uris"

	onMount(() => {
		try {
			if (window.location.hostname === "localhost") {
				isMyPost = true
			} else {
				const uris = JSON.parse(
					localStorage.getItem(MY_POSTS_KEY) || "[]",
				)
				isMyPost = Array.isArray(uris) && uris.includes(post.uri)
			}
		} catch {
			// ignore
		}
	})
	let imageDimensions = $state({})
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

	function sortCardImages(images = [], dimensions = {}) {
		if (!Array.isArray(images) || images.length <= 1) return [...images]

		const result = [...images]
		const sortableEnd = Math.min(4, result.length)
		const sortable = result.slice(1, sortableEnd)
		const originalOrder = new Map(
			sortable.map((image, index) => [image, index]),
		)

		sortable.sort((left, right) => {
			const leftWidth = dimensions[left]?.width || 0
			const rightWidth = dimensions[right]?.width || 0
			if (leftWidth !== rightWidth) return rightWidth - leftWidth
			return (
				(originalOrder.get(left) || 0) - (originalOrder.get(right) || 0)
			)
		})

		return [result[0], ...sortable, ...result.slice(sortableEnd)]
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
				const url = match[0]
				const start = match.index ?? 0
				html += escapeHtml(plainText.slice(cursor, start))
				html += `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
				cursor = start + url.length
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
					uri: linkFeature.uri,
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

	function isLockedLine(text = "") {
		return text.startsWith(CONTACT_LOCK_PREFIX)
	}

	let unlockedBodyLines = $state({})

	function decryptLockedLine(text = "") {
		const payload = text.slice(CONTACT_LOCK_PREFIX.length).trim()
		if (!payload) return text
		try {
			return decryptContact(payload)
		} catch {
			return text
		}
	}

	function toggleLockedBodyLine(index) {
		unlockedBodyLines = {
			...unlockedBodyLines,
			[index]: !unlockedBodyLines[index],
		}
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

	function buildBodyLines(body = "", bodyFacets = [], unlocked = {}) {
		if (!body) return []
		const lines = body.split("\n")
		const output = []
		let byteCursor = 0

		for (let index = 0; index < lines.length; index += 1) {
			const raw = lines[index]
			const lineByteLength = utf8ByteLength(raw)
			const lineByteStart = byteCursor
			const lineByteEnd = lineByteStart + lineByteLength
			const locked = isLockedLine(raw)
			const unlockedLine = Boolean(unlocked[index])
			const displayText =
				locked && unlockedLine ? decryptLockedLine(raw) : raw
			const lineFacets =
				locked && unlockedLine
					? []
					: getLineFacets(raw, bodyFacets, lineByteStart, lineByteEnd)

			output.push({
				index,
				raw,
				locked,
				unlocked: unlockedLine,
				html: linkifyText(displayText, lineFacets),
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
		return String(raw || "").replace(/[),.!?:;]+$/g, "")
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
					return cleanExtractedUrl(uri)
				}
			}
		}

		for (const alt of inputPost?.imageAlts || []) {
			const fromAlt = extractCanonicalUrlFromAltPayload(alt)
			if (fromAlt) return fromAlt
		}

		const fromVideoAlt = extractCanonicalUrlFromAltPayload(
			inputPost?.video?.alt || "",
		)
		if (fromVideoAlt) return fromVideoAlt

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

		const match = canonical.match(/profile\/view\/([^/]+)/i)
		if (match) {
			return {
				uuid: match[1],
			}
		}

		return null
	}

	async function resolveTitleClick() {
		if (!canonicalUrl) return

		const parsed = extractUuidFromCanonical(canonicalUrl)
		if (!parsed) {
			console.warn(
				"[PostCard] Could not parse UUID from canonical URL",
				canonicalUrl,
			)
			return
		}

		try {
			// Navigate to profile view with uuid
			window.location.href = `/profile/view/${encodeURIComponent(parsed.uuid)}/`
		} catch (err) {
			console.error("[PostCard] Error resolving title click", err)
		}
	}

	const parts = $derived(getPostParts(post))
	const canonicalUrl = $derived(extractCanonicalUrl(post))
	const titleHref = $derived(canonicalUrl)
	const titleHtml = $derived(escapeHtml(parts.title))
	const bodyLines = $derived(
		buildBodyLines(parts.body, parts.bodyFacets, unlockedBodyLines),
	)

	const comments = $derived(post.comments || [])
	const postVideo = $derived(post.video || null)
	const sortedImages = $derived(
		sortCardImages(post.images || [], imageDimensions),
	)
	const threeImageFirstIsWidest = $derived.by(() => {
		if (sortedImages.length !== 3) return false
		const [first, second, third] = sortedImages
		const firstWidth = imageDimensions[first]?.width
		const secondWidth = imageDimensions[second]?.width
		const thirdWidth = imageDimensions[third]?.width
		if (
			!Number.isFinite(firstWidth) ||
			!Number.isFinite(secondWidth) ||
			!Number.isFinite(thirdWidth)
		) {
			return false
		}
		return firstWidth >= secondWidth && firstWidth >= thirdWidth
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

	$effect(() => {
		if (typeof window === "undefined") return
		const images = Array.isArray(post.images) ? post.images : []
		if (!images.length) return

		let cancelled = false
		for (const image of images) {
			if (!image || imageDimensions[image]) continue

			const probe = new Image()
			probe.onload = () => {
				if (cancelled) return
				imageDimensions = {
					...imageDimensions,
					[image]: {
						width: probe.naturalWidth,
						height: probe.naturalHeight,
						area: probe.naturalWidth * probe.naturalHeight,
					},
				}
			}
			probe.onerror = () => {
				if (cancelled) return
				imageDimensions = {
					...imageDimensions,
					[image]: {
						width: 0,
						height: 0,
						area: 0,
					},
				}
			}
			probe.src = image
		}

		return () => {
			cancelled = true
		}
	})
</script>

<article class="post-card">
	{#if selectable}
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

	{#if bookmarked || isMyPost}
		<div class="post-card-right-badges">
			{#if bookmarked}
				<div class="bookmark-badge" title="Favorited">
					<PawPrint size={16} />
				</div>
			{/if}
			{#if isMyPost}
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

	{#if parts.title}
		<h3 class="post-title">
			{#if titleHref}
				<a
					class="post-title-link"
					href={titleHref}
					onclick={(event) => {
						event.preventDefault()
						event.stopPropagation()
						console.log("[PostCard] title link click", {
							uri: post?.uri || "",
							title: parts.title,
							titleHref,
						})
						resolveTitleClick()
					}}
				>
					{@html titleHtml}
				</a>
			{:else}
				{@html titleHtml}
			{/if}
		</h3>
	{/if}
	{#if parts.body}
		<div class="post-text">
			{#each bodyLines as line (line.index)}
				{#if line.locked && !line.unlocked}
					<button
						type="button"
						class="locked-line"
						onclick={(event) => {
							event.stopPropagation()
							toggleLockedBodyLine(line.index)
						}}
					>
						{line.raw}
					</button>
				{:else if line.html}
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
	{#if sortedImages.length}
		<div
			class="post-images"
			class:single-image={sortedImages.length === 1}
			class:two-images={sortedImages.length === 2}
			class:three-images={sortedImages.length === 3}
			class:four-images={sortedImages.length >= 4}
		>
			{#each sortedImages as image, index}
				<button
					type="button"
					class="post-image-btn"
					class:image-wide={sortedImages.length === 1 ||
						sortedImages.length === 2 ||
						(sortedImages.length === 3 &&
							((threeImageFirstIsWidest && index === 0) ||
								(!threeImageFirstIsWidest && index === 2)))}
					onclick={() => openImageModal(index)}
					aria-label={`Open image ${index + 1} of ${sortedImages.length}`}
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
		images={sortedImages}
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

	.post-title {
		margin: 0 2.2rem 0 2.2rem;
		font-size: 1.02rem;
		font-weight: 700;
		line-height: 1.3;
	}

	.post-title-link {
		color: inherit;
		text-decoration: none;
		cursor: pointer;
	}

	.post-title-link:hover,
	.post-title-link:focus-visible {
		text-decoration: underline;
	}

	.post-text {
		margin: 0.35rem 0 0;
		line-height: 1.35;
		word-break: break-word;
	}

	.post-line-spacer {
		height: 1em;
	}

	.locked-line {
		display: block;
		/* width: 100%; */
		border: none;
		background: #f5eee3;
		box-shadow:
			inset 0 0 0 1px rgba(255, 255, 255, 0.45),
			0 1px 4px rgba(74, 49, 24, 0.12);
		color: #5f4b2d;
		text-align: left;
		padding: 0.15rem 0.4rem;
		margin: 0;
		border-radius: 6px;
		cursor: pointer;
		font: inherit;
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

	.post-image-btn.image-wide {
		grid-column: 1 / -1;
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
	.post-images.two-images img,
	.post-images .post-image-btn.image-wide img {
		aspect-ratio: auto;
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
