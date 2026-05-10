<script>
	import {onMount} from "svelte"

	let {data: pageData = {}} = $props()

	let jsonData = $state(null)
	let jsonLinks = $state([])
	let loading = $state(true)
	let error = $state("")

	function collectLinks(value, links = new Set()) {
		if (typeof value === "string") {
			const matches = value.match(/https?:\/\/[^\s"'<>]+/g) || []
			for (const match of matches) links.add(match)
			return links
		}
		if (Array.isArray(value)) {
			for (const item of value) collectLinks(item, links)
			return links
		}
		if (value && typeof value === "object") {
			for (const key of Object.keys(value)) {
				collectLinks(value[key], links)
			}
		}
		return links
	}

	onMount(async () => {
		try {
			const uuid = String(pageData.uuid || "")
			const stamp = String(pageData.stamp || "")
			console.log("[profile/view] route params", {uuid, stamp, pageData})
			if (!uuid || !stamp) {
				throw new Error("Missing uuid/stamp route params")
			}
			const query = `${uuid} ${stamp} canonicalurl`.trim()
			const searchUrl = `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&author=${encodeURIComponent("love4dogs.club")}&limit=100`
			console.log("[profile/view] search URL", searchUrl)
			const res = await fetch(searchUrl)
			console.log("[profile/view] search response", {
				status: res.status,
				ok: res.ok,
			})
			if (!res.ok) throw new Error("Profile not found")
			const json = await res.json()
			console.log("[profile/view] search result count", {
				posts: (json.posts || []).length,
			})
			for (const post of json.posts || []) {
				const embed = post?.embed
				const media =
					embed?.$type === "app.bsky.embed.recordWithMedia#view"
						? embed.media
						: embed
				const images =
					media?.$type === "app.bsky.embed.images#view"
						? media.images || []
						: []
				for (const image of images) {
					const alt = String(image?.alt || "")
					if (!alt) continue
					try {
						const parsed = JSON.parse(alt)
						const payloadUuid = String(
							parsed?.uuid || parsed?.u || "",
						)
						const payloadStamp = String(
							parsed?.version || parsed?.v || "",
						)
						const byIdentity =
							payloadUuid === uuid && payloadStamp === stamp
						console.log("[profile/view] parsed alt payload", {
							keys: Object.keys(parsed || {}),
							payloadUuid,
							payloadStamp,
							byIdentity,
						})
						if (byIdentity) {
							jsonData = parsed
							jsonLinks = Array.from(collectLinks(parsed))
							console.log("[profile/view] matched payload", {
								linkCount: jsonLinks.length,
								links: jsonLinks,
							})
							return
						}
					} catch {
						// Not JSON, skip
					}
				}
			}
			throw new Error("Profile not found")
		} catch (e) {
			console.error("[profile/view] error:", e)
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
		{#if jsonLinks.length > 0}
			<section class="links">
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
		<pre>{JSON.stringify(jsonData, null, 2)}</pre>
	{/if}
</main>

<style>
	.page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1rem;
	}

	.loading,
	.error {
		padding: 0.5rem 0;
	}

	.error {
		color: #8e2f21;
	}

	pre {
		white-space: pre-wrap;
		word-break: break-word;
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 1rem;
	}

	.links h2 {
		margin: 0 0 0.4rem;
		font-size: 1rem;
	}

	.links ul {
		margin: 0 0 0.8rem;
		padding-left: 1.25rem;
	}

	.links a {
		word-break: break-all;
	}
</style>
