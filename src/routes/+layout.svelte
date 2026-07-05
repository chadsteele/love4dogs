<script>
	import {onMount} from "svelte"
	import {browser} from "$app/environment"
	import {fullPageEditor} from "$lib/fullPageEditor.js"
	import {getCalendarYear} from "$lib/dateTime"
	let {children} = $props()
	const currentYear = getCalendarYear()

	onMount(() => {
		if (browser && "serviceWorker" in navigator) {
			navigator.serviceWorker
				.register("/service-worker.js", {type: "module"})
				.then((reg) => {
					console.log(
						"ServiceWorker registered with scope:",
						reg.scope,
					)
				})
				.catch((err) => {
					console.error("ServiceWorker registration failed:", err)
				})
		}
		if (browser) {
			import("$lib/utils").then((m) => {
				m.cleanWaterPostsFromCaches().catch((err) => {
					console.error("Failed to run cache clean-up:", err)
				})
			})

			// Handle broken image tags (hide and retry loading them)
			const handleImageError = (event) => {
				if (event.target && event.target.tagName === "IMG") {
					const img = event.target
					img.style.opacity = "0"
					const retries = parseInt(
						img.getAttribute("data-retry-count") || "0",
						10,
					)
					if (retries < 15) {
						img.setAttribute(
							"data-retry-count",
							String(retries + 1),
						)
						const src = img.src
						if (src) {
							setTimeout(() => {
								img.src = ""
								img.src = src
							}, 2000)
						}
					}
				}
			}

			const handleImageLoad = (event) => {
				if (event.target && event.target.tagName === "IMG") {
					event.target.style.opacity = ""
				}
			}

			window.addEventListener("error", handleImageError, true)
			window.addEventListener("load", handleImageLoad, true)

			const attachIframeClickOverlays = () => {
				document
					.querySelectorAll("div.content-html iframe")
					.forEach((iframe) => {
						if (iframe.getAttribute("data-overlay-wrapped")) {
							return
						}

						const wrapper = document.createElement("div")
						wrapper.className = "iframe-overlay-wrapper"

						const overlay = document.createElement("div")
						overlay.className = "iframe-click-overlay"
						overlay.setAttribute("role", "button")
						overlay.setAttribute("tabindex", "0")
						overlay.setAttribute(
							"aria-label",
							"Open embedded content in a new tab",
						)

						const openIframeSrcInNewTab = () => {
							const url = iframe.getAttribute("src")
							if (url) {
								window.open(url, "_blank", "noopener,noreferrer")
							}
						}

						overlay.addEventListener("click", (event) => {
							event.preventDefault()
							event.stopPropagation()
							openIframeSrcInNewTab()
						})

						overlay.addEventListener("keydown", (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault()
								openIframeSrcInNewTab()
							}
						})

						const parent = iframe.parentNode
						if (!parent) {
							return
						}

						parent.insertBefore(wrapper, iframe)
						wrapper.appendChild(iframe)
						wrapper.appendChild(overlay)
						iframe.setAttribute("data-overlay-wrapped", "true")
					})
			}

			attachIframeClickOverlays()
			const iframeOverlayInterval = setInterval(
				attachIframeClickOverlays,
				500,
			)



			return () => {
				window.removeEventListener("error", handleImageError, true)
				window.removeEventListener("load", handleImageLoad, true)
				clearInterval(iframeOverlayInterval)
			}
		}
	})
</script>

<div class="bg-kenburns" aria-hidden="true"></div>
<div class="bg-overlay" aria-hidden="true"></div>

<div class="app-shell">
	{@render children()}
