<script>
	import {Download, Share2} from "lucide-svelte"
	import {
		siBluesky,
		siFacebook,
		siWechat,
		siWhatsapp,
		siX,
	} from "simple-icons"

	let {post, shareUrl = ""} = $props()

	let busy = $state(false)
	let status = $state("")

	const SHARE_PLATFORMS = [
		{id: "share", label: "Share", glyph: ""},
		{id: "download", label: "Download photos", glyph: ""},
		{id: "whatsapp", label: "WhatsApp", icon: siWhatsapp},
		{id: "wechat", label: "WeChat", icon: siWechat},
		{id: "facebook", label: "Facebook", icon: siFacebook},
		{id: "twitter", label: "Twitter", icon: siX},
		{id: "bsky", label: "Bluesky", icon: siBluesky},
		{id: "linkedin", label: "LinkedIn", glyph: "in"},
	]

	function splitPostText(text = "") {
		const normalized = String(text || "").replace(/\r\n/g, "\n")
		const newlineIndex = normalized.indexOf("\n")
		if (newlineIndex === -1) {
			return {
				title: normalized.trim(),
				body: "",
			}
		}

		return {
			title: normalized.slice(0, newlineIndex).trim(),
			body: normalized.slice(newlineIndex + 1).trim(),
		}
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
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#39;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
	}

	function linkify(text = "") {
		return escapeHtml(text).replace(
			/(https?:\/\/[^\s<]+)/g,
			'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
		)
	}

	function buildClipboardPayload() {
		const {title, body} = splitPostText(post?.text || "")
		const images = Array.isArray(post?.images) ? post.images : []
		const videoUrl = post?.video?.playlist || ""

		const htmlParts = []
		const plainParts = []

		if (title) {
			htmlParts.push(
				`<h2 style="font-weight:700;font-size:1.15em;margin:0 0 10px 0;">${escapeHtml(title)}</h2>`,
			)
			plainParts.push(title)
		}

		if (body) {
			htmlParts.push(
				`<p style="margin:0 0 10px 0;white-space:pre-wrap;">${linkify(body).replace(/\n/g, "<br>")}</p>`,
			)
			plainParts.push(body)
		}

		if (images.length) {
			htmlParts.push(
				`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">${images
					.map(
						(src, index) =>
							`<img src="${escapeAttr(src)}" alt="Post image ${index + 1}" style="max-width:100%;max-height:400px;display:block;border-radius:8px;">`,
					)
					.join("")}</div>`,
			)
		}

		if (videoUrl) {
			htmlParts.push(
				`<p style="margin:8px 0 0 0;"><strong>Video:</strong> <a href="${escapeAttr(videoUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(videoUrl)}</a></p>`,
			)
			plainParts.push(`Video: ${videoUrl}`)
		}

		if (shareUrl) {
			htmlParts.push(
				`<p style="margin:10px 0 0 0;"><a href="${escapeAttr(shareUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shareUrl)}</a></p>`,
			)
			plainParts.push(shareUrl)
		}

		const html = `<div style="font-family:Avenir Next, Trebuchet MS, sans-serif;line-height:1.5;">${htmlParts.join("")}</div>`
		const plainText = plainParts.filter(Boolean).join("\n\n")

		return {html, plainText}
	}

	function getTargetUrl(platformId, plainText) {
		const encodedText = encodeURIComponent(plainText)
		const encodedUrl = encodeURIComponent(shareUrl || "")

		switch (platformId) {
			case "share":
				return shareUrl || "https://love4dogs.club"
			case "whatsapp":
				return `https://wa.me/?text=${encodeURIComponent(`${plainText}\n\n${shareUrl}`.trim())}`
			case "wechat":
				return "https://web.wechat.com/"
			case "facebook":
				return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`
			case "twitter":
				return `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`
			case "bsky":
				return `https://bsky.app/intent/compose?text=${encodeURIComponent(`${plainText}\n\n${shareUrl}`.trim())}`
			case "linkedin":
				return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`
			default:
				return shareUrl || "https://love4dogs.club"
		}
	}

	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	function imageFileNameFromUrl(url, index) {
		try {
			const parsed = new URL(url)
			const rawName = parsed.pathname.split("/").pop() || ""
			if (!rawName) return `post-image-${index + 1}.jpg`
			return rawName.split("?")[0] || `post-image-${index + 1}.jpg`
		} catch {
			return `post-image-${index + 1}.jpg`
		}
	}

	async function downloadPostImages() {
		const images = Array.isArray(post?.images) ? post.images : []
		if (!images.length) {
			status = "No images to download."
			return
		}

		let downloaded = 0
		for (let index = 0; index < images.length; index += 1) {
			const imageUrl = images[index]
			try {
				const response = await fetch(
					`/api/download-image?url=${encodeURIComponent(imageUrl)}`,
				)
				if (!response.ok) continue
				const blob = await response.blob()
				const objectUrl = URL.createObjectURL(blob)

				const anchor = document.createElement("a")
				anchor.href = objectUrl
				anchor.download = imageFileNameFromUrl(imageUrl, index)
				document.body.appendChild(anchor)
				anchor.click()
				anchor.remove()

				URL.revokeObjectURL(objectUrl)
				downloaded += 1
			} catch {
				// Continue downloading remaining images even if one fails.
			}
		}

		if (!downloaded) {
			status = "Unable to download images right now."
			return
		}

		status =
			downloaded === 1
				? "Downloaded 1 image."
				: `Downloaded ${downloaded} images.`
	}

	async function handleShare(platform) {
		if (busy) return
		busy = true
		status = ""

		if (platform.id === "download") {
			try {
				await downloadPostImages()
			} finally {
				busy = false
				setTimeout(() => {
					if (
						status === "Downloaded 1 image." ||
						status === "Downloaded 2 images." ||
						status.startsWith("Downloaded ") ||
						status === "No images to download." ||
						status === "Unable to download images right now."
					) {
						status = ""
					}
				}, 2000)
			}
			return
		}

		const popup = window.open("", "_blank", "noopener,noreferrer")

		try {
			const {html, plainText} = buildClipboardPayload()

			try {
				await navigator.clipboard.write([
					new ClipboardItem({
						"text/html": new Blob([html], {type: "text/html"}),
						"text/plain": new Blob([plainText], {
							type: "text/plain",
						}),
					}),
				])
			} catch {
				await navigator.clipboard.writeText(plainText)
			}

			status = `Copied. Opening ${platform.label}...`
			await delay(2000)

			const targetUrl = getTargetUrl(platform.id, plainText)
			if (popup && !popup.closed) {
				popup.location.href = targetUrl
			} else {
				window.open(targetUrl, "_blank", "noopener,noreferrer")
			}

			status = `${platform.label} opened.`
			setTimeout(() => {
				if (status === `${platform.label} opened.`) status = ""
			}, 2000)
		} catch {
			if (popup && !popup.closed) popup.close()
			status = "Unable to share right now."
		} finally {
			busy = false
		}
	}
</script>

<div class="share-row" aria-label="Share this post">
	{#each SHARE_PLATFORMS as platform}
		<button
			type="button"
			class="share-btn"
			onclick={() => handleShare(platform)}
			disabled={busy}
			title={`Share to ${platform.label}`}
			aria-label={`Share to ${platform.label}`}
		>
			{#if platform.id === "share"}
				<Share2 size={15} />
			{:else if platform.id === "download"}
				<Download size={15} />
			{:else if platform.icon}
				<svg
					class="brand-icon"
					viewBox="0 0 24 24"
					role="img"
					aria-hidden="true"
				>
					<path fill={`#${platform.icon.hex}`} d={platform.icon.path}
					></path>
				</svg>
			{:else}
				<span class="fallback-glyph">{platform.glyph}</span>
			{/if}
		</button>
	{/each}
</div>
{#if status}
	<p class="share-status">{status}</p>
{/if}

<style>
	.share-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.55rem;
		padding-top: 0.45rem;
		border-top: 1px solid #ede5d8;
	}

	.share-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 999px;
		border: 1px solid #d7c8b6;
		background: #fffdf8;
		color: #4a4a4a;
		cursor: pointer;
	}

	.share-btn:hover {
		background: #f2ecdf;
		border-color: #c5b29e;
	}

	.share-btn:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.brand-icon {
		width: 14px;
		height: 14px;
		display: block;
	}

	.fallback-glyph {
		font-size: 0.76rem;
		font-weight: 700;
		line-height: 1;
		color: #0a66c2;
	}

	.share-status {
		margin: 0.35rem 0 0;
		font-size: 0.78rem;
		color: #3b6e4f;
	}
</style>
