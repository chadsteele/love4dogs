<script>
	import {onMount} from "svelte"
	import {
		collectLinksFromValue,
		loadProfileBundleFromPublicBsky,
	} from "$lib/bskyChunkStore"

	let {data: pageData = {}} = $props()

	let jsonData = $state(null)
	let jsonLinks = $state([])
	let loading = $state(true)
	let error = $state("")

	onMount(async () => {
		try {
			const uuid = String(pageData.uuid || "")
			const stamp = String(pageData.stamp || "")
			const loaded = await loadProfileBundleFromPublicBsky({
				fetchImpl: fetch,
				uuid,
				version: stamp,
				author: "love4dogs.club",
			})
			jsonData = loaded?.combined || null
			jsonLinks = Array.from(collectLinksFromValue(jsonData))
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
