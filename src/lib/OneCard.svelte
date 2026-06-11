<script>
	import {onMount} from "svelte"
	import {rewriteLove4DogsUrlForLocalhost} from "$lib/utils"
	import {
		CircleAlert as NoticeIcon,
		Heart,
		MessageCircle,
		Repeat2,
		User,
	} from "lucide-svelte"
	import {siBluesky} from "simple-icons"
	import TagPills from "$lib/TagPills.svelte"
	import ImageLayout from "$lib/ImageLayout.svelte"
	import AuthorRow from "$lib/AuthorRow.svelte"
	import DateTime from "$lib/DateTime.svelte"
	import {formatDisplayAddress} from "$lib/addressFormat"
	import {writeSearchTerm, readSearchTerm} from "$lib/searchStore"

	let {post, onclick = () => {}, onTagClick = () => {}} = $props()
	let hasHydrated = $state(false)
	let discussionComment = $state(null)
	let loadingComment = $state(true)
	const altCandidatesCache = new Map()
	const altRecordCache = new Map()
	const altLocationCache = new Map()

	const BSKY_HANDLE = "love4dogs.club"

	function getAltCandidates(alt = "") {
		const source = String(alt || "").trim()
		if (!source) return []
		if (altCandidatesCache.has(source)) {
			return altCandidatesCache.get(source)
		}

		let candidates = []
		try {
			const parsed = JSON.parse(source)
			candidates = [parsed, parsed?.primary, parsed?.combined?.primary]

			if (typeof parsed?.h === "string" && parsed.h.trim()) {
				try {
					const inner = JSON.parse(parsed.h)
					candidates.push(
						inner,
						inner?.primary,
						inner?.combined?.primary,
					)
				} catch {}
			}
		} catch {
			candidates = []
		}

		const normalized = candidates.filter(
			(candidate) => candidate && typeof candidate === "object",
		)
		altCandidatesCache.set(source, normalized)
		return normalized
	}

	function bskyUrl(uri = "") {
		const rkey = uri.split("/").pop()
		return `https://bsky.app/profile/${BSKY_HANDLE}/post/${rkey}`
	}

	function extractUuidFromBundleAlt(alt = "") {
		for (const candidate of getAltCandidates(alt)) {
			const directUuid = String(
				candidate?.u || candidate?.uuid || candidate?.id || "",
			).trim()
			if (directUuid) return directUuid
		}

		return ""
	}

	function extractTagsFromBundleAlt(alt = "") {
		for (const candidate of getAltCandidates(alt)) {
			const rawTags = Array.isArray(candidate?.tags) ? candidate.tags : []
			if (rawTags.length) {
				return rawTags
					.map((tag) =>
						String(tag || "")
							.trim()
							.toLowerCase(),
					)
					.filter(Boolean)
			}
		}

		return []
	}

	function resolveCardUuid(inputPost = {}) {
		const directUuid = String(inputPost?.uuid || "").trim()
		if (directUuid) return directUuid

		for (const alt of inputPost?.imageAlts || []) {
			const fromAlt = extractUuidFromBundleAlt(alt)
			if (fromAlt) return fromAlt
		}

		return extractUuidFromBundleAlt(inputPost?.video?.alt || "")
	}

	function resolvePostTags(inputPost = {}) {
		const directTags = Array.isArray(inputPost?.tags) ? inputPost.tags : []
		const normalizedDirectTags = directTags
			.map((tag) =>
				String(tag || "")
					.trim()
					.toLowerCase(),
			)
			.filter(Boolean)
		if (normalizedDirectTags.length) return normalizedDirectTags

		for (const alt of inputPost?.imageAlts || []) {
			const altTags = extractTagsFromBundleAlt(alt)
			if (altTags.length) return altTags
		}

		return extractTagsFromBundleAlt(inputPost?.video?.alt || "")
	}

	function slugifyValue(value = "") {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
	}

	function buildCardViewPath(
		fallbackTitle = "",
		cardType = "post",
		inputPost = {},
	) {
		const uuid = resolveCardUuid(inputPost)
		if (!uuid) return ""

		const pathType =
			String(cardType || "post")
				.trim()
				.toLowerCase() === "profile"
				? "profile"
				: "post"
		const fallbackSlug = slugifyValue(fallbackTitle) || uuid
		const slug = fallbackSlug

		return `/${pathType}/view/${encodeURIComponent(uuid)}/${encodeURIComponent(slug)}`
	}

	function getRecord(alt = "") {
		if (!alt) return null
		const source = String(alt || "").trim()
		if (!source) return null
		if (altRecordCache.has(source)) {
			return altRecordCache.get(source)
		}

		try {
			const candidates = getAltCandidates(source)
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

			const profilePic = pick(["profilePic", "profilepic"])
			const backgroundPic = pick(["backgroundPic", "backgroundpic"])
			const name = pick(["name", "title", "n"])
			const description = pick(["description", "desc"])

			if (!profilePic && !backgroundPic && !name && !description)
				return altRecordCache.set(source, null), null

			const recordData = {
				profilePic: profilePic || null,
				backgroundPic: backgroundPic || null,
				name: name || null,
				description: description || null,
			}
			altRecordCache.set(source, recordData)
			return recordData
		} catch {
			altRecordCache.set(source, null)
			return null
		}
	}

	function normalizeImageUrl(value = "") {
		const source = String(value || "").trim()
		if (!source) return ""
		if (!/^https?:\/\//i.test(source)) return ""
		if (!hasHydrated) return source
		return rewriteLove4DogsUrlForLocalhost(source)
	}

	onMount(async () => {
		hasHydrated = true
		
		const uuid = resolveCardUuid(post)
		if (uuid) {
			try {
				const res = await fetch(`/api/feed?query=${encodeURIComponent(uuid)}&limit=1&chat=1`)
				if (res.ok) {
					const data = await res.json()
					const posts = data?.posts || []
					if (posts.length > 0) {
						const firstPost = posts[0]
						if (firstPost.imageAlts && firstPost.imageAlts.length > 0) {
							try {
								const payload = JSON.parse(firstPost.imageAlts[0])
								if (payload && payload.uuid && payload.context === uuid) {
									discussionComment = {
										handle: firstPost.author?.handle || "anonymous",
										name: firstPost.author?.displayName || firstPost.author?.handle || "Anonymous",
										avatar: firstPost.author?.avatar || "",
										text: payload.text || firstPost.text || ""
									}
								}
							} catch {}
						}
					}
				}
			} catch (err) {
				console.error("Failed to load discussion comment for card:", uuid, err)
			} finally {
				loadingComment = false
			}
		} else {
			loadingComment = false
		}
	})

	function getCardTitle() {
		const titleMatch = String(post?.text || "")
			.split("\n")[0]
			.trim()
		if (titleMatch) return titleMatch

		for (const alt of post?.imageAlts || []) {
			const parsed = getRecord(alt)
			if (parsed?.name) return parsed.name
		}

		const videoAlt = getRecord(post?.video?.alt || "")
		if (videoAlt?.name) return videoAlt.name

		return "Untitled"
	}

	function getCardDescription() {
		const text = String(post?.text || "")
		const lines = text.split("\n")
		if (lines.length > 1) {
			return lines.slice(1).join("\n").trim()
		}

		for (const alt of post?.imageAlts || []) {
			const parsed = getRecord(alt)
			if (parsed?.description) return parsed.description
		}

		const videoAlt = getRecord(post?.video?.alt || "")
		if (videoAlt?.description) return videoAlt.description

		return ""
	}

	function openCardViewInNewTab(event) {
		if (event?.defaultPrevented) return
		const href = cardViewHref
		if (!href) {
			console.warn("[OneCard] missing view href", {
				postType,
				postUri: post?.uri || "",
			})
			return
		}
		event?.preventDefault?.()
		const openInNewTab = Boolean(
			event?.metaKey || event?.ctrlKey || event?.button === 1,
		)
		if (openInNewTab) {
			const nextTab = window.open(href, "_blank")
			nextTab?.focus?.()
			if (!nextTab) window.location.href = href
			return
		}
		window.location.href = href
	}

	function getPrimaryImage() {
		// Check for profile background pic first
		for (const alt of post?.imageAlts || []) {
			const parsed = getRecord(alt)
			if (parsed?.backgroundPic) {
				return normalizeImageUrl(parsed.backgroundPic)
			}
		}

		const videoAlt = getRecord(post?.video?.alt || "")
		if (videoAlt?.backgroundPic) {
			return normalizeImageUrl(videoAlt.backgroundPic)
		}

		// Fall back to first post image
		if (Array.isArray(post?.images) && post.images.length > 0) {
			return normalizeImageUrl(post.images[0])
		}

		return null
	}

	function getProfilePic() {
		for (const alt of post?.imageAlts || []) {
			const parsed = getRecord(alt)
			if (parsed?.profilePic) {
				return normalizeImageUrl(parsed.profilePic)
			}
		}

		const videoAlt = getRecord(post?.video?.alt || "")
		if (videoAlt?.profilePic) {
			return normalizeImageUrl(videoAlt.profilePic)
		}

		return null
	}

	function getProfileDisplayName() {
		for (const alt of post?.imageAlts || []) {
			const parsed = getRecord(alt)
			if (parsed?.name) return parsed.name
		}

		const videoAlt = getRecord(post?.video?.alt || "")
		if (videoAlt?.name) return videoAlt.name

		return ""
	}

	function parseLocationDetailsLine(detailsLine = "") {
		const parts = String(detailsLine || "")
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean)

		if (parts.length >= 4) {
			return {
				city: parts[0],
				state: parts[1],
				country: parts[2],
				zip: parts.slice(3).join(", "),
			}
		}

		if (parts.length === 3) {
			return {
				city: parts[0],
				state: "",
				country: parts[1],
				zip: parts[2],
			}
		}

		if (parts.length === 2) {
			return {
				city: parts[0],
				state: "",
				country: parts[1],
				zip: "",
			}
		}

		return {
			city: parts[0] || "",
			state: "",
			country: "",
			zip: "",
		}
	}

	function extractLocationFromBundleAlt(alt = "") {
		if (!alt) return null
		const source = String(alt || "").trim()
		if (!source) return null
		if (altLocationCache.has(source)) {
			return altLocationCache.get(source)
		}

		try {
			const candidates = getAltCandidates(source)

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

			const pickFromLocation = (keys = []) => {
				for (const candidate of candidates) {
					const location = candidate?.location
					if (!location || typeof location !== "object") continue
					for (const key of keys) {
						const rawValue = location?.[key]
						if (typeof rawValue !== "string") continue
						const value = rawValue.trim()
						if (value) return value
					}
				}
				return ""
			}

			const address =
				pick(["address", "formattedAddress"]) ||
				pickFromLocation(["formattedAddress", "address"])
			const city = pick(["city"]) || pickFromLocation(["city"])
			const state = pick(["state"]) || pickFromLocation(["state"])
			const zip = pick(["zip"]) || pickFromLocation(["zip", "postcode"])
			const country =
				pick(["country"]) ||
				pickFromLocation(["country", "countryName"])

			if (!address && !city && !state && !zip && !country) {
				altLocationCache.set(source, null)
				return null
			}

			const locationData = {address, city, state, zip, country}
			altLocationCache.set(source, locationData)
			return locationData
		} catch {
			altLocationCache.set(source, null)
			return null
		}
	}

	function extractLocationFields(inputPost = {}) {
		const sourceLocation =
			inputPost?.location && typeof inputPost.location === "object"
				? inputPost.location
				: {}
		let bundleLocation = null

		for (const alt of inputPost?.imageAlts || []) {
			bundleLocation = extractLocationFromBundleAlt(alt)
			if (bundleLocation) break
		}

		if (!bundleLocation) {
			bundleLocation = extractLocationFromBundleAlt(
				inputPost?.video?.alt || "",
			)
		}

		let address = String(
			inputPost?.address ||
				bundleLocation?.address ||
				sourceLocation?.formattedAddress ||
				sourceLocation?.address ||
				"",
		).trim()
		let city = String(
			inputPost?.city ||
				bundleLocation?.city ||
				sourceLocation?.city ||
				"",
		).trim()
		let state = String(
			inputPost?.state ||
				bundleLocation?.state ||
				sourceLocation?.state ||
				"",
		).trim()
		let zip = String(
			inputPost?.zip || bundleLocation?.zip || sourceLocation?.zip || "",
		).trim()
		let country = String(
			inputPost?.country ||
				bundleLocation?.country ||
				sourceLocation?.country ||
				"",
		).trim()

		const text = String(inputPost?.text || "")
		const locationMatch = text.match(
			/(?:^|\n)📍\s+[^\n]+\n([^\n]+)(?:\n([^\n]+))?/,
		)

		if (locationMatch) {
			const firstLine = String(locationMatch[1] || "").trim()
			const secondLine = String(locationMatch[2] || "").trim()

			if (secondLine) {
				if (!address) address = firstLine
				const parsed = parseLocationDetailsLine(secondLine)
				city = city || parsed.city
				state = state || parsed.state
				country = country || parsed.country
				zip = zip || parsed.zip
			} else {
				const parsed = parseLocationDetailsLine(firstLine)
				city = city || parsed.city
				state = state || parsed.state
				country = country || parsed.country
				zip = zip || parsed.zip
			}
		}

		return {
			address,
			city,
			state,
			zip,
			country,
		}
	}

	function handleTagClick(tag) {
		// Toggle tag in search term, directly updating localStorage
		const token = String(tag || "")
			.trim()
			.toLowerCase()
			.replace(/^#/, "")
		if (!token) return

		// Read current search term from localStorage
		const current = readSearchTerm()
		const tokens = current
			.split(" ")
			.map((t) => t.trim())
			.filter(Boolean)

		// Toggle the token in/out
		const index = tokens.indexOf(token)
		if (index >= 0) {
			tokens.splice(index, 1)
		} else {
			tokens.push(token)
		}

		// Write back to localStorage and call parent callback if provided
		const next = tokens.join(" ")
		writeSearchTerm(next)
		if (onTagClick) {
			onTagClick(token)
		}
	}

	const cardTitle = $derived(getCardTitle())
	const cardDescription = $derived(getCardDescription())
	const primaryImage = $derived(getPrimaryImage())
	const profilePic = $derived(getProfilePic())
	const postImages = $derived.by(() => {
		if (postType === "profile") {
			return primaryImage ? [primaryImage] : [];
		}
		if (Array.isArray(post?.images) && post.images.length > 0) {
			return post.images.map(img => normalizeImageUrl(img));
		}
		return primaryImage ? [primaryImage] : [];
	})
	const resolvedTags = $derived(resolvePostTags(post))
	const hasTestTag = $derived(resolvedTags.includes("test"))
	const postType = $derived(
		// Use "profile" tag to identify profiles; otherwise default to "post"
		(() => {
			const tags = resolvedTags
			return tags.some(
				(tag) => String(tag || "").toLowerCase() === "profile",
			)
				? "profile"
				: "post"
		})(),
	)
	const cardViewHref = $derived(buildCardViewPath(cardTitle, postType, post))
	const profileDisplayName = $derived(getProfileDisplayName())
	const authorName = $derived(
		postType === "profile"
			? String(
					profileDisplayName ||
						post?.author?.displayName ||
						post?.author?.handle ||
						"",
				).trim()
			: String(
					post?.author?.displayName || post?.author?.handle || "",
				).trim(),
	)

	const locationFields = $derived(extractLocationFields(post))
	const locationLine = $derived(
		formatDisplayAddress({
			address: locationFields.address,
			city: locationFields.city,
			state: locationFields.state,
			zip: locationFields.zip,
			country: locationFields.country,
		})
	)
	const locationMapsHref = $derived(
		locationLine
			? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationLine)}`
			: "",
	)

	let isInView = $state(false)
	let cardEl = $state(null)

	$effect(() => {
		if (!cardEl) return
		if (typeof IntersectionObserver === 'undefined') {
			isInView = true
			return
		}
		const observer = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					isInView = true
					observer.unobserve(cardEl)
				}
			}
		}, {
			rootMargin: "0px 0px -50px 0px"
		})
		observer.observe(cardEl)
		return () => observer.disconnect()
	})
</script>

<div class="one-card" class:animate={isInView} bind:this={cardEl}>
	<a class="card-link" href={cardViewHref} tabindex="0">
		{#if primaryImage}
			<div class="card-image">
				<img src={primaryImage} alt={cardTitle} loading="lazy" />
			</div>
		{/if}
	</a>

	<TagPills tags={resolvedTags} onTagClick={handleTagClick} />

	<AuthorRow
		avatar={profilePic}
		name={authorName || "Anonymous"}
		dateValue={post?.createdAt || ""}
		location={locationLine}
		locationHref={locationMapsHref}
		// compact
	/>

	{#if hasTestTag}
		<div class="test-post-notice" role="note">
			<NoticeIcon size={15} aria-hidden="true" />
			<span>Notice: this is not a real post. It is for demonstration only.</span>
		</div>
	{/if}

	<a class="card-link" href={cardViewHref} tabindex="0">
		<div class="card-content">
			{#if postType !== "profile"}
				<h3 class="card-title">{cardTitle}</h3>
			{/if}
			{#if cardDescription}
				<p class="card-description">{cardDescription}</p>
			{/if}
		</div>
	</a>

	<a
		class="post-footer"
		href={cardViewHref.split("#")[0]+"#discussion"}
		target="_blank"
		rel="noopener noreferrer"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="post-stats">
			<span class="stat"><Heart size={13} />{post.likeCount ?? 0}</span>
			<span class="stat"
				><Repeat2 size={13} />{post.repostCount ?? 0}</span
			>
			<span class="stat"
				><MessageCircle size={13} />{post.replyCount ?? 0}</span
			>
			{#if post.createdAt}
				<span class="stat-date"><DateTime tag="span" value={post.createdAt} /></span>
			{/if}
		</div>
		{#if discussionComment}
			<ul class="comments-list">
				<li class="comment">
					{#if discussionComment.avatar}
						<img
							class="comment-avatar"
							src={discussionComment.avatar}
							alt={`@${discussionComment.handle}`}
							loading="lazy"
						/>
					{:else}
						<span
							class="comment-avatar comment-avatar-fallback"
							aria-hidden="true"
						></span>
					{/if}
					<div class="comment-main">
						<span class="comment-author">@{discussionComment.handle}</span>
						<span class="comment-text">{discussionComment.text}</span>
					</div>
				</li>
			</ul>
			<div class="comment-compose-disabled" aria-hidden="true">
				<div class="comment-input-disabled">
					Add your comments 
				</div>
				<div class="comment-submit-disabled">Submit</div>
			</div>
		{:else}
			<div class="comment-compose-disabled" aria-hidden="true">
				<div class="comment-input-disabled">
					Be the first to comment
					
				</div>
				<div class="comment-submit-disabled">Submit</div>
			</div>
		{/if}
	</a>
</div>

<style>
	.one-card {
		display: grid;
		grid-template-columns: 1fr;
		background: #fff;
		border-radius: 12px;
		overflow: hidden;
		box-shadow: 0 2px 8px rgba(46, 28, 12, 0.08);
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			opacity 0.2s ease;
		cursor: pointer;
		opacity: 0;
	}

	.one-card.animate {
		opacity: 1;
		animation: cardIn 1s ease-out;
	}

	@keyframes cardIn {
		from {
			opacity: 0;
			transform: translateY(5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.one-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 16px rgba(46, 28, 12, 0.12);
	}

	.card-image-layout {
		position: relative;
		width: 100%;
		overflow: hidden;
	}

	.card-image {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: #f0f0f0;
	}

	.card-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.card-content {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.card-title {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
		line-height: 1.3;
		color: #1f1f1f;
		word-break: break-word;
	}

	.card-description {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.4;
		color: #666;
		word-break: break-word;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.test-post-notice {
		margin: 0.35rem 1rem 0.2rem;
		padding: 0.55rem 0.7rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 9px;
		border: 1px solid rgba(186, 122, 35, 0.45);
		background: rgba(255, 220, 160, 0.35);
		color: #6b4515;
		font-size: 0.86rem;
		line-height: 1.3;
		font-weight: 600;
	}

	.card-link,
	.post-footer,
	.one-card a {
		color: inherit;
		text-decoration: none !important;
		cursor: pointer;
	}

	.card-link:hover,
	.card-link:focus-visible,
	.post-footer:hover,
	.post-footer:focus-visible,
	.one-card a:hover,
	.one-card a:focus-visible {
		text-decoration: none !important;
	}

	/* Author row styles moved to AuthorRow component */

	.post-footer {
		display: block;
		padding: 0 0.75rem 0.25rem;
		border-top: 1px solid #ede5d8;
		text-decoration: none;
		cursor: pointer;
	}

	.post-stats {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		flex-wrap: wrap;
		padding: 0.4rem 0;
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
		box-sizing: border-box;
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

	@media (max-width: 640px) {
		.card-content {
			padding: 0.85rem;
			gap: 0.5rem;
		}

		.card-title {
			font-size: 1rem;
		}

		.card-description {
			font-size: 0.85rem;
		}
	}
</style>
