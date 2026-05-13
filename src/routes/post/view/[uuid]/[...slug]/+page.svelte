<script>
	import {onMount} from "svelte"
	import {page} from "$app/state"
	import NavBar from "$lib/NavBar.svelte"
	import Linkify from "$lib/Linkify.svelte"
	import {User} from "lucide-svelte"

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
			return new Date(stampMs).toLocaleString()
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

	const uuid = $derived(String(page.params?.uuid || "").trim())
	const authorId = $derived(
		String(jsonData?.authorid || jsonData?.authorId || "").trim(),
	)
	const authorSearchHref = $derived(
		authorId ? `/?q=${encodeURIComponent("uuid " + authorId)}` : "",
	)
	const formattedStamp = $derived(
		formatCompressedStamp(
			jsonData?.stamp ||
				(derivedCreatedAtMs > 0 ? String(derivedCreatedAtMs) : ""),
		),
	)

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
			derivedCreatedAtMs = deriveCreatedAtMsFromBundle(bundle)
			jsonData = {
				...(primary || {}),
				html: Array.isArray(subsequent) ? subsequent.join("") : "",
			}
		} catch (e) {
			error = e?.message || "Failed to load post data"
		} finally {
			loading = false
			console.log({postView: jsonData})
		}

		const authorid = jsonData?.authorid || jsonData?.authorId
		if (authorid) {
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
		}
	})
</script>

<svelte:head>
	<title>Post View | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar {currentView} onSetView={setView} />

	{#if loading}
		<p class="loading">Loading post...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if jsonData}
		<section class="panel hero">
			<div class="hero-body">
				{#if formattedStamp}
					<p class="date-time">{formattedStamp}</p>
				{/if}
				{#if jsonData?.name}
					<h2 class="hero-name">{jsonData.name}</h2>
				{/if}
				{#if jsonData?.description}
					<p class="hero-description">
						<Linkify>{jsonData.description}</Linkify>
					</p>
				{/if}
				<div class="content-html">{@html jsonData?.html || ""}</div>

				<a class="author-info" href={authorSearchHref || undefined}>
					<p class="author-cta">Click for more ❤️ by</p>
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
							<p class="author-name">
								{jsonData?.authorName || "Anonymous"}
							</p>
						</div>
					</div>
				</a>
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

	.author-cta {
		margin: 0 0 0.25rem;
	}

	.author-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.author-info:hover .author-name,
	.author-info:focus-visible .author-name {
		text-decoration: underline;
	}

	.author-avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid rgba(58, 91, 65, 0.28);
	}

	.author-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		padding: 0;
		box-sizing: border-box;
		border-radius: 50%;
		border: 1px solid rgba(58, 91, 65, 0.28);
		color: #5f665f;
	}

	.author-meta {
		display: grid;
		gap: 0.1rem;
	}

	.author-name {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: #2f4336;
	}

	.date-time {
		margin: 0;
		font-size: 0.8rem;
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
