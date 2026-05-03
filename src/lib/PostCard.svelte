<script>
	import {Bookmark, Heart, MessageCircle, Repeat2} from "lucide-svelte"

	import Bluesky from "./assets/BlueSkyLogo.svelte"

	let {
		post,
		selected = false,
		bookmarked = false,
		onToggleSelect = () => {},
	} = $props()

	const BSKY_HANDLE = "mylove4dogs.bsky.social"

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
		if (!Array.isArray(facets) || facets.length === 0) {
			return escapeHtml(text)
				.replace(
					/(https?:\/\/[^\s<]+)/g,
					'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
				)
				.replace(/\n/g, "<br>")
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
			if (!linkFeature) continue

			linkFacets.push({
				byteStart: facet.index.byteStart,
				byteEnd: facet.index.byteEnd,
				uri: linkFeature.uri,
			})
		}

		if (linkFacets.length === 0) {
			return escapeHtml(text).replace(/\n/g, "<br>")
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
		return html.replace(/\n/g, "<br>")
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
		const body = normalized.slice(newlineIndex + 1).replace(/^\n+/, "")
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

	const parts = $derived(getPostParts(post))

	const comments = $derived(post.comments || [])
</script>

<article class="post-card">
	<button
		type="button"
		class="select-btn"
		class:is-selected={selected}
		onclick={() => onToggleSelect(post.uri)}
		aria-label={selected ? "Unselect card" : "Select card"}
	>
		<span class="select-dot">{selected ? "✓" : ""}</span>
	</button>

	{#if bookmarked}
		<div class="bookmark-badge" title="Bookmarked">
			<Bookmark size={16} />
		</div>
	{/if}

	{#if parts.title}
		<h3 class="post-title">{parts.title}</h3>
	{/if}
	{#if parts.body}
		<p class="post-text">
			{@html linkifyText(parts.body, parts.bodyFacets)}
		</p>
	{/if}
	{#if post.images.length}
		<div class="post-images">
			{#each post.images as image}
				<img src={image} alt="Dog post" loading="lazy" />
			{/each}
		</div>
	{/if}

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
			<div class="comments-more"><Bluesky size={13} />more...</div>
		{/if}
	</a>
</article>

<style>
	.post-card {
		position: relative;
		border: 1px solid #e2d4c5;
		border-radius: 12px;
		padding: 0.75rem;
		background: #fff;
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

	.bookmark-badge {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: rgba(251, 236, 178, 0.95);
		border: 1px solid #d5b650;
		color: #7a5f00;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2;
	}

	.post-title {
		margin: 0 2.2rem 0 2.2rem;
		font-size: 1.02rem;
		font-weight: 700;
		line-height: 1.3;
	}

	.post-text {
		margin: 0.35rem 0 0;
		line-height: 1.35;
		word-break: break-word;
	}

	.post-text :global(a) {
		color: #2d5f9a;
		text-decoration: underline;
	}

	.post-images {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.35rem;
		margin-top: 0.65rem;
	}

	.post-images img {
		width: 100%;
		aspect-ratio: 1 / 1;
		height: auto;
		object-fit: cover;
		border-radius: 9px;
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
		width: 18px;
		height: 18px;
		border-radius: 999px;
		object-fit: cover;
		border: 1px solid #d9ccb9;
		background: #fff;
		flex: 0 0 18px;
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

	.comments-more {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0 -0.75rem;
		padding: 0.35rem 0.75rem;
		width: calc(100% + 1.5rem);
		background: #f3ede6;
		border-top: 1px solid #ede5d8;
		font-size: 0.78rem;
		color: #2d5f9a;
		text-align: left;
		text-decoration: none;
	}

	.post-footer:hover .comments-more {
		color: #1a4a7a;
		text-decoration: none;
	}
</style>
