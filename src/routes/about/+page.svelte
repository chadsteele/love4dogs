<script>
	import {Share2} from "lucide-svelte"

	const siteUrl = "https://love4dogs.club"
	const backgroundImageUrl = `${siteUrl}/background.jpg`
	const aboutTitle = "About Love4Dogs"
	const aboutParagraphs = [
		"Love4Dogs is a community-driven project built on the Bluesky social platform, dedicated to connecting dog lovers, rescuers, fosters, adopters, shelters, and NGOs. Our mission is to create a safe and supportive space where people can share information about dogs in need, rescue updates, and location-aware posts that help connect animals with loving homes.",
		"The goal here is to consolidate dog interests and organizations locally and globally, making it easier for people to find and share information about dogs in their area and around the world. Whether you're looking to adopt, foster, volunteer, or simply connect with other dog enthusiasts, Love4Dogs is here to help you find your pack.",
		"Use the feed to browse recent posts, bookmarks, and trash-managed items in your area or open the composer to publish posts with photos and map-linked locations.",
		"Love4Dogs is committed to creating a safe and supportive community for dog lovers, rescuers, and adopters. We believe in the power of connection and the importance of sharing information to help dogs find loving homes. This is a volunteer effort. I welcome contributions, feedback, and suggestions to make this space as helpful and welcoming as possible. If you have ideas for features, improvements, or just want to say hi, please reach out!",
	]

	let shareStatus = $state("")

	function escapeHtml(value) {
		return value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#39;")
	}

	async function copyShareHtml() {
		const shareUrl = siteUrl
		const htmlParagraphs = aboutParagraphs
			.map(
				(paragraph) =>
					`<p style="margin: 0 0 12px; line-height: 1.45;">${escapeHtml(paragraph)}</p>`,
			)
			.join("")
		const html = `<article style="max-width: 760px; font-family: 'Avenir Next', 'Trebuchet MS', sans-serif; color: #1f2a1f; background: #fffaf1; border: 1px solid #d6decf; border-radius: 12px; overflow: hidden;"><img src="${backgroundImageUrl}" alt="Love4Dogs background" style="display:block; width:100%; height:auto;"><div style="padding: 18px 20px;"><h2 style="margin: 0 0 14px; font-size: 22px;">${escapeHtml(aboutTitle)}</h2>${htmlParagraphs}<p style="margin: 16px 0 0;"><a href="${shareUrl}">${shareUrl}</a></p></div></article>`
		const plain = `${aboutTitle}\n\n${aboutParagraphs.join("\n\n")}\n\n${shareUrl}`

		if (typeof navigator === "undefined" || !navigator.clipboard) {
			shareStatus = "Clipboard is not available in this browser."
			return
		}

		try {
			if (window.ClipboardItem) {
				const item = new ClipboardItem({
					"text/html": new Blob([html], {type: "text/html"}),
					"text/plain": new Blob([plain], {type: "text/plain"}),
				})
				await navigator.clipboard.write([item])
			} else {
				await navigator.clipboard.writeText(plain)
			}
			shareStatus = "Full page content copied with background image HTML."
		} catch {
			shareStatus = "Could not copy share snippet."
		}
	}
</script>

<svelte:head>
	<title>About | Love4Dogs</title>
</svelte:head>

<main class="container">
	<nav class="topline">
		<a class="nav-btn" href="/">＜ Go Back</a>
		<h1 class="page-title">{aboutTitle}</h1>
		<span class="nav-spacer" aria-hidden="true"></span>
	</nav>

	{#each aboutParagraphs as paragraph}
		<p>{paragraph}</p>
	{/each}

	<div class="share-row">
		<button class="nav-btn" onclick={copyShareHtml}>
			<Share2 size="16" />
			Share
		</button>
		{#if shareStatus}
			<p class="share-status">{shareStatus}</p>
		{/if}
	</div>
</main>

<style>
	.container {
		max-width: 820px;
		margin: 1.25rem auto;
		padding: 1rem;
		background: rgba(255, 250, 241, 0.88);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		box-shadow: 0 10px 26px rgba(65, 42, 20, 0.12);
	}

	.topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.page-title {
		margin: 0;
		font-size: 1rem;
		flex: 1;
		text-align: center;
	}

	.nav-spacer {
		display: inline-block;
		width: 108px;
	}

	.nav-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.45rem 1rem;
		background: #3b6e4f;
		color: #fff;
		border: 1px solid #305741;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease;
		white-space: nowrap;
		text-decoration: none;
		font-family: inherit;
	}

	.nav-btn:hover {
		background: #305741;
	}

	.share-row {
		margin-top: 1rem;
		padding-top: 0.9rem;
		border-top: 1px solid rgba(58, 91, 65, 0.15);
	}

	.share-status {
		margin: 0.55rem 0 0;
		font-size: 0.85rem;
		color: #5f665f;
	}
</style>
