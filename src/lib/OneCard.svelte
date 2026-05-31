<script>
	import {onMount} from "svelte"
	import {extractPostTypeFromTags, extractHashtags} from "$lib/postTypeTags"
	import {rewriteLove4DogsUrlForLocalhost} from "$lib/utils"
	import {Heart, MessageCircle, Repeat2} from "lucide-svelte"
	import {siBluesky} from "simple-icons"

	let {post, onclick = () => {}} = $props()
	let hasHydrated = $state(false)

	const BSKY_HANDLE = "love4dogs.club"

	function bskyUrl(uri = "") {
		const rkey = uri.split("/").pop()
		return `https://bsky.app/profile/${BSKY_HANDLE}/post/${rkey}`
	}

	function formatDate(iso = "") {
		if (!iso) return ""
		const d = new Date(iso)
		return d.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
		})
	}

	function extractCanonicalUrl(inputPost = {}) {
		const candidates = [
			inputPost?.record?.facets,
			inputPost?.facets,
			inputPost?.embed?.external?.uri,
		]

		const bundleAlts = [
			...(Array.isArray(inputPost?.imageAlts) ? inputPost.imageAlts : []),
			inputPost?.video?.alt || "",
		]
		for (const alt of bundleAlts) {
			const fromAlt = extractCanonicalUrlFromBundleAlt(alt)
			if (fromAlt) return fromAlt
		}

		for (const candidate of candidates) {
			if (Array.isArray(candidate)) {
				for (const facet of candidate) {
					const linkUri = facet?.features?.find(
						(f) =>
							f?.$type === "app.bsky.richtext.facet#link" &&
							typeof f.uri === "string",
					)?.uri
					if (linkUri && /^https?:\/\//i.test(linkUri)) {
						return linkUri
					}
				}
			}
		}

		return ""
	}

	function extractCanonicalUrlFromBundleAlt(alt = "") {
		if (!alt) return ""
		const source = String(alt || "").trim()
		if (!source) return ""

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
				} catch {}
			}

			for (const candidate of candidates) {
				if (!candidate || typeof candidate !== "object") continue
				const canonicalUrl = String(
					candidate?.canonicalurl || candidate?.canonicalUrl || "",
				).trim()
				if (canonicalUrl) return canonicalUrl
			}
		} catch {
			return ""
		}

		return ""
	}

	function extractUuidFromCanonical(url = "") {
		const canonical = String(url || "").trim()
		if (!canonical) return ""

		try {
			const base =
				typeof window !== "undefined"
					? window.location.origin
					: "http://localhost"
			const parsed = new URL(canonical, base)
			const host = String(parsed.hostname || "").toLowerCase()
			const isLocalHost =
				host === "localhost" || host === "127.0.0.1" || host === "::1"
			const isLove4DogsHost =
				host === "love4dogs.club" || host === "www.love4dogs.club"
			if (!isLocalHost && !isLove4DogsHost) return ""

			const segments = (parsed.pathname || "")
				.split("/")
				.map((segment) => segment.trim())
				.filter(Boolean)

			const viewIndex = segments.findIndex((segment) =>
				/^(view|edit)$/i.test(segment),
			)
			if (viewIndex >= 0 && segments[viewIndex + 1]) {
				return segments[viewIndex + 1]
			}

			return ""
		} catch {
			return ""
		}
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
				/^(view|edit)$/i.test(segment),
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

	function slugifyValue(value = "") {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
	}

	function buildCardViewPath(
		rawCanonical = "",
		fallbackTitle = "",
		cardType = "post",
	) {
		const source = String(rawCanonical || "").trim()
		const uuid = extractUuidFromCanonical(source)
		if (!uuid) return ""

		const pathType =
			String(cardType || "post")
				.trim()
				.toLowerCase() === "profile"
				? "profile"
				: "post"
		const slugFromCanonical = extractSlugFromCanonical(source, uuid)
		const fallbackSlug = slugifyValue(fallbackTitle) || uuid
		const slug = slugFromCanonical || fallbackSlug

		return `/${pathType}/view/${encodeURIComponent(uuid)}/${encodeURIComponent(slug)}`
	}

	function extractProfileData(alt = "") {
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
				} catch {}
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

			const profilePic = pick(["profilePic", "profilepic"])
			const backgroundPic = pick(["backgroundPic", "backgroundpic"])
			const name = pick(["name", "title", "n"])
			const description = pick(["description", "desc"])

			if (!profilePic && !backgroundPic && !name && !description)
				return null

			return {
				profilePic: profilePic || null,
				backgroundPic: backgroundPic || null,
				name: name || null,
				description: description || null,
			}
		} catch {
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

	onMount(() => {
		hasHydrated = true
	})

	function getCardTitle() {
		const titleMatch = String(post?.text || "")
			.split("\n")[0]
			.trim()
		if (titleMatch) return titleMatch

		for (const alt of post?.imageAlts || []) {
			const parsed = extractProfileData(alt)
			if (parsed?.name) return parsed.name
		}

		const videoAlt = extractProfileData(post?.video?.alt || "")
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
			const parsed = extractProfileData(alt)
			if (parsed?.description) return parsed.description
		}

		const videoAlt = extractProfileData(post?.video?.alt || "")
		if (videoAlt?.description) return videoAlt.description

		return ""
	}

	function openCardViewInNewTab(event) {
		if (event?.defaultPrevented) return
		const href = cardViewHref
		if (!href) {
			console.warn("[OneCard] missing view href", {
				canonicalUrl,
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
			const parsed = extractProfileData(alt)
			if (parsed?.backgroundPic) {
				return normalizeImageUrl(parsed.backgroundPic)
			}
		}

		const videoAlt = extractProfileData(post?.video?.alt || "")
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
			const parsed = extractProfileData(alt)
			if (parsed?.profilePic) {
				return normalizeImageUrl(parsed.profilePic)
			}
		}

		const videoAlt = extractProfileData(post?.video?.alt || "")
		if (videoAlt?.profilePic) {
			return normalizeImageUrl(videoAlt.profilePic)
		}

		return null
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
				} catch {}
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

			if (!address && !city && !state && !zip && !country) return null

			return {address, city, state, zip, country}
		} catch {
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

	const PILL_COLORS = [
		{bg: "#bae6fd", color: "#0369a1"},
		{bg: "#e9d5ff", color: "#6b21a8"},
		{bg: "#fce7f3", color: "#9d174d"},
		{bg: "#fed7aa", color: "#c2410c"},
		{bg: "#99f6e4", color: "#0f766e"},
		{bg: "#c7d2fe", color: "#3730a3"},
		{bg: "#ffe4e6", color: "#be123c"},
		{bg: "#fef08a", color: "#92400e"},
	]

	function getTypePills() {
		const pills = []
		let colorIndex = 0

		// Type pill first (from post.type, post.postType, or l4d-type: tag)
		const postType =
			String(post?.type || post?.postType || "")
				.trim()
				.toLowerCase() || extractPostTypeFromTags(post?.tags || [])

		if (postType && postType !== "post") {
			pills.push({
				label: postType.toUpperCase(),
				style: PILL_COLORS[colorIndex % PILL_COLORS.length],
			})
			colorIndex++
		}

		// All remaining tags (strip l4d-type: and l4d- prefixes)
		const tags = post?.tags || []
		for (const tag of tags) {
			const raw = String(tag || "")
				.trim()
				.toLowerCase()
			if (!raw) continue
			if (raw.startsWith("l4d-type:")) continue
			const label = raw.replace(/^l4d-/, "").toUpperCase()
			if (!label) continue
			pills.push({
				label,
				style: PILL_COLORS[colorIndex % PILL_COLORS.length],
			})
			colorIndex++
		}

		return pills
	}

	const cardTitle = $derived(getCardTitle())
	const cardDescription = $derived(getCardDescription())
	const primaryImage = $derived(getPrimaryImage())
	const profilePic = $derived(getProfilePic())
	const typePills = $derived(getTypePills())
	const postType = $derived(
		String(
			post?.type ||
				post?.postType ||
				extractPostTypeFromTags(post?.tags || []) ||
				"",
		)
			.trim()
			.toLowerCase(),
	)
	const canonicalUrl = $derived(
		String(
			post?.canonicalUrl ||
				post?.canonicalurl ||
				extractCanonicalUrl(post) ||
				"",
		).trim(),
	)
	const cardViewHref = $derived(
		buildCardViewPath(canonicalUrl, cardTitle, postType),
	)
	const authorName = $derived(
		String(post?.author?.displayName || post?.author?.handle || "").trim(),
	)
	const formattedDate = $derived(formatDate(post?.createdAt || ""))
	const comments = $derived(post?.comments || [])
	const locationFields = $derived(extractLocationFields(post))
	const locationLine = $derived(
		[
			locationFields.address,
			locationFields.city,
			locationFields.state,
			locationFields.zip,
			locationFields.country,
		]
			.filter(Boolean)
			.join(", "),
	)
	const locationMapsHref = $derived(
		locationLine
			? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationLine)}`
			: "",
	)
</script>

<div class="one-card">
	<a class="card-link" href={cardViewHref} tabindex="0">
		{#if primaryImage}
			<div class="card-image">
				<img src={primaryImage} alt={cardTitle} loading="lazy" />
			</div>
		{/if}
		<div class="card-content">
			<h3 class="card-title">{cardTitle}</h3>
			{#if cardDescription}
				<p class="card-description">{cardDescription}</p>
			{/if}
		</div>
	</a>

	{#if typePills.length > 0}
		<div class="pills-strip">
			<div class="pills">
				{#each typePills as pill}
					<span
						class="pill"
						style="background:{pill.style.bg};color:{pill.style
							.color}">{pill.label}</span
					>
				{/each}
			</div>
		</div>
	{/if}

	{#if locationMapsHref}
		<a
			class="location-fields location-link"
			href={locationMapsHref}
			target="_blank"
			rel="noopener noreferrer"
			onclick={(e) => e.stopPropagation()}
		>
			<p class="location-row">📍 {locationLine}</p>
		</a>
	{/if}

	{#if profilePic || authorName || formattedDate}
		<div class="card-footer">
			{#if profilePic}
				<img src={profilePic} alt={authorName} class="author-avatar" />
			{/if}
			<div class="author-info">
				{#if authorName}
					<p class="author-name">{authorName}</p>
				{/if}
				{#if formattedDate}
					<p class="author-date">{formattedDate}</p>
				{/if}
			</div>
		</div>
	{/if}

	<a
		class="post-footer"
		href={bskyUrl(post.uri)}
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
			{#if post.createdAt}<span class="stat-date">{formattedDate}</span
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
					Be the first to comment {@html siBluesky.svg}
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
			box-shadow 0.2s ease;
		cursor: pointer;
		margin-bottom: 1rem;
	}

	.one-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 16px rgba(46, 28, 12, 0.12);
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

	.pills-strip {
		padding: 0.75rem 1rem 0;
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.pill {
		display: inline-block;
		padding: 0.3rem 0.7rem;
		border-radius: 20px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
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

	.location-fields {
		display: block;
		padding: 0.5rem 0.65rem;
		border-radius: 8px;
		background: #faf7f3;
		border: 1px solid #ede5d8;
		margin: 0 1rem;
	}

	.location-link,
	.card-link,
	.post-footer,
	.one-card a {
		color: inherit;
		text-decoration: none !important;
		cursor: pointer;
	}

	.location-link:hover,
	.location-link:focus-visible,
	.card-link:hover,
	.card-link:focus-visible,
	.post-footer:hover,
	.post-footer:focus-visible,
	.one-card a:hover,
	.one-card a:focus-visible {
		text-decoration: none !important;
	}

	.location-row {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.35;
		color: #4b5563;
		word-break: break-word;
	}

	.card-footer {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.4rem;
	}

	.author-avatar {
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid rgba(0, 0, 0, 0.1);
	}

	.author-info {
		flex: 1;
		min-width: 0;
	}

	.author-name {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: #1f1f1f;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.author-date {
		margin: 0 0 0 1rem;
		font-size: 0.75rem;
		color: #999;
	}

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
