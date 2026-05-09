<script>
	import {Share2, X} from "lucide-svelte"
	import {onMount} from "svelte"
	import {goto} from "$app/navigation"
	import RandomEmojis from "$lib/RandomEmojis.svelte"

	let {mode = "page", onClose} = $props()
	const isModal = $derived(mode === "modal")

	const siteUrl = "https://love4dogs.club"
	const ABOUT_PAGE_VISIT_KEY = "love4dogs.about-page-visited-at"
	const backgroundImageUrl = `${siteUrl}/background.jpg`
	const aboutTitle = "About Love4Dogs"
	const aboutParagraphs = [
		"🛠️ WE'RE UNDER CONSTRUCTION! 🚜👷🏽",
		"Please excuse our mess and come back soon for a better experience. In the meantime, feel free to explore the feed and share posts to help connect animals in need with loving homes.",
		"Love4Dogs is a community-driven project built on the Bluesky social platform, dedicated to connecting ALL ANIMAL lovers, rescuers, fosters, adopters, shelters, and NGOs. Our mission is to create a safe and supportive space where people can share information about animals in need, rescue updates, and location-aware posts that help connect animals with loving homes.",
		"The goal here is to consolidate all animal interests and organizations locally and globally, making it easier for people to find and share information about animals in their area and around the world. Whether you're looking to adopt, foster, volunteer, or simply connect with other animal enthusiasts, Love4Dogs is here to help you find your pack.",
		"Use the feed to browse recent posts, favorites, and hidden items in your area or open the composer to publish posts with photos and map-linked locations.",
		"Love4Dogs is committed to creating a safe and supportive community for animal lovers, rescuers, and adopters. We believe in the power of connection and the importance of sharing information to help animals in distress.",
		"This is a volunteer effort. I welcome contributions, feedback, and suggestions to make this space as helpful and welcoming as possible. If you have ideas for features, improvements, or just want to say hi, please reach out!",
	]

	let shareStatus = $state("")

	onMount(() => {
		if (isModal) return
		if (typeof window === "undefined") return
		localStorage.setItem(ABOUT_PAGE_VISIT_KEY, String(Date.now()))
	})

	async function goBack() {
		if (typeof window !== "undefined" && window.history.length > 1) {
			window.history.back()
			return
		}

		await goto("/")
	}

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

{#if isModal}
	<section class="container container-modal">
		<h2 class="modal-title">{aboutTitle}</h2>
		<RandomEmojis />

		{#each aboutParagraphs as paragraph}
			<p>{paragraph}</p>
		{/each}

		<div class="share-row">
			<button class="nav-btn" onclick={copyShareHtml}>
				<Share2 size="16" />
				Share
			</button>
			{#if onClose}
				<button class="nav-btn close-btn" onclick={onClose}>
					<X size="16" />
					Close
				</button>
			{/if}
			{#if shareStatus}
				<p class="share-status">{shareStatus}</p>
			{/if}
		</div>
	</section>
{:else}
	<div class="page-wrap">
		<main class="container">
			<nav class="topline">
				<button class="nav-btn" onclick={goBack}>＜ Go Back</button>
				<h1 class="page-title">{aboutTitle}</h1>
				<span class="nav-spacer" aria-hidden="true"></span>
			</nav>

			<RandomEmojis />
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
	</div>
{/if}

<style>
	.page-wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem 1rem;
		box-sizing: border-box;
	}

	.container {
		max-width: 820px;
		width: 100%;
		margin: 0;
		padding: 1rem;
		background: rgba(255, 250, 241, 0.88);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		box-shadow: 0 10px 26px rgba(65, 42, 20, 0.12);
	}

	.container-modal {
		max-width: unset;
		width: auto;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}

	.container-modal p {
		margin: 0 0 0.65rem;
		color: #3c4f3f;
		line-height: 1.45;
	}

	.modal-title {
		margin: 0 0 0.45rem;
		font-size: 1.06rem;
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
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding-top: 0.9rem;
		border-top: 1px solid rgba(58, 91, 65, 0.15);
	}

	.close-btn {
		margin-left: auto;
	}

	.share-status {
		margin: 0.55rem 0 0;
		font-size: 0.85rem;
		color: #5f665f;
	}
</style>
