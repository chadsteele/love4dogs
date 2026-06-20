<script>
	import { onMount } from "svelte"
	import { rewriteLove4DogsUrlForLocalhost } from "$lib/utils"
	import { MessageSquare } from "lucide-svelte"
	import TagPills from "$lib/TagPills.svelte"
	import AuthorRow from "$lib/AuthorRow.svelte"
	import { formatDisplayAddress } from "$lib/addressFormat"
	import { writeSearchTerm, readSearchTerm } from "$lib/searchStore"
	import PostStats from "$lib/PostStats.svelte"
	import { getProfileDetails } from "$lib/syncProcessor.js"
	import { parseTimestampMs } from "$lib/dateTime.js"
	import { classifyPost } from "$lib/postTypeTags.js"

	let { post, onclick = () => {}, onTagClick = () => {} } = $props()
	let hasHydrated = $state(false)
	let discussionComment = $state(null)

	let commentAuthorName = $state("Anonymous")
	let commentAuthorAvatar = $state("")
	let profileDetailsName = $state("")
	let profileDetailsPic = $state("")

	let contextTypeState = $state("post")
	let contextSlugState = $state("")

	// Helper to extract candidate objects from alt JSON strings or pre-parsed objects
	function getAltCandidates(alt) {
		if (!alt) return []
		
		let parsed = null
		if (typeof alt === "object") {
			parsed = alt
		} else {
			const source = String(alt).trim()
			if (!source) return []
			try {
				parsed = JSON.parse(source)
			} catch {}
		}

		if (!parsed || typeof parsed !== "object") return []

		let candidates = [parsed, parsed?.primary, parsed?.combined?.primary]

		if (typeof parsed?.h === "string" && parsed.h.trim()) {
			try {
				const inner = JSON.parse(parsed.h)
				candidates.push(
					inner,
					inner?.primary,
					inner?.combined?.primary,
				)
			} catch {}
		} else if (parsed?.h && typeof parsed.h === "object") {
			const inner = parsed.h
			candidates.push(
				inner,
				inner?.primary,
				inner?.combined?.primary,
			)
		}

		return candidates.filter(
			(candidate) => candidate && typeof candidate === "object",
		)
	}

	// Helper to extract all candidates from post images and videos
	function getAllCandidates(inputPost = {}) {
		const alts = [
			...(Array.isArray(inputPost?.imageAlts) ? inputPost.imageAlts : []),
			inputPost?.video?.alt
		].filter(Boolean)
		
		let list = []
		for (const alt of alts) {
			list = list.concat(getAltCandidates(alt))
		}
		return list
	}

	// Helper to pick values from candidate objects
	function pickVal(candidates, keys) {
		for (const c of candidates) {
			for (const key of keys) {
				if (c[key] !== undefined && c[key] !== null) {
					const val = String(c[key]).trim()
					if (val) return val
				}
			}
		}
		return ""
	}

	// Helper to pick tags from candidates
	function pickTags(candidates) {
		for (const c of candidates) {
			if (Array.isArray(c.tags) && c.tags.length > 0) {
				return c.tags.map(t => String(t || "").trim().toLowerCase()).filter(Boolean)
			}
		}
		return []
	}

	// Helper to pick location object from candidates
	function pickLocation(candidates) {
		for (const c of candidates) {
			const loc = c.location
			if (loc && typeof loc === "object") {
				return {
					address: String(loc.address || loc.formattedAddress || "").trim(),
					city: String(loc.city || "").trim(),
					state: String(loc.state || "").trim(),
					zip: String(loc.zip || loc.postcode || "").trim(),
					country: String(loc.country || loc.countryName || "").trim()
				}
			}
			if (c.address || c.city || c.state || c.zip || c.country) {
				return {
					address: String(c.address || c.formattedAddress || "").trim(),
					city: String(c.city || "").trim(),
					state: String(c.state || "").trim(),
					zip: String(c.zip || c.postcode || "").trim(),
					country: String(c.country || c.countryName || "").trim()
				}
			}
		}
		return null
	}

	// Helper to parse location details lines
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

	// Handle tag navigation click
	function handleTagClick(tag) {
		const token = String(tag || "")
			.trim()
			.toLowerCase()
			.replace(/^#/, "")
		if (!token) return

		const current = readSearchTerm()
		const tokens = current
			.split(" ")
			.map((t) => t.trim())
			.filter(Boolean)

		const index = tokens.indexOf(token)
		if (index >= 0) {
			tokens.splice(index, 1)
		} else {
			tokens.push(token)
		}

		const next = tokens.join(" ")
		writeSearchTerm(next)
		if (onTagClick) {
			onTagClick(token)
		}
	}

	// Single reactive derived object representing the parsed card data
	const card = $derived.by(() => {
		if (!post) return null

		const candidates = getAllCandidates(post)

		// 1. Post Type
		let type = "post"
		const hasProfile = candidates.some(c => "profileImage" in c || "profilePic" in c || "profilepic" in c)
		const hasComment = candidates.some(c => "context" in c)

		if (hasProfile) {
			type = "profile"
		} else if (hasComment) {
			type = "comment"
		} else {
			const classified = classifyPost(post)
			if (classified === "profile") type = "profile"
			else if (classified === "comment") type = "comment"
		}

		// 2. UUID & Author ID
		const uuid = String(post.uuid || pickVal(candidates, ["u", "uuid", "id"]) || "").trim()
		const authorId = type === "profile" ? uuid : String(post.authorid || pickVal(candidates, ["authorid", "authorId"]) || "").trim()

		// 3. Comment Payload
		let commentPayload = null
		if (type === "comment") {
			const commentCand = candidates.find(c => "context" in c)
			if (commentCand) {
				commentPayload = commentCand
			}
		}

		// 4. Tags
		const directTags = [
			...(Array.isArray(post.tags) ? post.tags : []),
			...(Array.isArray(post.record?.tags) ? post.record.tags : [])
		].map(t => String(t || "").trim().toLowerCase()).filter(Boolean)

		let resolvedTags = []
		if (directTags.includes("chat")) {
			resolvedTags = directTags
		} else if (type === "comment" && commentPayload?.context) {
			const altTags = pickTags(candidates)
			resolvedTags = ["chat", commentPayload.context, ...altTags]
		} else if (directTags.length > 0) {
			resolvedTags = directTags
		} else {
			resolvedTags = pickTags(candidates)
		}
		// Ensure unique tags
		resolvedTags = [...new Set(resolvedTags)]
		const hasTestTag = resolvedTags.includes("test")

		// 5. Image normalization helper
		const getNormalizedUrl = (url) => {
			const source = String(url || "").trim()
			if (!source) return ""
			if (!/^https?:\/\//i.test(source)) return ""
			if (!hasHydrated) return source
			return rewriteLove4DogsUrlForLocalhost(source)
		}

		// 6. Profile Pic & Background Pic
		const profilePic = getNormalizedUrl(pickVal(candidates, ["profileImage", "profilePic", "profilepic"]))
		const backgroundPic = getNormalizedUrl(pickVal(candidates, ["backgroundImage", "backgroundPic", "backgroundpic"]))

		// 7. Primary Image
		let primaryImage = null
		if (type === "comment") {
			if (commentPayload?.imgs && commentPayload.imgs.length > 0) {
				primaryImage = getNormalizedUrl(commentPayload.imgs[0])
			} else if (commentPayload?.img) {
				primaryImage = getNormalizedUrl(commentPayload.img)
			}
		} else if (type === "profile") {
			primaryImage = backgroundPic || null
		} else {
			if (backgroundPic) {
				primaryImage = backgroundPic
			} else if (Array.isArray(post.images) && post.images.length > 0) {
				primaryImage = getNormalizedUrl(post.images[0])
			}
		}

		// 8. Title
		let title = ""
		if (type === "comment") {
			title = "comment"
		} else if (type === "profile") {
			// Title of profile card is its description (lines[1]), or fallback to alt JSON description
			const text = String(post.text || "").trim()
			const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
			const rawTitle = lines[1] || ""
			title = rawTitle.replace(/#\w+/g, "").trim()
			if (!title) {
				title = pickVal(candidates, ["description", "desc"])
			}
		} else {
			// Title of standard card is lines[0]
			const text = String(post.text || "").trim()
			const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
			const rawTitle = lines[0] || ""
			title = rawTitle.replace(/#\w+/g, "").trim()
			if (!title) {
				title = pickVal(candidates, ["name", "title", "n"])
			}
		}

		// 9. Description (removes hashtags and title line contents)
		let description = ""
		if (type === "comment") {
			description = commentPayload?.text || ""
		} else if (type === "profile") {
			const text = String(post.text || "").trim()
			if (text) {
				const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
				if (lines.length > 2) {
					description = lines.slice(2).join("\n").replace(/#\w+/g, "").trim()
				}
			}
		} else {
			const text = String(post.text || "").trim()
			if (text) {
				const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
				if (lines.length > 1) {
					description = lines.slice(1).join("\n").replace(/#\w+/g, "").trim()
				}
			} else {
				description = pickVal(candidates, ["description", "desc"]).replace(/#\w+/g, "").trim()
			}
		}

		// 10. Location
		const locObj = pickLocation(candidates) || {}
		let address = String(post.address || locObj.address || "").trim()
		let city = String(post.city || locObj.city || "").trim()
		let state = String(post.state || locObj.state || "").trim()
		let zip = String(post.zip || locObj.zip || "").trim()
		let country = String(post.country || locObj.country || "").trim()

		// Regex location from text content
		const textContent = String(post.text || "")
		const locationMatch = textContent.match(
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

		const locationLine = formatDisplayAddress({ address, city, state, zip, country })
		const locationMapsHref = locationLine
			? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationLine)}`
			: ""

		// 11. Slug and Href
		const slugifyValue = (val = "") => {
			return String(val || "")
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "")
		}

		const buildCardViewPath = (fallbackTitle, cardType) => {
			if (!uuid) return ""
			const pathType = cardType === "profile" ? "profile" : "post"
			const slug = slugifyValue(fallbackTitle) || uuid
			return `/${pathType}/view/${encodeURIComponent(uuid)}/${encodeURIComponent(slug)}`
		}

		let cardViewHref = ""
		if (type === "comment" && commentPayload) {
			cardViewHref = `/${contextTypeState}/view/${encodeURIComponent(commentPayload.context)}/${encodeURIComponent(contextSlugState || commentPayload.context)}#comment-${commentPayload.uuid}`
		} else {
			cardViewHref = buildCardViewPath(title, type)
		}

		// 12. Comment Date
		let commentDate = ""
		if (type === "comment" && commentPayload?.stamp) {
			const ms = parseTimestampMs(commentPayload.stamp, { allowBase36: true })
			if (ms) {
				commentDate = new Date(ms).toISOString()
			}
		}

		// Profile Name derivation
		let profileName = pickVal(candidates, ["name", "title"])
		if (type === "profile" && !profileName) {
			const text = String(post.text || "").trim()
			const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
			profileName = lines[0] || ""
		}

		const record = {
			postType: type,
			uuid,
			authorId,
			commentPayload,
			tags: resolvedTags,
			hasTestTag,
			profilePic,
			backgroundPic,
			primaryImage,
			title,
			profileName,
			description,
			locationLine,
			locationMapsHref,
			cardViewHref,
			commentDate
		}

		if (type === "profile"){
			if (!record.profilePic && record.primaryImage){
				record.profilePic = record.primaryImage;
				record.primaryImage = "";
			}
			if (record.profileName) {
				if (!record.description && record.title && record.title !== record.profileName) {
					record.description = record.title;
				}
				record.title = record.profileName;
			} else if (record.title) {
				record.profileName = record.title;
			}
			if (!record.title && record.description){
				const lines = record.description.split("\n");
				record.title = lines[0];
				record.description = lines.slice(1).join("\n");
			}
		}

		// Print the consolidated JSON parsed record
		console.log("Parsed Card Record:", JSON.stringify(record, null, 2))

		return record
	})

	const authorName = $derived.by(() => {
		if (card?.postType === "comment") {
			return commentAuthorName || "Anonymous"
		}
		if (card?.postType === "profile") {
			return profileDetailsName || card.profileName || post?.author?.displayName || post?.author?.handle || "Anonymous"
		}
		return profileDetailsName || post?.author?.displayName || post?.author?.handle || "Anonymous"
	})

	const authorAvatar = $derived.by(() => {
		if (card?.postType === "comment") {
			return commentAuthorAvatar || ""
		}
		if (card?.postType === "profile") {
			return profileDetailsPic || card.profilePic || post?.author?.avatar || ""
		}
		return profileDetailsPic || post?.author?.avatar || ""
	})

	onMount(() => {
		hasHydrated = true
	})

	$effect(() => {
		commentAuthorName = "Anonymous"
		commentAuthorAvatar = ""
		profileDetailsName = ""
		profileDetailsPic = ""
		contextTypeState = "post"
		contextSlugState = ""
		discussionComment = null

		const type = card?.postType
		const uuid = card?.uuid
		const authorId = card?.authorId
		const commentPayload = card?.commentPayload

		if (type === "comment" && commentPayload?.context) {
			getProfileDetails(commentPayload.author).then((details) => {
				commentAuthorName = details?.name || "Anonymous"
				commentAuthorAvatar = details?.profilePic || ""
			}).catch((err) => {
				console.error("Failed to load comment author details:", err)
			})

			fetch(`/api/feed?query=${encodeURIComponent(commentPayload.context)}&limit=1`)
				.then(res => res.ok ? res.json() : null)
				.then(data => {
					const contextPosts = data?.posts || []
					if (contextPosts.length > 0) {
						const contextPost = contextPosts[0]
						const cTags = (contextPost.tags || []).map(t => String(t || '').trim().toLowerCase())
						const isProfile = cTags.includes("profile")
						contextTypeState = isProfile ? "profile" : "post"
						
						let title = ""
						if (isProfile) {
							const alts = [
								...(Array.isArray(contextPost.imageAlts) ? contextPost.imageAlts : []),
								contextPost.video?.alt
							].filter(Boolean)
							for (const alt of alts) {
								try {
									const parsed = JSON.parse(alt)
									const name = parsed?.name || parsed?.primary?.name || parsed?.combined?.primary?.name
									if (name) {
										title = name
										break
									}
								} catch {}
							}
						} else {
							title = String(contextPost.text || "").split("\n")[0].trim()
						}
						const slugifyValue = (val = "") => {
							return String(val || "")
								.trim()
								.toLowerCase()
								.replace(/[^a-z0-9]+/g, "-")
								.replace(/^-+|-+$/g, "")
						}
						contextSlugState = slugifyValue(title) || commentPayload.context
					}
				}).catch((err) => {
					console.error("Failed to fetch comment context info:", commentPayload.context, err)
				})
		} else {
			if (authorId) {
				getProfileDetails(authorId).then((details) => {
					profileDetailsName = details?.name || ""
					profileDetailsPic = details?.profilePic || ""
				}).catch((err) => {
					console.error("Failed to load profile details in OneCard:", err)
				})
			}

			if (uuid) {
				fetch(`/api/feed?query=${encodeURIComponent(uuid)}&limit=1&chat=1`)
					.then(res => res.ok ? res.json() : null)
					.then(data => {
						const posts = data?.posts || []
						if (posts.length > 0) {
							const firstPost = posts[0]
							if (firstPost.imageAlts && firstPost.imageAlts.length > 0) {
								try {
									const payload = JSON.parse(firstPost.imageAlts[0])
									if (payload && payload.uuid && payload.context === uuid) {
										discussionComment = {
											uuid: payload.uuid,
											handle: firstPost.author?.handle || "anonymous",
											name: firstPost.author?.displayName || firstPost.author?.handle || "Anonymous",
											avatar: firstPost.author?.avatar || "",
											text: payload.text || firstPost.text || ""
										}
									}
								} catch {}
							}
						}
					}).catch((err) => {
						console.error("Failed to load discussion comment for card:", uuid, err)
					})
			}
		}
	})

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

<div class="one-card" class:animate={isInView} class:comment-card={card?.postType === "comment"} bind:this={cardEl}>
	{#if card?.postType !== "comment"}
		<a class="card-link" href={card?.cardViewHref} tabindex="0">
			{#if card?.primaryImage}
				<div class="card-image">
					<img src={card.primaryImage} alt={card.title} loading="lazy" />
				</div>
			{/if}
		</a>
	{/if}

	{#if card?.postType !== "comment"}
		<TagPills tags={card?.tags} onTagClick={handleTagClick} />
	{/if}

	<AuthorRow
		avatar={authorAvatar}
		name={authorName || "Anonymous"}
		dateValue={card?.postType === "comment" ? card.commentDate : (post?.createdAt || "")}
		location={card?.postType === "comment" ? "" : card?.locationLine}
		locationHref={card?.postType === "comment" ? "" : card?.locationMapsHref}
	/>

	<a class="card-link" href={card?.cardViewHref} tabindex="0">
		<div class="card-content">
			{#if card?.postType !== "comment"}
				<h3 class="card-title">{card?.title}</h3>
			{/if}
			{#if card?.description && card.postType === "comment"}
				<p class="card-description">
					<MessageSquare size={14} class="comment-icon" style="margin-right: 0.5rem; display: inline-block; vertical-align: middle;" />
					{card.description}
				</p>
			{:else if card?.description}
				<p class="card-description">{card.description}</p>
			{/if}
		</div>
	</a>

	{#if card?.postType !== "comment"}
		<div class="post-footer">
			<PostStats
				likeCount={post?.likeCount ?? 0}
				repostCount={post?.repostCount ?? 0}
				replyCount={post?.replyCount ?? 0}
				createdAt={post?.createdAt}
				context={card?.uuid}
				cardViewHref={card?.cardViewHref}
				title={card?.title}
				imageUrl={card?.postType === 'profile' ? card?.profilePic : card?.primaryImage}
				authorId={card?.authorId}
			/>
			{#if discussionComment}
				<a
					class="comments-link"
					href={`${card?.cardViewHref}#comment-${discussionComment.uuid}`}
					onclick={(e) => e.stopPropagation()}
				>
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
				</a>
			{:else}
				<a
					class="comments-link"
					href={`${card?.cardViewHref}#discussion`}
					onclick={(e) => e.stopPropagation()}
				>
					<div class="comment-compose-disabled" aria-hidden="true">
						<div class="comment-input-disabled">
							Be the first to comment
						</div>
						<div class="comment-submit-disabled">Submit</div>
					</div>
				</a>
			{/if}
		</div>
	{/if}
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


	.comments-link {
		display: block;
		text-decoration: none !important;
		color: inherit !important;
		cursor: pointer;
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

	.one-card.comment-card {
		border-left: 4px solid #3b6e4f;
	}

	:global(.comment-icon) {
		flex-shrink: 0;
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