</div>
{#if !$fullPageEditor}
	<div class="footer">
		<p class="meta">
			<span>&copy; {currentYear} Love4Dogs.club</span>
			<span class="sep" aria-hidden="true">•</span>
			<span
				>All content is community-driven and belongs to its owners.</span
			>
			<span class="sep" aria-hidden="true">•</span>
			<span>Contribute yours!</span>
		</p>
		<p class="tagline">Made with ❤️ by animal lovers, for animal lovers.</p>
	</div>
{/if}

<style>
	:global(:root) {
		--font-family-base: "Avenir Next", "Trebuchet MS", sans-serif;
		--font-size-title: 1.35rem;
		--font-size-card-title: 1.35rem;
		--font-size-card-description: 0.95rem;
		--line-height-title: 1.05;
		--line-height-body: 1.35;
		--font-weight-title: 800;
		--color-text-strong: #202020;
		--color-text-body: #374151;
	}

	:global(html),
	:global(body) {
		min-height: 100vh;
	}

	:global(body) {
		margin: 0;
		font-family: var(--font-family-base);
		line-height: var(--line-height-body);
		color: var(--color-text-body);
		background: #10140f;
		display: flex;
		flex-direction: column;
	}

	:global(button),
	:global(input),
	:global(textarea),
	:global(select) {
		font: inherit;
		color: inherit;
	}

	:global(body),
	:global(body *) {
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		user-select: none;
	}

	:global(input),
	:global(select),
	:global(option),
	:global(textarea),
	:global([contenteditable="true"]),
	:global([contenteditable="true"] *),
	:global(.post-card .post-title),
	:global(.post-card .post-description),
	:global(.post-card .post-text),
	:global(.post-card .post-text *),
	:global(.post-card .title),
	:global(.post-card .description),
	:global(.post-view-page .date-time),
	:global(.post-view-page .hero-name),
	:global(.post-view-page .hero-description),
	:global(.post-view-page .content-html),
	:global(.post-view-page .content-html *),
	:global(.post-view-page .author-cta),
	:global(.post-view-page .author-name),
	:global(.profile-view-page .hero-description),
	:global(.profile-view-page .content-html),
	:global(.profile-view-page .content-html *),
	:global(.profile-view-page .chunk-manifest-label),
	:global(.profile-view-page .chunk-manifest h3),
	:global(.profile-view-page .chunk-list a),
	:global(.profile-view-page .profile-post-header .title),
	:global(.profile-view-page .profile-post-header .description),
	:global(.post-text),
	:global(.post-text *) {
		-webkit-touch-callout: default;
		-webkit-user-select: text;
		user-select: text;
	}

	.bg-kenburns {
		position: fixed;
		inset: -8%;
		background-image: url("/background.jpg");
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		animation: ken-burns 40s ease-in-out infinite alternate;
		transform-origin: center;
		will-change: transform;
		z-index: 0;
		pointer-events: none;
	}

	@media (max-width: 700px) {
		.bg-kenburns {
			display: none !important;
		}
	}

	.bg-overlay {
		position: fixed;
		inset: 0;
		background: linear-gradient(
			to bottom,
			rgba(19, 23, 18, 0.35),
			rgba(34, 24, 15, 0.38)
		);
		z-index: 1;
		pointer-events: none;
	}

	.app-shell {
		position: relative;
		z-index: 2;
		flex-grow: 1;
	}

	.footer {
		position: relative;
		z-index: 2;
		margin: 0 auto 1rem;
		max-width: min(1100px, calc(100% - 2rem));
		padding: 0.9rem 1rem;
		box-sizing: border-box;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 14px;
		background: rgba(16, 20, 15, 0.78);
		backdrop-filter: blur(4px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		color: #f7f2e8;
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.footer p {
		margin: 0;
		text-align: center;
	}

	.footer .meta {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		column-gap: 0.15rem;
	}

	.footer .tagline {
		margin-top: 0.2rem;
		color: rgba(247, 242, 232, 0.9);
	}

	.footer .sep {
		display: inline-block;
		padding: 0 0.4rem;
		opacity: 0.7;
	}

	@keyframes ken-burns {
		0% {
			transform: scale(1.04) translate3d(-1%, -1%, 0);
		}
		100% {
			transform: scale(1.16) translate3d(1%, 1%, 0);
		}
	}

	@media (max-width: 700px) {
		.footer {
			font-size: 0.82rem;
			padding: 0.8rem;
			gap: 0.2rem;
		}

		.footer .sep {
			display: none;
		}

		.footer .meta {
			row-gap: 0.1rem;
		}
	}

	/* ── Shared Content HTML / Editor Pell Content Media Layout styles ─────────────────────────────────────────── */
	:global(.content-html img),
	:global(.pell-wrapper .pell-content img) {
		display: block;
		width: auto;
		max-width: min(100%, 720px);
		height: auto;
		margin: 1rem auto;
		border-radius: 14px;
		box-shadow: 0 12px 28px rgba(65, 42, 20, 0.18);
		background: #fff;
	}

	:global(.content-html video),
	:global(.pell-wrapper .pell-content video) {
		display: block;
		width: 100%;
		max-width: min(100%, 720px);
		height: auto;
		margin: 1rem auto;
		border-radius: 14px;
		box-shadow: 0 12px 28px rgba(65, 42, 20, 0.18);
		background: #fff;
	}

	:global(.content-html iframe),
	:global(.pell-wrapper .pell-content iframe) {
		display: block;
		width: 100%;
		max-width: min(100%, 900px);
		min-height: 320px;
		aspect-ratio: 16 / 9;
		margin: 1rem auto;
		border: 0;
		border-radius: 14px;
		box-shadow: 0 12px 28px rgba(65, 42, 20, 0.18);
		background: #fff;
	}

	:global(.content-html p:first-child),
	:global(.content-html h1:first-child),
	:global(.content-html h2:first-child),
	:global(.content-html h3:first-child),
	:global(.pell-wrapper .pell-content p:first-child),
	:global(.pell-wrapper .pell-content h1:first-child),
	:global(.pell-wrapper .pell-content h2:first-child),
	:global(.pell-wrapper .pell-content h3:first-child) {
		margin-top: 0;
	}

	:global(.content-html p:last-child),
	:global(.pell-wrapper .pell-content p:last-child) {
		margin-bottom: 0;
	}

	:global(.content-html a),
	:global(.pell-wrapper .pell-content a) {
		word-break: break-all;
	}

	:global(.content-html [align="left"]),
	:global(.pell-wrapper .pell-content [align="left"]) {
		text-align: left;
	}
	:global(.content-html [align="center"]),
	:global(.pell-wrapper .pell-content [align="center"]) {
		text-align: center;
	}
	:global(.content-html [align="right"]),
	:global(.pell-wrapper .pell-content [align="right"]) {
		text-align: right;
	}

	:global(.content-html [align="left"] img),
	:global(.content-html [align="left"] video),
	:global(.content-html [align="left"] iframe),
	:global(.content-html [align="left"] figure),
	:global(.content-html img[align="left"]),
	:global(.content-html video[align="left"]),
	:global(.content-html iframe[align="left"]),
	:global(.content-html figure[align="left"]),
	:global(.pell-wrapper .pell-content [align="left"] img),
	:global(.pell-wrapper .pell-content [align="left"] video),
	:global(.pell-wrapper .pell-content [align="left"] iframe),
	:global(.pell-wrapper .pell-content [align="left"] figure),
	:global(.pell-wrapper .pell-content img[align="left"]),
	:global(.pell-wrapper .pell-content video[align="left"]),
	:global(.pell-wrapper .pell-content iframe[align="left"]),
	:global(.pell-wrapper .pell-content figure[align="left"]) {
		margin-left: 0;
		margin-right: auto;
	}

	:global(.content-html [align="right"] img),
	:global(.content-html [align="right"] video),
	:global(.content-html [align="right"] iframe),
	:global(.content-html [align="right"] figure),
	:global(.content-html img[align="right"]),
	:global(.content-html video[align="right"]),
	:global(.content-html iframe[align="right"]),
	:global(.content-html figure[align="right"]),
	:global(.pell-wrapper .pell-content [align="right"] img),
	:global(.pell-wrapper .pell-content [align="right"] video),
	:global(.pell-wrapper .pell-content [align="right"] iframe),
	:global(.pell-wrapper .pell-content [align="right"] figure),
	:global(.pell-wrapper .pell-content img[align="right"]),
	:global(.pell-wrapper .pell-content video[align="right"]),
	:global(.pell-wrapper .pell-content iframe[align="right"]),
	:global(.pell-wrapper .pell-content figure[align="right"]) {
		margin-left: auto;
		margin-right: 0;
	}

	:global(.content-html [align="center"] img),
	:global(.content-html [align="center"] video),
	:global(.content-html [align="center"] iframe),
	:global(.content-html [align="center"] figure),
	:global(.content-html img[align="center"]),
	:global(.content-html video[align="center"]),
	:global(.content-html iframe[align="center"]),
	:global(.content-html figure[align="center"]),
	:global(.pell-wrapper .pell-content [align="center"] img),
	:global(.pell-wrapper .pell-content [align="center"] video),
	:global(.pell-wrapper .pell-content [align="center"] iframe),
	:global(.pell-wrapper .pell-content [align="center"] figure),
	:global(.pell-wrapper .pell-content img[align="center"]),
	:global(.pell-wrapper .pell-content video[align="center"]),
	:global(.pell-wrapper .pell-content iframe[align="center"]),
	:global(.pell-wrapper .pell-content figure[align="center"]) {
		margin-left: auto;
		margin-right: auto;
	}

	:global(.content-html figure),
	:global(.pell-wrapper .pell-content figure) {
		margin: 1rem auto;
		max-width: 720px;
	}

	:global(.content-html figcaption),
	:global(.pell-wrapper .pell-content figcaption) {
		margin-top: 0.4rem;
		text-align: center;
		font-size: 0.85rem;
		color: #5f665f;
	}

	:global(.content-html table),
	:global(.content-html pre),
	:global(.content-html code),
	:global(.pell-wrapper .pell-content table),
	:global(.pell-wrapper .pell-content pre),
	:global(.pell-wrapper .pell-content code) {
		max-width: 100%;
		box-sizing: border-box;
	}
	:global(img) {
		transition: opacity 0.3s ease;
	}

	:global(.content-html .iframe-overlay-wrapper) {
		position: relative;
		display: block;
		width: 100%;
		max-width: min(100%, 900px);
		min-height: 320px;
		aspect-ratio: 16 / 9;
		margin: 1rem auto;
		border-radius: 14px;
		overflow: hidden;
		box-shadow: 0 12px 28px rgba(65, 42, 20, 0.18);
		background: #fff;
	}

	:global(.content-html .iframe-overlay-wrapper iframe) {
		display: block;
		width: 100%;
		height: 100%;
		max-width: none;
		min-height: 0;
		aspect-ratio: auto;
		margin: 0;
		border: 0;
		border-radius: 0;
		box-shadow: none;
		background: #fff;
	}

	:global(.content-html .iframe-click-overlay) {
		position: absolute;
		inset: 0;
		z-index: 2;
		cursor: pointer;
		background: transparent;
	}







</style>
