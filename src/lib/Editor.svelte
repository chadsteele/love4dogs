<script>
	import {mount, onMount, unmount, untrack} from "svelte"
	import {fullPageEditor} from "$lib/fullPageEditor.js"
	import {EditorView} from "@codemirror/view"
	import {EditorState} from "@codemirror/state"
	import {html as htmlLang} from "@codemirror/lang-html"
	import {oneDark} from "@codemirror/theme-one-dark"
	import {basicSetup} from "codemirror"
	import {
		Bold,
		Heading1 as H1,
		Heading2 as H2,
		Image as ImageIcon,
		Italic,
		Link as LinkIcon,
		Maximize2,
		Minimize2,
		Paintbrush,
		Strikethrough,
		Underline,
		Video as VideoIcon,
	} from "lucide-svelte"

	const MAX_IMAGE_SIZE_BYTES = 2_000_000
	const THUMB_MAX_PX = 600

	/**
	 * A rich-text editor built on pell.
	 *
	 * @prop {string} value – bindable HTML content of the editor
	 * @prop {any} editorEl – bindable; exposes a textarea-like proxy so
	 *   HashTagCloud can read .value / .selectionStart and call
	 *   .focus() / .setSelectionRange() without changes to that component.
	 * @prop {boolean} isDragging – applies visual drag-over styling
	 * @prop {string[]} actions – pell toolbar actions
	 */
	let {
		value = $bindable(""),
		editorEl = $bindable(null),
		uploadedMedia = $bindable([]),
		isDragging = false,
		uploadProgressActive = false,
		uploadProgressPercent = 0,
		uploadProgressLabel = "",
		maxChar = Number.POSITIVE_INFINITY,
		placeholder = "Share your ❤️ for dogs...",
		actions = [
			"h1",
			"h2",
			"bold",
			"italic",
			"underline",
			"strikethrough",
			"link",
		],
		ondragover = () => {},
		ondragleave = () => {},
		ondrop = () => {},
		onmediaerror = /** @type {(url: string) => void} */ (_url) => {},
	} = $props()

	let containerEl = $state(null)
	let pellEditor = null
	let fullPageMode = $state(false)
	let suppressEffect = false
	let htmlLength = $state(0)
	let lastValidHtml = ""
	let imageFileInputEl = $state(null)
	let videoFileInputEl = $state(null)
	let contentDragging = $state(false)
	let htmlMode = $state(false)
	let htmlSource = $state("")
	let cmContainer = $state(null)
	let cmView = null
	let contentProxy = null
	let localUploadProgressActive = $state(false)
	let localUploadProgressPercent = $state(0)
	let localUploadProgressLabel = $state("")
	let mediaDeleteButtonEl = $state(null)
	let activeMediaTarget = $state(null)
	let mediaDeleteVisible = $state(false)
	let mediaDeleteX = $state(0)
	let mediaDeleteY = $state(0)
	let stylePaintArmed = $state(false)
	let stylePaintDecl = ""
	let stylePaintActivationSignature = ""
	let stylePaintLastAppliedSignature = ""
	let stylePaintRemainingUses = 0
	let stylePaintAwaitingFreshSelection = false
	let lastEditorRange = null
	let lastEditorExpandedRange = null

	onMount(() => {
		return () => {
			fullPageEditor.set(false)
		}
	})

	const effectiveUploadProgressActive = $derived(
		uploadProgressActive || localUploadProgressActive,
	)
	const effectiveUploadProgressPercent = $derived(
		localUploadProgressActive
			? localUploadProgressPercent
			: uploadProgressPercent,
	)
	const effectiveUploadProgressLabel = $derived(
		localUploadProgressActive
			? localUploadProgressLabel
			: uploadProgressLabel,
	)

	function createElement(Component, props = {}) {
		const host = document.createElement("span")
		const instance = mount(Component, {
			target: host,
			props,
		})
		const element = host.firstElementChild?.cloneNode(true)
		unmount(instance)
		return element || document.createElement("span")
	}

	function normalizedMaxChar() {
		const next = Number(maxChar)
		if (!Number.isFinite(next) || next <= 0) return Number.POSITIVE_INFINITY
		return Math.floor(next)
	}

	function enforceMaxCharString(nextValue = "") {
		const html = String(nextValue || "")
		const limit = normalizedMaxChar()
		if (!Number.isFinite(limit) || html.length <= limit) {
			htmlLength = html.length
			lastValidHtml = html
			return html
		}
		console.warn("[Editor] max char limit exceeded (string)", {
			incomingLength: html.length,
			limit,
			keptLength: String(lastValidHtml || "").length,
		})
		htmlLength = lastValidHtml.length
		return lastValidHtml
	}

	function enforceMaxChars(contentEl) {
		const limit = normalizedMaxChar()
		const html = String(contentEl?.innerHTML || "")
		if (!Number.isFinite(limit)) {
			htmlLength = html.length
			lastValidHtml = html
			return false
		}
		if (html.length <= limit) {
			htmlLength = html.length
			lastValidHtml = html
			return false
		}
		console.warn("[Editor] max char limit exceeded (content)", {
			incomingLength: html.length,
			limit,
			keptLength: String(lastValidHtml || "").length,
		})
		if (typeof lastValidHtml === "string") {
			contentEl.innerHTML = lastValidHtml
			htmlLength = lastValidHtml.length
		} else {
			htmlLength = html.length
		}
		return true
	}

	/**
	 * Build a textarea-like proxy over the pell contenteditable div so that
	 * HashTagCloud works without modification.
	 */
	function buildProxy(contentEl) {
		return {
			get value() {
				return contentEl.innerText
			},
			get selectionStart() {
				const sel = window.getSelection()
				if (!sel || sel.rangeCount === 0)
					return contentEl.innerText.length
				const range = sel.getRangeAt(0).cloneRange()
				range.selectNodeContents(contentEl)
				range.setEnd(
					sel.getRangeAt(0).startContainer,
					sel.getRangeAt(0).startOffset,
				)
				return range.toString().length
			},
			focus() {
				contentEl.focus()
			},
			setSelectionRange(start) {
				// Place the caret at `start` characters from the beginning
				const walker = document.createTreeWalker(
					contentEl,
					NodeFilter.SHOW_TEXT,
				)
				let remaining = start
				let node = null
				let offset = 0
				while ((node = walker.nextNode())) {
					if (remaining <= node.textContent.length) {
						offset = remaining
						break
					}
					remaining -= node.textContent.length
				}
				if (!node) {
					node = contentEl
					offset = contentEl.childNodes.length
				}
				const range = document.createRange()
				range.setStart(node, offset)
				range.collapse(true)
				const sel = window.getSelection()
				sel?.removeAllRanges()
				sel?.addRange(range)
			},
		}
	}

	function loadImageFile(file) {
		return new Promise((resolve, reject) => {
			const objectUrl = URL.createObjectURL(file)
			const image = new Image()
			image.onload = () => {
				URL.revokeObjectURL(objectUrl)
				resolve(image)
			}
			image.onerror = () => {
				URL.revokeObjectURL(objectUrl)
				reject(new Error(`Cannot read image: ${file.name}`))
			}
			image.src = objectUrl
		})
	}

	function canvasToPngBlob(canvas) {
		return new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
	}

	async function createThumbnailDataUrl(file) {
		const img = await loadImageFile(file)
		const scale = Math.min(
			1,
			THUMB_MAX_PX / Math.max(1, img.naturalWidth, img.naturalHeight),
		)
		const w = Math.max(1, Math.round(img.naturalWidth * scale))
		const h = Math.max(1, Math.round(img.naturalHeight * scale))
		const canvas = document.createElement("canvas")
		canvas.width = w
		canvas.height = h
		canvas.getContext("2d").drawImage(img, 0, 0, w, h)
		return canvas.toDataURL("image/jpeg", 0.82)
	}

	async function normalizeImageForUpload(file) {
		const img = await loadImageFile(file)
		const scale = Math.min(
			1,
			2000 / Math.max(1, img.naturalWidth, img.naturalHeight),
		)
		let w = Math.max(1, Math.round(img.naturalWidth * scale))
		let h = Math.max(1, Math.round(img.naturalHeight * scale))
		const canvas = document.createElement("canvas")
		const ctx = canvas.getContext("2d")
		while (true) {
			canvas.width = w
			canvas.height = h
			ctx.clearRect(0, 0, w, h)
			ctx.drawImage(img, 0, 0, w, h)
			const blob = await canvasToPngBlob(canvas)
			if (!blob) throw new Error(`Cannot convert: ${file.name}`)
			if (blob.size <= MAX_IMAGE_SIZE_BYTES) {
				const base = file.name.replace(/\.[^/.]+$/, "")
				return new File([blob], `${base}.png`, {
					type: "image/png",
					lastModified: Date.now(),
				})
			}
			const nw = Math.max(1, Math.floor(w * 0.9))
			const nh = Math.max(1, Math.floor(h * 0.9))
			if (nw === w && nh === h)
				throw new Error("Image is too large to upload.")
			w = nw
			h = nh
		}
	}

	async function uploadFile(file) {
		const fd = new FormData()
		fd.append("mode", "upload-media")
		fd.append("file", file)
		const res = await fetch("/api/post", {method: "POST", body: fd})
		const json = await res.json().catch(() => ({}))
		if (!res.ok || !json?.ok || !json?.blob)
			throw new Error(json?.error || "Upload failed.")
		return json
	}

	function uploadFileWithProgress(file, onProgress, onUploadComplete) {
		return new Promise((resolve, reject) => {
			const fd = new FormData()
			fd.append("mode", "upload-media")
			fd.append("file", file)

			const xhr = new XMLHttpRequest()
			xhr.open("POST", "/api/post")
			xhr.responseType = "text"
			xhr.timeout = 15 * 60 * 1000

			xhr.upload.onprogress = (event) => {
				if (!event.lengthComputable) return
				const percent = Math.max(
					0,
					Math.min(
						100,
						Math.round((event.loaded / event.total) * 100),
					),
				)
				onProgress(percent)
			}

			xhr.upload.onload = () => {
				onUploadComplete?.()
			}

			xhr.onerror = () => reject(new Error("Upload failed."))
			xhr.onabort = () => reject(new Error("Upload aborted."))
			xhr.ontimeout = () =>
				reject(new Error("Upload timed out. Please try again."))
			xhr.onload = () => {
				let json = {}
				try {
					json = JSON.parse(String(xhr.responseText || "{}"))
				} catch {
					json = {}
				}
				if (
					xhr.status < 200 ||
					xhr.status >= 300 ||
					!json?.ok ||
					!json?.blob
				) {
					reject(new Error(json?.error || "Upload failed."))
					return
				}
				resolve(json)
			}

			xhr.send(fd)
		})
	}

	function insertHtmlAtCaret(contentEl, html) {
		contentEl.focus()
		const sel = window.getSelection()
		if (sel && sel.rangeCount > 0) {
			const range = sel.getRangeAt(0)
			range.deleteContents()
			const frag = range.createContextualFragment(html)
			const last = frag.lastChild
			range.insertNode(frag)
			if (last) {
				const r2 = document.createRange()
				r2.setStartAfter(last)
				r2.collapse(true)
				sel.removeAllRanges()
				sel.addRange(r2)
			}
		} else {
			contentEl.innerHTML += html
		}
		contentEl.dispatchEvent(new Event("input", {bubbles: true}))
	}

	async function handleImageFile(file) {
		if (!pellEditor) return
		const contentEl = pellEditor.content
		try {
			const thumb = await createThumbnailDataUrl(file)
			const alt = file.name || "Image"
			insertHtmlAtCaret(
				contentEl,
				`<img src="${thumb}" alt="${alt.replace(/"/g, "&quot;")}" />`,
			)
			const normalized = await normalizeImageForUpload(file)
			const uploaded = await uploadFile(normalized)
			uploadedMedia = [
				...uploadedMedia,
				{
					kind: "image",
					alt,
					blob: uploaded.blob,
					sourceName: file.name,
				},
			]
		} catch (err) {
			console.error("[Editor] Image insert failed:", err)
		}
	}

	async function handleVideoFile(file) {
		if (!pellEditor) return
		const contentEl = pellEditor.content
		const objUrl = URL.createObjectURL(file)
		const name = file.name || "Video"
		insertHtmlAtCaret(contentEl, `<video src="${objUrl}" controls></video>`)
		try {
			localUploadProgressActive = true
			localUploadProgressPercent = 0
			localUploadProgressLabel = `Uploading video: ${name}`
			const uploaded = await uploadFileWithProgress(
				file,
				(percent) => {
					// Keep below 100 until server responds with uploaded blob metadata.
					localUploadProgressPercent = Math.min(95, percent)
				},
				() => {
					localUploadProgressPercent = Math.max(
						localUploadProgressPercent,
						96,
					)
					localUploadProgressLabel = "Processing video on server..."
				},
			)
			localUploadProgressPercent = 100
			localUploadProgressLabel = "Video upload complete"
			uploadedMedia = [
				...uploadedMedia,
				{
					kind: "video",
					alt: name,
					blob: uploaded.blob,
					sourceName: file.name,
				},
			]
		} catch (err) {
			console.error("[Editor] Video upload failed:", err)
		} finally {
			localUploadProgressActive = false
			localUploadProgressPercent = 0
			localUploadProgressLabel = ""
		}
	}

	async function handleFiles(files) {
		for (const file of files) {
			if (file.type.startsWith("image/")) await handleImageFile(file)
			else if (file.type.startsWith("video/")) await handleVideoFile(file)
		}
	}

	/**
	 * Allow safe inline/block formatting from pasted HTML while stripping
	 * scripts, styles, and any attributes that could carry JS or tracking.
	 */
	function sanitizePastedHtml(html = "") {
		const ALLOWED_TAGS = new Set([
			"p",
			"br",
			"b",
			"strong",
			"i",
			"em",
			"u",
			"s",
			"strike",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"ul",
			"ol",
			"li",
			"a",
			"img",
			"video",
			"source",
			"iframe",
			"span",
			"div",
			"blockquote",
			"pre",
			"code",
		])
		// Only allow href on <a>, and only http/https/mailto hrefs
		const SAFE_HREF = /^(https?:\/\/|mailto:)/i
		const SAFE_SRC = /^(https?:\/\/|blob:|data:)/i
		const LIKELY_IMAGE = /\.(avif|gif|jpe?g|png|svg|webp)(\?|#|$)/i
		const LIKELY_VIDEO = /\.(m3u8|mov|mp4|m4v|webm)(\?|#|$)/i

		const template = document.createElement("div")
		template.innerHTML = html

		function extractFirstUrlFromSrcset(value = "") {
			for (const item of String(value || "").split(",")) {
				const url = item.trim().split(/\s+/)[0] || ""
				if (SAFE_SRC.test(url)) return url
			}
			return ""
		}

		function extractBackgroundImageUrl(styleValue = "") {
			const match = String(styleValue || "").match(
				/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i,
			)
			const candidate = String(match?.[2] || "").trim()
			return SAFE_SRC.test(candidate) ? candidate : ""
		}

		function resolveNodeMediaSrc(node) {
			const direct = String(node.getAttribute("src") || "").trim()
			if (SAFE_SRC.test(direct)) return direct

			for (const attrName of [
				"data-src",
				"data-lazy-src",
				"data-original",
				"data-url",
				"data-src-url",
				"poster",
			]) {
				const candidate = String(
					node.getAttribute(attrName) || "",
				).trim()
				if (SAFE_SRC.test(candidate)) return candidate
			}

			const srcsetBased = extractFirstUrlFromSrcset(
				node.getAttribute("srcset") || node.getAttribute("data-srcset"),
			)
			if (srcsetBased) return srcsetBased

			const backgroundBased = extractBackgroundImageUrl(
				node.getAttribute("style"),
			)
			if (backgroundBased) return backgroundBased

			return ""
		}

		function createMediaElement(url, kind = "image", title = "") {
			if (!url) return null
			if (kind === "video") {
				const video = document.createElement("video")
				video.setAttribute("src", url)
				video.setAttribute("controls", "")
				if (title) video.setAttribute("title", title)
				return video
			}
			const image = document.createElement("img")
			image.setAttribute("src", url)
			if (title) image.setAttribute("alt", title)
			return image
		}

		function hydrateMediaNodes(root) {
			for (const node of root.querySelectorAll("*")) {
				const tag = node.tagName.toLowerCase()
				if (tag === "img" || tag === "video" || tag === "source") {
					const resolved = resolveNodeMediaSrc(node)
					if (resolved) node.setAttribute("src", resolved)
					continue
				}

				if (tag === "a") {
					const href = String(node.getAttribute("href") || "").trim()
					if (!SAFE_SRC.test(href)) continue
					if (node.querySelector("img,video,source")) continue
					const title = String(
						node.getAttribute("title") || node.textContent || "",
					).trim()
					if (LIKELY_IMAGE.test(href)) {
						node.appendChild(
							createMediaElement(href, "image", title),
						)
					} else if (LIKELY_VIDEO.test(href)) {
						node.appendChild(
							createMediaElement(href, "video", title),
						)
					}
					continue
				}

				const backgroundUrl = extractBackgroundImageUrl(
					node.getAttribute("style"),
				)
				if (!backgroundUrl) continue
				if (node.querySelector("img,video,source")) continue
				const title = String(node.getAttribute("title") || "").trim()
				node.prepend(createMediaElement(backgroundUrl, "image", title))
			}
		}

		hydrateMediaNodes(template)

		function clean(node) {
			if (node.nodeType === Node.TEXT_NODE) return true
			if (node.nodeType !== Node.ELEMENT_NODE) return false
			const tag = node.tagName.toLowerCase()
			if (!ALLOWED_TAGS.has(tag)) {
				const mediaSrc = resolveNodeMediaSrc(node)
				if (mediaSrc) {
					const mediaKind = LIKELY_VIDEO.test(mediaSrc)
						? "video"
						: "image"
					const title = String(
						node.getAttribute("title") || "",
					).trim()
					const mediaEl = createMediaElement(
						mediaSrc,
						mediaKind,
						title,
					)
					node.parentNode?.replaceChild(mediaEl, node)
					return true
				}
				// replace with its children (unwrap)
				const parent = node.parentNode
				while (node.firstChild)
					parent.insertBefore(node.firstChild, node)
				parent.removeChild(node)
				return false
			}
			// Strip all attributes except a safe subset on anchors and media tags.
			for (const attr of [...node.attributes]) {
				if (
					tag === "img" &&
					(attr.name === "src" ||
						attr.name === "srcset" ||
						attr.name === "loading" ||
						attr.name === "decoding" ||
						attr.name === "alt" ||
						attr.name === "title")
				) {
					if (
						(attr.name === "src" || attr.name === "srcset") &&
						!SAFE_SRC.test(attr.value)
					) {
						node.removeAttribute(attr.name)
					}
					continue
				}
				if (
					tag === "iframe" &&
					(attr.name === "src" ||
						attr.name === "width" ||
						attr.name === "height" ||
						attr.name === "title" ||
						attr.name === "frameborder" ||
						attr.name === "allow" ||
						attr.name === "referrerpolicy" ||
						attr.name === "allowfullscreen")
				) {
					if (attr.name === "src" && !SAFE_SRC.test(attr.value)) {
						node.removeAttribute(attr.name)
					}
					continue
				}
				if (
					tag === "video" &&
					(attr.name === "src" ||
						attr.name === "srcset" ||
						attr.name === "poster" ||
						attr.name === "controls" ||
						attr.name === "muted" ||
						attr.name === "loop" ||
						attr.name === "playsinline")
				) {
					if (
						(attr.name === "src" ||
							attr.name === "srcset" ||
							attr.name === "poster") &&
						!SAFE_SRC.test(attr.value)
					) {
						node.removeAttribute(attr.name)
					}
					continue
				}
				if (
					tag === "source" &&
					(attr.name === "src" || attr.name === "type")
				) {
					if (attr.name === "src" && !SAFE_SRC.test(attr.value)) {
						node.removeAttribute(attr.name)
					}
					continue
				}
				if (
					tag === "a" &&
					attr.name === "href" &&
					SAFE_HREF.test(attr.value)
				)
					continue
				node.removeAttribute(attr.name)
			}
			// Recurse children (iterate copy since we may mutate)
			for (const child of [...node.childNodes]) clean(child)
			if (
				tag === "img" &&
				!String(node.getAttribute("src") || "").trim()
			) {
				node.parentNode?.removeChild(node)
				return false
			}
			if (
				tag === "video" &&
				!String(node.getAttribute("src") || "").trim() &&
				!node.querySelector("source[src]")
			) {
				node.parentNode?.removeChild(node)
				return false
			}
			return true
		}

		for (const child of [...template.childNodes]) clean(child)
		// Normalize excessive whitespace that comes from clipboard HTML
		return template.innerHTML
			.replace(/[\u00A0\u202F\u2007]/g, " ")
			.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
	}

	function normalizePastedText(text = "") {
		return String(text)
			.replace(/[\u00A0\u202F\u2007]/g, " ")
			.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
			.replace(/\r\n?/g, "\n")
	}

	function normalizeThirdPartyImageSrc(url = "") {
		const source = String(url || "").trim()
		if (!source) return source
		let parsed
		try {
			parsed = new URL(source)
		} catch {
			return source
		}
		if (/static\.wixstatic\.com$/i.test(parsed.hostname)) {
			parsed.pathname = parsed.pathname
				.replace(/,enc_avif(?=,|\/|$)/gi, "")
				.replace(/,,+/g, ",")
		}
		return parsed.toString()
	}

	function escapeHtmlText(value = "") {
		return String(value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
	}

	function escapeHtmlAttr(value = "") {
		return escapeHtmlText(value).replace(/"/g, "&quot;")
	}

	function buildMediaFirstHtmlFromPaste(html = "") {
		const source = String(html || "")
		if (!source.trim()) return ""
		const root = document.createElement("div")
		root.innerHTML = source

		const heading = String(
			root.querySelector("h1, h2, [data-hook='product-item-name']")
				?.textContent || "",
		)
			.replace(/\s+/g, " ")
			.trim()

		const seen = new Set()
		const items = []
		for (const tile of root.querySelectorAll(
			"li[data-hook='product-list-grid-item'], li, [data-hook='product-item-root']",
		)) {
			const img = tile.querySelector("img[src]")
			if (!img) continue
			const src = normalizeThirdPartyImageSrc(
				img.getAttribute("src") || "",
			)
			if (!/^https?:\/\//i.test(src) || seen.has(src)) continue
			seen.add(src)

			const label = String(
				tile.querySelector(
					"[data-hook='product-item-name'], h1, h2, h3",
				)?.textContent ||
					img.getAttribute("alt") ||
					"",
			)
				.replace(/\s+/g, " ")
				.trim()
			items.push({src, label})
		}

		if (!items.length) return ""

		let output = ""
		if (heading) {
			output += `<p><strong>${escapeHtmlText(heading)}</strong></p>`
		}
		for (const item of items) {
			output += `<figure><img src="${escapeHtmlAttr(item.src)}" alt="${escapeHtmlAttr(item.label || "Image")}" />`
			if (item.label) {
				output += `<figcaption>${escapeHtmlText(item.label)}</figcaption>`
			}
			output += `</figure>`
		}
		return output
	}

	function hasExternalMediaUrlsInHtml(html = "") {
		const source = String(html || "")
		if (!source.trim()) return false
		const root = document.createElement("div")
		root.innerHTML = source
		for (const node of root.querySelectorAll(
			"img[src],video[src],source[src]",
		)) {
			const src = String(node.getAttribute("src") || "").trim()
			if (/^https?:\/\//i.test(src)) return true
		}
		return false
	}

	function insertPlainTextAtCaret(contentEl, text) {
		contentEl.focus()
		const sel = window.getSelection()
		const safeText = normalizePastedText(text)

		// Detect if text looks like HTML (contains tags like <iframe>, <div>, etc.)
		const looksLikeHtml = /<[a-z][\w-]*[^>]*>/i.test(safeText)

		if (looksLikeHtml) {
			// Try to insert as sanitized HTML instead of plain text
			const cleanHtml = sanitizePastedHtml(safeText)
			if (cleanHtml.trim()) {
				insertHtmlAtCaret(contentEl, cleanHtml)
				return
			}
		}

		// Fall back to plain text insertion
		if (sel && sel.rangeCount > 0) {
			const range = sel.getRangeAt(0)
			range.deleteContents()

			const fragment = document.createDocumentFragment()
			const lines = safeText.split("\n")
			lines.forEach((line, index) => {
				fragment.appendChild(document.createTextNode(line))
				if (index < lines.length - 1) {
					fragment.appendChild(document.createElement("br"))
				}
			})

			const lastNode = fragment.lastChild
			range.insertNode(fragment)
			if (lastNode) {
				const r2 = document.createRange()
				r2.setStartAfter(lastNode)
				r2.collapse(true)
				sel.removeAllRanges()
				sel.addRange(r2)
			}
		} else {
			contentEl.append(document.createTextNode(safeText))
		}

		dispatchEditorInput(contentEl)
	}

	function logMediaSnapshot(contentEl, reason = "") {
		if (!contentEl) return
		const images = [...contentEl.querySelectorAll("img")]
		const videos = [...contentEl.querySelectorAll("video")]
		const preview = images.slice(0, 5).map((img) => ({
			src: img.getAttribute("src") || "",
			currentSrc: img.currentSrc || "",
			complete: Boolean(img.complete),
			naturalWidth: Number(img.naturalWidth || 0),
			naturalHeight: Number(img.naturalHeight || 0),
			clientWidth: Number(img.clientWidth || 0),
			clientHeight: Number(img.clientHeight || 0),
		}))
		console.log("[Editor] media snapshot", {
			reason,
			imageCount: images.length,
			videoCount: videos.length,
			preview,
		})
	}

	function prettyPrintHtml(html = "") {
		const INLINE = new Set([
			"a",
			"abbr",
			"b",
			"bdi",
			"bdo",
			"br",
			"cite",
			"code",
			"data",
			"dfn",
			"em",
			"i",
			"kbd",
			"mark",
			"q",
			"rp",
			"rt",
			"ruby",
			"s",
			"samp",
			"small",
			"span",
			"strong",
			"sub",
			"sup",
			"time",
			"u",
			"var",
			"wbr",
		])
		const VOID = new Set([
			"area",
			"base",
			"br",
			"col",
			"embed",
			"hr",
			"img",
			"input",
			"link",
			"meta",
			"param",
			"source",
			"track",
			"wbr",
		])
		let indent = 0
		const tab = "  "
		const result = []
		const tokenRe = /(<[^>]+>)|([^<]+)/g
		let match
		while ((match = tokenRe.exec(html)) !== null) {
			const [, tag, text] = match
			if (tag) {
				const isClose = tag.startsWith("</")
				const isSelfClose = tag.endsWith("/>")
				const tagName = (
					tag.match(/[a-zA-Z][a-zA-Z0-9]*/)?.[0] || ""
				).toLowerCase()
				const isVoid = VOID.has(tagName)
				const isInline = INLINE.has(tagName)

				if (isClose) {
					indent = Math.max(0, indent - 1)
					if (!isInline) {
						result.push(tab.repeat(indent) + tag)
					} else {
						const last = result[result.length - 1]
						if (last !== undefined)
							result[result.length - 1] = last + tag
						else result.push(tag)
					}
				} else if (isSelfClose || isVoid) {
					result.push(tab.repeat(indent) + tag)
				} else if (isInline) {
					const last = result[result.length - 1]
					if (last !== undefined)
						result[result.length - 1] = last + tag
					else result.push(tag)
				} else {
					result.push(tab.repeat(indent) + tag)
					indent++
				}
			} else if (text) {
				const trimmed = text.replace(/^\n[\s]*|[\s]*\n$/g, "").trim()
				if (!trimmed) continue
				const last = result[result.length - 1]
				if (last !== undefined && last.match(/<[a-zA-Z][^/][^>]*>$/)) {
					result[result.length - 1] = last + trimmed
				} else {
					result.push(tab.repeat(indent) + trimmed)
				}
			}
		}
		return result.join("\n")
	}

	function toggleHtmlMode() {
		if (!htmlMode) {
			const current = String(
				pellEditor?.content?.innerHTML || value || "",
			)
			const pretty = prettyPrintHtml(current)
			htmlSource = pretty
			value = current
			htmlLength = current.length
			lastValidHtml = current
			htmlMode = true
			syncHtmlModeButtonState()
			return
		}

		const next = enforceMaxCharString(htmlSource)
		htmlSource = next
		value = next
		if (pellEditor?.content) {
			suppressEffect = true
			pellEditor.content.innerHTML = next
			enforceMaxChars(pellEditor.content)
			value = pellEditor.content.innerHTML
			suppressEffect = false
		}
		htmlMode = false
		syncHtmlModeButtonState()
	}

	function syncHtmlModeButtonState() {
		if (!containerEl) return
		const button =
			containerEl.querySelector('[data-action="htmlMode"]') ||
			containerEl.querySelector('button[title="Toggle HTML mode"]')
		if (!button) return
		button.classList.toggle("pell-button-selected", htmlMode)
		button.setAttribute("aria-pressed", htmlMode ? "true" : "false")
	}

	function syncStylePaintButtonState() {
		if (!containerEl) return
		const button =
			containerEl.querySelector('[data-action="stylePaint"]') ||
			containerEl.querySelector('button[title="Style paint"]')
		if (!button) return
		button.classList.toggle("pell-button-selected", stylePaintArmed)
		button.setAttribute("aria-pressed", stylePaintArmed ? "true" : "false")
		button.disabled = htmlMode
		button.setAttribute("aria-disabled", htmlMode ? "true" : "false")
	}

	function logStylePaint(event, data = {}) {
		console.log("[Editor][StylePaint]", event, data)
	}

	function getSelectionSignature(contentEl) {
		const range = getSelectionRange(contentEl)
		if (!range) return ""
		return [
			range.startContainer?.nodeType || "",
			range.startOffset,
			range.endContainer?.nodeType || "",
			range.endOffset,
			range.toString(),
		].join("|")
	}

	function getApplyRange(contentEl) {
		const liveRange = getSelectionRange(contentEl)
		if (liveRange && !liveRange.collapsed) return liveRange
		return null
	}

	function signatureFromRange(range) {
		if (!range) return ""
		return [
			range.startContainer?.nodeType || "",
			range.startOffset,
			range.endContainer?.nodeType || "",
			range.endOffset,
			range.toString(),
		].join("|")
	}

	function getRangeForStyleCapture(contentEl) {
		const liveRange = getSelectionRange(contentEl)
		if (liveRange) return liveRange
		if (!lastEditorRange) return null
		if (!contentEl.contains(lastEditorRange.commonAncestorContainer)) {
			return null
		}
		return lastEditorRange
	}

	function getStyleSourceElement(contentEl) {
		const range = getRangeForStyleCapture(contentEl)
		if (!range) return null
		const fromNode =
			range.startContainer?.nodeType === Node.TEXT_NODE
				? range.startContainer.parentElement
				: range.startContainer
		if (!(fromNode instanceof Element)) return null
		if (fromNode === contentEl) {
			return contentEl.firstElementChild || contentEl
		}
		return fromNode
	}

	function buildStylePaintDeclaration(sourceEl) {
		if (!(sourceEl instanceof Element)) return ""
		const computed = window.getComputedStyle(sourceEl)
		const styles = []

		const color = computed.color
		if (color) styles.push(["color", color])

		const backgroundColor = computed.backgroundColor
		if (backgroundColor && backgroundColor !== "rgba(0, 0, 0, 0)") {
			styles.push(["background-color", backgroundColor])
		}

		const fontWeight = computed.fontWeight
		if (fontWeight && fontWeight !== "400" && fontWeight !== "normal") {
			styles.push(["font-weight", fontWeight])
		}

		const fontStyle = computed.fontStyle
		if (fontStyle && fontStyle !== "normal") {
			styles.push(["font-style", fontStyle])
		}

		const textDecorationLine = computed.textDecorationLine
		if (textDecorationLine && textDecorationLine !== "none") {
			styles.push(["text-decoration-line", textDecorationLine])
			if (
				computed.textDecorationStyle &&
				computed.textDecorationStyle !== "solid"
			) {
				styles.push([
					"text-decoration-style",
					computed.textDecorationStyle,
				])
			}
			if (computed.textDecorationColor) {
				styles.push([
					"text-decoration-color",
					computed.textDecorationColor,
				])
			}
		}

		const fontSize = computed.fontSize
		if (fontSize) styles.push(["font-size", fontSize])

		const fontFamily = computed.fontFamily
		if (fontFamily) styles.push(["font-family", fontFamily])

		const declaration = styles.map(([k, v]) => `${k}: ${v};`).join(" ")
		logStylePaint("captured-declaration", {
			sourceTag: sourceEl.tagName,
			sourceClass: sourceEl.className || "",
			declaration,
			styleCount: styles.length,
		})
		return declaration
	}

	function applyStylePaintToRange(contentEl, range) {
		if (!contentEl || !range || range.collapsed || !stylePaintDecl)
			return false
		logStylePaint("apply-start", {
			textLength: range.toString().length,
			textPreview: range.toString().slice(0, 120),
			declaration: stylePaintDecl,
		})
		const wrapper = document.createElement("span")
		wrapper.setAttribute("style", stylePaintDecl)
		try {
			range.surroundContents(wrapper)
		} catch {
			const fragment = range.extractContents()
			wrapper.appendChild(fragment)
			range.insertNode(wrapper)
		}

		const sel = window.getSelection()
		if (sel) {
			const nextRange = document.createRange()
			nextRange.setStartAfter(wrapper)
			nextRange.collapse(true)
			sel.removeAllRanges()
			sel.addRange(nextRange)
		}

		dispatchEditorInput(contentEl)
		logStylePaint("apply-complete", {
			appliedTag: wrapper.tagName,
			appliedStyle: wrapper.getAttribute("style") || "",
		})
		return true
	}

	function toggleStylePaintMode(contentEl) {
		if (stylePaintArmed) {
			logStylePaint("disarm-manual", {
				reason: "button-toggle",
				remainingUses: stylePaintRemainingUses,
			})
			stylePaintArmed = false
			stylePaintDecl = ""
			stylePaintActivationSignature = ""
			stylePaintLastAppliedSignature = ""
			stylePaintRemainingUses = 0
			stylePaintAwaitingFreshSelection = false
			syncStylePaintButtonState()
			return
		}

		if (!contentEl || htmlMode) {
			logStylePaint("arm-blocked", {
				reason: !contentEl ? "missing-content" : "html-mode",
			})
			return
		}
		const sourceEl = getStyleSourceElement(contentEl)
		if (!sourceEl) {
			logStylePaint("arm-blocked", {
				reason: "no-style-source",
			})
			return
		}

		const capturedDecl = buildStylePaintDeclaration(sourceEl)
		if (!capturedDecl) {
			logStylePaint("arm-blocked", {
				reason: "empty-style-declaration",
				sourceTag: sourceEl.tagName,
			})
			return
		}

		stylePaintDecl = capturedDecl
		stylePaintArmed = true
		stylePaintRemainingUses = 1
		stylePaintLastAppliedSignature = ""
		stylePaintAwaitingFreshSelection = false
		const captureRange = getRangeForStyleCapture(contentEl)
		if (captureRange) {
			stylePaintActivationSignature = signatureFromRange(captureRange)
		} else {
			stylePaintActivationSignature = ""
		}
		logStylePaint("armed", {
			sourceTag: sourceEl.tagName,
			activationSignature: stylePaintActivationSignature,
			declaration: stylePaintDecl,
			remainingUses: stylePaintRemainingUses,
		})
		syncStylePaintButtonState()
	}

	function hasActiveTextSelection(contentEl) {
		if (!contentEl || htmlMode) return false
		const sel = window.getSelection()
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false
		const range = sel.getRangeAt(0)
		if (!contentEl.contains(range.commonAncestorContainer)) return false
		return range.toString().trim().length > 0
	}

	function syncRemoveFormattingButtonState(contentEl = pellEditor?.content) {
		if (!containerEl) return
		const button =
			containerEl.querySelector('[data-action="removeFormatting"]') ||
			containerEl.querySelector('button[title="Remove formatting"]')
		if (!button) return
		const canRemove = hasActiveTextSelection(contentEl)
		button.disabled = !canRemove
		button.setAttribute("aria-disabled", canRemove ? "false" : "true")
	}

	function removeFormatting(contentEl) {
		if (!contentEl || !hasActiveTextSelection(contentEl)) {
			syncRemoveFormattingButtonState(contentEl)
			return
		}
		const range = getSelectionRange(contentEl)
		if (!range || range.collapsed) {
			syncRemoveFormattingButtonState(contentEl)
			return
		}

		contentEl.focus()
		const selectedText = range.toString()
		if (!selectedText.trim()) {
			syncRemoveFormattingButtonState(contentEl)
			return
		}
		const STRIPPABLE_TAGS = new Set([
			"H1",
			"H2",
			"STRONG",
			"B",
			"EM",
			"I",
			"U",
			"S",
			"A",
			"SPAN",
			"FONT",
			"MARK",
			"SUB",
			"SUP",
			"SMALL",
			"BIG",
			"BLOCKQUOTE",
		])
		const normalizedSelectedText = selectedText.replace(/\s+/g, " ").trim()

		function findFullySelectedFormattingElement() {
			let node =
				range.startContainer.nodeType === Node.TEXT_NODE
					? range.startContainer.parentElement
					: range.startContainer
			while (node && node !== contentEl) {
				if (
					node instanceof Element &&
					STRIPPABLE_TAGS.has(node.tagName) &&
					node.contains(range.endContainer)
				) {
					const normalizedNodeText = (node.textContent || "")
						.replace(/\s+/g, " ")
						.trim()
					if (
						normalizedNodeText &&
						normalizedNodeText === normalizedSelectedText
					) {
						return node
					}
				}
				node = node.parentElement
			}
			return null
		}

		const fullySelectedFormattingElement =
			findFullySelectedFormattingElement()
		let replacement
		if (fullySelectedFormattingElement) {
			replacement = document.createTextNode(selectedText)
			fullySelectedFormattingElement.replaceWith(replacement)
		} else {
			const marker = document.createElement("span")
			marker.setAttribute("data-clear-format-marker", "")
			range.deleteContents()
			range.insertNode(marker)
			replacement = document.createTextNode(selectedText)
			marker.replaceWith(replacement)
		}

		for (const tagName of STRIPPABLE_TAGS) {
			for (const el of contentEl.querySelectorAll(tagName)) {
				if ((el.textContent || "").trim()) continue
				if (el.querySelector("img,video,iframe,br")) continue
				el.remove()
			}
		}

		const sel = window.getSelection()
		if (sel) {
			const nextRange = document.createRange()
			nextRange.setStartAfter(replacement)
			nextRange.collapse(true)
			sel.removeAllRanges()
			sel.addRange(nextRange)
		}

		dispatchEditorInput(contentEl)
		syncRemoveFormattingButtonState(contentEl)
	}

	function handleStylePaintSelection(contentEl) {
		if (!stylePaintArmed || !stylePaintDecl || htmlMode) return
		const range = getApplyRange(contentEl)
		if (!range || range.collapsed) return
		if (!range.toString().trim()) return
		const signature = signatureFromRange(range)
		if (stylePaintAwaitingFreshSelection) {
			if (signature && signature !== stylePaintLastAppliedSignature) {
				stylePaintAwaitingFreshSelection = false
				logStylePaint("selection-ready", {
					signature,
					lastAppliedSignature: stylePaintLastAppliedSignature,
				})
			} else {
				logStylePaint("apply-skipped", {
					reason: "awaiting-fresh-selection",
					signature,
					lastAppliedSignature: stylePaintLastAppliedSignature,
				})
				return
			}
		}
		if (!signature || signature === stylePaintActivationSignature) {
			logStylePaint("apply-skipped", {
				reason: !signature
					? "missing-signature"
					: "same-selection-as-activation",
				signature,
				activationSignature: stylePaintActivationSignature,
			})
			return
		}
		if (signature === stylePaintLastAppliedSignature) {
			logStylePaint("apply-skipped", {
				reason: "duplicate-selection-event",
				signature,
				lastAppliedSignature: stylePaintLastAppliedSignature,
			})
			return
		}

		const applied = applyStylePaintToRange(contentEl, range)
		if (!applied) return
		stylePaintLastAppliedSignature = signature
		stylePaintActivationSignature = signature
		stylePaintAwaitingFreshSelection = true
		lastEditorExpandedRange = null
		stylePaintRemainingUses = Math.max(0, stylePaintRemainingUses - 1)
		logStylePaint("apply-use-consumed", {
			remainingUses: stylePaintRemainingUses,
		})
		if (stylePaintRemainingUses > 0) {
			return
		}

		logStylePaint("disarm-auto", {
			reason: "all-uses-consumed",
		})
		stylePaintArmed = false
		stylePaintDecl = ""
		stylePaintActivationSignature = ""
		stylePaintLastAppliedSignature = ""
		stylePaintRemainingUses = 0
		stylePaintAwaitingFreshSelection = false
		syncStylePaintButtonState()
	}

	function getSelectionRange(contentEl) {
		const sel = window.getSelection()
		if (!sel || sel.rangeCount === 0) return null
		const range = sel.getRangeAt(0)
		if (!contentEl.contains(range.commonAncestorContainer)) return null
		return range
	}

	function closestByTagNames(node, tagNames, stopEl) {
		let current = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node
		while (current && current !== stopEl) {
			if (tagNames.includes(current?.tagName)) return current
			current = current.parentNode
		}
		return null
	}

	function dispatchEditorInput(contentEl) {
		contentEl.dispatchEvent(new Event("input", {bubbles: true}))
	}

	function hideMediaDeleteButton() {
		activeMediaTarget = null
		mediaDeleteVisible = false
	}

	function repositionMediaDeleteButton(contentEl) {
		if (!mediaDeleteVisible || !activeMediaTarget || !containerEl) return
		if (!contentEl.contains(activeMediaTarget)) {
			hideMediaDeleteButton()
			return
		}
		const targetRect = activeMediaTarget.getBoundingClientRect()
		const wrapperRect = containerEl.getBoundingClientRect()
		const contentRect = contentEl.getBoundingClientRect()
		if (
			targetRect.bottom < contentRect.top ||
			targetRect.top > contentRect.bottom ||
			targetRect.right < contentRect.left ||
			targetRect.left > contentRect.right
		) {
			hideMediaDeleteButton()
			return
		}
		mediaDeleteX = Math.max(0, targetRect.right - wrapperRect.left - 10)
		mediaDeleteY = Math.max(0, targetRect.top - wrapperRect.top + 10)
	}

	function showMediaDeleteButton(targetEl, contentEl) {
		if (!targetEl || !contentEl || !containerEl) return
		activeMediaTarget = targetEl
		mediaDeleteVisible = true
		repositionMediaDeleteButton(contentEl)
	}

	function removeActiveMedia() {
		if (!pellEditor?.content || !activeMediaTarget) return
		const contentEl = pellEditor.content
		if (!contentEl.contains(activeMediaTarget)) {
			hideMediaDeleteButton()
			return
		}
		const target = activeMediaTarget
		const parent = target.parentElement
		if (parent?.tagName === "FIGURE") {
			parent.remove()
		} else if (parent?.tagName === "A" && parent.childElementCount === 1) {
			parent.remove()
		} else {
			target.remove()
		}
		hideMediaDeleteButton()
		dispatchEditorInput(contentEl)
	}

	function replaceElementTag(element, nextTagName) {
		const replacement = document.createElement(nextTagName)
		replacement.innerHTML = element.innerHTML
		for (const attr of element.getAttributeNames()) {
			replacement.setAttribute(attr, element.getAttribute(attr) || "")
		}
		element.replaceWith(replacement)
		return replacement
	}

	function toggleBlockTag(contentEl, targetTagName) {
		const range = getSelectionRange(contentEl)
		if (!range) return

		const blockTags = ["H1", "H2", "P", "DIV", "LI", "BLOCKQUOTE"]
		const block =
			closestByTagNames(range.startContainer, blockTags, contentEl) ||
			contentEl

		if (block === contentEl) {
			if (range.collapsed) return
			const wrapper = document.createElement(targetTagName.toLowerCase())
			try {
				const fragment = range.extractContents()
				if (!fragment.textContent?.trim()) return
				wrapper.appendChild(fragment)
				range.insertNode(wrapper)
				const sel = window.getSelection()
				const nextRange = document.createRange()
				nextRange.selectNodeContents(wrapper)
				sel?.removeAllRanges()
				sel?.addRange(nextRange)
				dispatchEditorInput(contentEl)
			} catch {
				return
			}
			return
		}

		const currentTag = block.tagName
		const replacement =
			currentTag === targetTagName
				? replaceElementTag(block, "p")
				: replaceElementTag(block, targetTagName.toLowerCase())
		try {
			const nextRange = document.createRange()
			nextRange.selectNodeContents(replacement)
			const sel = window.getSelection()
			sel?.removeAllRanges()
			sel?.addRange(nextRange)
		} catch {}

		dispatchEditorInput(contentEl)
	}

	function unwrapElement(element) {
		const parent = element.parentNode
		if (!parent) return
		while (element.firstChild) {
			parent.insertBefore(element.firstChild, element)
		}
		parent.removeChild(element)
	}

	function toggleInlineTag(contentEl, tagName) {
		const range = getSelectionRange(contentEl)
		if (!range || range.collapsed) return

		const active = closestByTagNames(
			range.startContainer,
			[tagName],
			contentEl,
		)
		if (active && active.contains(range.endContainer)) {
			const children = [...active.childNodes]
			unwrapElement(active)
			if (children.length) {
				try {
					const nextRange = document.createRange()
					nextRange.setStartBefore(children[0])
					nextRange.setEndAfter(children[children.length - 1])
					const sel = window.getSelection()
					sel?.removeAllRanges()
					sel?.addRange(nextRange)
				} catch {}
			}
			dispatchEditorInput(contentEl)
			return
		}

		const wrapper = document.createElement(tagName.toLowerCase())
		try {
			range.surroundContents(wrapper)
		} catch {
			const fragment = range.extractContents()
			wrapper.appendChild(fragment)
			range.insertNode(wrapper)
		}

		const sel = window.getSelection()
		const nextRange = document.createRange()
		nextRange.selectNodeContents(wrapper)
		sel?.removeAllRanges()
		sel?.addRange(nextRange)
		dispatchEditorInput(contentEl)
	}

	function toggleLink(contentEl) {
		const range = getSelectionRange(contentEl)
		if (!range) return

		const activeAnchor = closestByTagNames(
			range.startContainer,
			["A"],
			contentEl,
		)
		if (activeAnchor && activeAnchor.contains(range.endContainer)) {
			unwrapElement(activeAnchor)
			dispatchEditorInput(contentEl)
			return
		}

		const url = window.prompt("Enter link URL")
		if (!url) return

		const anchor = document.createElement("a")
		anchor.href = url
		anchor.target = "_blank"
		anchor.rel = "noopener noreferrer"

		if (range.collapsed) {
			anchor.textContent = url
			range.insertNode(anchor)
		} else {
			try {
				range.surroundContents(anchor)
			} catch {
				const fragment = range.extractContents()
				anchor.appendChild(fragment)
				range.insertNode(anchor)
			}
		}

		dispatchEditorInput(contentEl)
	}

	onMount(async () => {
		const {default: pell} = await import("pell")
		const iconProps = {
			size: 16,
			color: "currentColor",
			strokeWidth: 2,
		}

		const defaultActionDefs = {
			h1: {
				icon: "H1",
				title: "Heading 1",
				result: () => toggleBlockTag(pellEditor?.content, "H1"),
			},
			h2: {
				icon: "H2",
				title: "Heading 2",
				result: () => toggleBlockTag(pellEditor?.content, "H2"),
			},
			bold: {
				icon: "<strong>B</strong>",
				title: "Bold",
				result: () => toggleInlineTag(pellEditor?.content, "STRONG"),
			},
			italic: {
				icon: '<i class="pell-italic-icon">I</i>',
				title: "Italic",
				result: () => toggleInlineTag(pellEditor?.content, "EM"),
			},
			underline: {
				icon: "<u>U</u>",
				title: "Underline",
				result: () => toggleInlineTag(pellEditor?.content, "U"),
			},
			strikethrough: {
				icon: "<s>S</s>",
				title: "Strikethrough",
				result: () => toggleInlineTag(pellEditor?.content, "S"),
			},
			link: {
				icon: createElement(LinkIcon, iconProps).outerHTML,
				title: "Link",
				result: () => toggleLink(pellEditor?.content),
			},
		}

		const resolvedActions = actions.map((a) =>
			typeof a === "string" && defaultActionDefs[a]
				? {name: a, ...defaultActionDefs[a]}
				: a,
		)

		const imageIcon = createElement(ImageIcon, iconProps).outerHTML
		const videoIcon = createElement(VideoIcon, iconProps).outerHTML
		const stylePaintIcon = createElement(Paintbrush, iconProps).outerHTML
		const removeFormattingIcon = `<svg width="800px" height="800px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none"><path stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 6h5m5 0h-5m0 0-2 6m-2 6 .667-2M5 5l14 14"/></svg>`
		const maximizeIcon = createElement(Maximize2, iconProps).outerHTML
		const minimizeIcon = createElement(Minimize2, iconProps).outerHTML

		const allActions = [
			...resolvedActions,
			{
				name: "removeFormatting",
				icon: removeFormattingIcon,
				title: "Remove formatting",
				result: () => removeFormatting(pellEditor?.content),
			},
			{
				name: "stylePaint",
				icon: stylePaintIcon,
				title: "Style paint",
				result: () => toggleStylePaintMode(pellEditor?.content),
			},

			{
				name: "insertImage",
				icon: imageIcon,
				title: "Insert image",
				result: () => imageFileInputEl?.click(),
			},
			{
				name: "htmlMode",
				icon: '<span class="pell-html-mode-icon">&lt;/&gt;</span>',
				title: "Toggle HTML mode",
				result: () => toggleHtmlMode(),
			},
			{
				name: "fullPage",
				icon: maximizeIcon,
				title: "Full page",
				result: () => {
					fullPageMode = !fullPageMode
					fullPageEditor.set(fullPageMode)
					const btn =
						containerEl?.querySelector(
							'[data-action="fullPage"]',
						) ||
						containerEl?.querySelector('[title="Full page"]') ||
						containerEl?.querySelector('[title="Exit full page"]')
					if (btn) {
						btn.innerHTML = fullPageMode
							? minimizeIcon
							: maximizeIcon
						btn.title = fullPageMode
							? "Exit full page"
							: "Full page"
						btn.classList.toggle(
							"pell-button-selected",
							fullPageMode,
						)
					}
				},
			},
			// {
			// 	name: "insertVideo",
			// 	icon: videoIcon,
			// 	title: "Insert video",
			// 	result: () => videoFileInputEl?.click(),
			// },
		]

		pellEditor = pell.init({
			element: containerEl,
			onChange() {
				if (suppressEffect) return
				suppressEffect = true
				enforceMaxChars(pellEditor.content)
				value = pellEditor.content.innerHTML
				suppressEffect = false
			},
			defaultParagraphSeparator: "br",
			styleWithCSS: false,
			actions: allActions,
		})

		// Set initial value
		if (value) {
			pellEditor.content.innerHTML = value
		}
		lastValidHtml = String(pellEditor.content.innerHTML || "")
		enforceMaxChars(pellEditor.content)
		syncHtmlModeButtonState()
		syncRemoveFormattingButtonState(pellEditor.content)
		syncStylePaintButtonState()

		// Add placeholder behaviour
		const content = pellEditor.content
		content.setAttribute("data-placeholder", placeholder)

		// Expose proxy so HashTagCloud can use it
		contentProxy = buildProxy(content)
		editorEl = contentProxy

		// Internal drag-and-drop for media files onto the content area
		function onContentDragover(e) {
			if ([...(e.dataTransfer?.types || [])].includes("Files")) {
				e.preventDefault()
				e.stopPropagation()
				contentDragging = true
			}
		}
		function onContentDragleave(e) {
			if (!content.contains(e.relatedTarget)) contentDragging = false
		}
		function onContentDrop(e) {
			const files = [...(e.dataTransfer?.files || [])].filter(
				(f) =>
					f.type.startsWith("image/") || f.type.startsWith("video/"),
			)
			if (!files.length) return
			e.preventDefault()
			e.stopPropagation()
			contentDragging = false
			handleFiles(files)
		}
		function onContentPaste(e) {
			e.preventDefault()
			const clipboardFiles = [...(e.clipboardData?.files || [])].filter(
				(file) =>
					file.type.startsWith("image/") ||
					file.type.startsWith("video/"),
			)
			const html = e.clipboardData?.getData("text/html") || ""
			const pastedText = e.clipboardData?.getData("text/plain") ?? ""
			console.log("[Editor] paste detected", {
				fileCount: clipboardFiles.length,
				htmlLength: html.length,
				textLength: pastedText.length,
			})

			let insertedTextualContent = false
			let htmlHadExternalMediaUrls = false

			if (html) {
				const mediaFirst = buildMediaFirstHtmlFromPaste(html)
				const clean = mediaFirst || sanitizePastedHtml(html)
				if (clean.trim()) {
					htmlHadExternalMediaUrls = hasExternalMediaUrlsInHtml(clean)
					insertHtmlAtCaret(content, clean)
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							logMediaSnapshot(content, "after-paste-html")
						})
					})
					insertedTextualContent = true
					console.log("[Editor] pasted sanitized HTML", {
						usedMediaFirst: Boolean(mediaFirst),
						cleanLength: clean.length,
						htmlHadExternalMediaUrls,
					})
				}
			}

			if (!insertedTextualContent && pastedText.trim()) {
				insertPlainTextAtCaret(content, pastedText)
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						logMediaSnapshot(content, "after-paste-text")
					})
				})
				insertedTextualContent = true
				console.log("[Editor] pasted plain text", {
					textLength: pastedText.length,
				})
			}

			if (clipboardFiles.length) {
				if (htmlHadExternalMediaUrls) {
					console.log(
						"[Editor] skipping clipboard files because HTML already includes external media URLs",
						{fileCount: clipboardFiles.length},
					)
					return
				}
				console.log("[Editor] processing pasted media files", {
					fileCount: clipboardFiles.length,
					types: clipboardFiles.map((file) => file.type),
				})
				handleFiles(clipboardFiles)
				return
			}

			if (!insertedTextualContent) {
				console.log("[Editor] paste had no usable text/html/media")
			}
		}
		function onContentMediaLoad(e) {
			const el = e.target
			if (
				!(
					el instanceof HTMLImageElement ||
					el instanceof HTMLVideoElement
				)
			) {
				return
			}
			if (el instanceof HTMLImageElement) {
				console.log("[Editor] image load", {
					src: el.getAttribute("src") || "",
					currentSrc: el.currentSrc || "",
					naturalWidth: Number(el.naturalWidth || 0),
					naturalHeight: Number(el.naturalHeight || 0),
				})
				return
			}
			console.log("[Editor] video load", {
				src: el.getAttribute("src") || "",
				readyState: Number(el.readyState || 0),
			})
		}
		function onContentMediaError(e) {
			const el = e.target
			if (
				!(
					el instanceof HTMLImageElement ||
					el instanceof HTMLVideoElement
				)
			) {
				return
			}
			if (el instanceof HTMLImageElement) {
				const src = el.getAttribute("src") || ""
				console.warn("[Editor] image error", {
					src,
					currentSrc: el.currentSrc || "",
					complete: Boolean(el.complete),
					naturalWidth: Number(el.naturalWidth || 0),
					naturalHeight: Number(el.naturalHeight || 0),
				})
				if (src.startsWith("https://")) {
					onmediaerror(src)
				}
				return
			}
			console.warn("[Editor] video error", {
				src: el.getAttribute("src") || "",
				readyState: Number(el.readyState || 0),
			})
		}
		function onContentPointerMove(e) {
			const target =
				e.target instanceof Element
					? e.target.closest("img,video,iframe")
					: null
			if (target && content.contains(target)) {
				showMediaDeleteButton(target, content)
			} else if (activeMediaTarget) {
				repositionMediaDeleteButton(content)
			}
		}
		function onContentPointerDown(e) {
			if (
				mediaDeleteButtonEl &&
				e.target instanceof Node &&
				mediaDeleteButtonEl.contains(e.target)
			) {
				return
			}
			const target =
				e.target instanceof Element
					? e.target.closest("img,video,iframe")
					: null
			if (target && content.contains(target)) {
				showMediaDeleteButton(target, content)
				return
			}
			hideMediaDeleteButton()
		}
		function onContentScroll() {
			repositionMediaDeleteButton(content)
		}
		function onWindowResize() {
			repositionMediaDeleteButton(content)
		}
		function onSelectionTrack() {
			const currentRange = getSelectionRange(content)
			if (currentRange) {
				lastEditorRange = currentRange.cloneRange()
				if (!currentRange.collapsed) {
					lastEditorExpandedRange = currentRange.cloneRange()
				}
			}
			syncRemoveFormattingButtonState(content)
		}

		function onSelectionCommit() {
			onSelectionTrack()
			handleStylePaintSelection(content)
		}
		content.addEventListener("dragover", onContentDragover)
		content.addEventListener("dragleave", onContentDragleave)
		content.addEventListener("drop", onContentDrop)
		content.addEventListener("paste", onContentPaste)
		content.addEventListener("load", onContentMediaLoad, true)
		content.addEventListener("error", onContentMediaError, true)
		content.addEventListener("pointermove", onContentPointerMove)
		content.addEventListener("pointerdown", onContentPointerDown)
		content.addEventListener("mouseup", onSelectionCommit)
		content.addEventListener("keyup", onSelectionCommit)
		content.addEventListener("focus", onSelectionTrack)
		content.addEventListener("blur", onSelectionTrack)
		content.addEventListener("scroll", onContentScroll)
		document.addEventListener("selectionchange", onSelectionTrack)
		window.addEventListener("resize", onWindowResize)

		return () => {
			content.removeEventListener("dragover", onContentDragover)
			content.removeEventListener("dragleave", onContentDragleave)
			content.removeEventListener("drop", onContentDrop)
			content.removeEventListener("paste", onContentPaste)
			content.removeEventListener("load", onContentMediaLoad, true)
			content.removeEventListener("error", onContentMediaError, true)
			content.removeEventListener("pointermove", onContentPointerMove)
			content.removeEventListener("pointerdown", onContentPointerDown)
			content.removeEventListener("mouseup", onSelectionCommit)
			content.removeEventListener("keyup", onSelectionCommit)
			content.removeEventListener("focus", onSelectionTrack)
			content.removeEventListener("blur", onSelectionTrack)
			content.removeEventListener("scroll", onContentScroll)
			document.removeEventListener("selectionchange", onSelectionTrack)
			window.removeEventListener("resize", onWindowResize)
			hideMediaDeleteButton()
			contentProxy = null
			lastEditorRange = null
			lastEditorExpandedRange = null
			editorEl = null
			pellEditor = null
		}
	})

	$effect(() => {
		if (htmlMode && stylePaintArmed) {
			logStylePaint("disarm-auto", {
				reason: "entered-html-mode",
				remainingUses: stylePaintRemainingUses,
			})
			stylePaintArmed = false
			stylePaintDecl = ""
			stylePaintActivationSignature = ""
			stylePaintLastAppliedSignature = ""
			stylePaintRemainingUses = 0
			stylePaintAwaitingFreshSelection = false
		}
		syncHtmlModeButtonState()
		syncRemoveFormattingButtonState()
		syncStylePaintButtonState()
		if (!htmlMode && contentProxy) editorEl = contentProxy
	})

	$effect(() => {
		if (!htmlMode || !cmContainer) {
			cmView?.destroy()
			cmView = null
			return
		}
		const initialContent = untrack(() => htmlSource)
		cmView = new EditorView({
			state: EditorState.create({
				doc: initialContent,
				extensions: [
					basicSetup,
					htmlLang(),
					oneDark,
					EditorView.theme({"&": {height: "auto"}}),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged) return
						const next = update.state.doc.toString()
						const safe = enforceMaxCharString(next)
						htmlSource = safe
						value = safe
					}),
				],
			}),
			parent: cmContainer,
		})
		return () => {
			cmView?.destroy()
			cmView = null
		}
	})

	// Sync external value changes (e.g. loadPostIntoEditor sets draft = "...")
	$effect(() => {
		if (!pellEditor || suppressEffect || htmlMode) return
		const incoming = value ?? ""
		if (pellEditor.content.innerHTML !== incoming) {
			suppressEffect = true
			pellEditor.content.innerHTML = incoming
			enforceMaxChars(pellEditor.content)
			suppressEffect = false
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					logMediaSnapshot(pellEditor?.content, "after-external-sync")
				})
			})
		}
	})

	$effect(() => {
		if (!pellEditor || suppressEffect || htmlMode) return
		suppressEffect = true
		enforceMaxChars(pellEditor.content)
		value = pellEditor.content.innerHTML
		suppressEffect = false
	})
</script>

<input
	bind:this={imageFileInputEl}
	type="file"
	accept="image/*"
	multiple
	hidden
	onchange={(e) => {
		handleFiles([...(e.currentTarget?.files || [])])
		if (e.currentTarget) e.currentTarget.value = ""
	}}
/>
<input
	bind:this={videoFileInputEl}
	type="file"
	accept="video/*"
	multiple
	hidden
	onchange={(e) => {
		handleFiles([...(e.currentTarget?.files || [])])
		if (e.currentTarget) e.currentTarget.value = ""
	}}
/>

{#if effectiveUploadProgressActive}
	<div class="upload-progress" role="status" aria-live="polite">
		<div class="upload-progress-row">
			<span>{effectiveUploadProgressLabel || "Uploading media…"}</span>
			<span>{effectiveUploadProgressPercent}%</span>
		</div>
		<div class="upload-progress-track">
			<div
				class="upload-progress-fill"
				style={`width: ${Math.max(0, Math.min(100, effectiveUploadProgressPercent))}%`}
			></div>
		</div>
	</div>
{/if}

<div
	class="pell-wrapper"
	class:is-dragging={isDragging}
	class:content-dragging={contentDragging}
	class:html-mode={htmlMode}
	class:full-page={fullPageMode}
	role="region"
	aria-label="Rich text editor"
	bind:this={containerEl}
	{ondragover}
	{ondragleave}
	{ondrop}
>
	{#if mediaDeleteVisible && !htmlMode}
		<button
			bind:this={mediaDeleteButtonEl}
			type="button"
			class="media-delete-btn"
			style={`left:${mediaDeleteX}px;top:${mediaDeleteY}px;`}
			aria-label="Delete media"
			title="Delete media"
			onmousedown={(e) => {
				e.preventDefault()
				e.stopPropagation()
			}}
			onclick={(e) => {
				e.preventDefault()
				e.stopPropagation()
				removeActiveMedia()
			}}
		>
			x
		</button>
	{/if}
</div>

<div
	class="html-source"
	class:hidden={!htmlMode}
	bind:this={cmContainer}
	aria-label="HTML source editor"
></div>

{#if Number.isFinite(normalizedMaxChar())}
	<p class="editor-counter" class:is-over={htmlLength > normalizedMaxChar()}>
		{htmlLength}/{normalizedMaxChar()}
	</p>
{/if}

<style>
	@import "pell/dist/pell.css";

	.upload-progress {
		margin: 0 0 0.45rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid #d7c8b6;
		border-radius: 10px;
		background: #fff8ef;
	}

	.upload-progress-row {
		display: flex;
		justify-content: space-between;
		gap: 0.65rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: #46583f;
		margin-bottom: 0.3rem;
	}

	.upload-progress-track {
		height: 7px;
		border-radius: 999px;
		overflow: hidden;
		background: #e5dccf;
	}

	.upload-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #6c8e4f, #3f6b44);
		transition: width 180ms ease;
	}

	.pell-wrapper {
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		overflow: hidden;
		box-sizing: border-box;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		position: relative;
		background: #fff;
		display: flex;
		flex-direction: column;
		height: auto;
		min-height: 400px;
		max-height: 90dvh;
	}

	.pell-wrapper.is-dragging {
		background: #ece8d7;
		border-color: #55724d;
	}

	.html-source.hidden {
		display: none;
	}

	.pell-wrapper.html-mode :global(.pell-content) {
		display: none;
		height: 0;
		min-height: 0;
	}

	.pell-wrapper.html-mode {
		height: auto;
		min-height: 0;
		max-height: none;
	}

	.pell-wrapper.html-mode
		:global(
			.pell-button:not([title="Toggle HTML mode"]):not(
					[title="Full page"]
				):not([title="Exit full page"])
		) {
		opacity: 0.35;
		max-height: none;
		pointer-events: none;
		cursor: default;
	}

	.pell-wrapper.content-dragging :global(.pell-content) {
		background: #ece8d7;
		outline: 2px dashed #55724d;
		outline-offset: -4px;
	}

	.pell-wrapper :global(.pell-actionbar) {
		background: #f7f3ec;
		border-bottom: 1px solid #e3d8c8;
		padding: 0.3rem 0.4rem;
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}

	.pell-wrapper :global(.pell-button) {
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		min-width: 28px;
		height: 28px;
		line-height: 1;
		color: #3b4a38;
		padding: 0 6px;
	}

	.pell-wrapper :global(.pell-button svg) {
		width: 16px;
		height: 16px;
	}

	.pell-wrapper :global(.pell-button:disabled) {
		opacity: 0.38;
		cursor: default;
		pointer-events: none;
	}

	.pell-wrapper :global(.pell-button:hover),
	.pell-wrapper :global(.pell-button-selected) {
		background: #e0dace;
		border-color: #c9bfb0;
	}

	.pell-wrapper :global(.pell-button[title="Toggle HTML mode"]) {
		margin-left: auto;
	}

	.pell-wrapper :global(.pell-italic-icon) {
		font-style: italic;
		font-weight: 700;
		font-family: "Atkinson Hyperlegible Mono", "JetBrains Mono", monospace;
	}

	.pell-wrapper :global(.pell-html-mode-icon) {
		font-family: "Atkinson Hyperlegible Mono", "JetBrains Mono", monospace;
		font-weight: 700;
		font-size: 0.76rem;
		line-height: 1;
	}

	.pell-wrapper :global(.pell-button[title="Remove formatting"] svg) {
		width: 18px;
		height: 18px;
	}

	.pell-wrapper :global(.pell-content) {
		flex: 0 1 auto;

		min-width: 100%;
		overflow-y: auto;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		padding: 0.75rem;
		outline: none;
		font: inherit;
		color: #1a1a1a;
		line-height: 1.55;
		box-sizing: border-box;
		width: 100%;
		max-width: 100%;
		overflow-wrap: anywhere;
		word-break: break-word;
		word-wrap: break-word;
	}
	.pell-wrapper :global(.pell-content) {
		height: 50dvh;
		/* resize: none; */
	}

	.pell-wrapper.full-page {
		position: fixed;
		inset: 0;
		z-index: 1000;
		border-radius: 0;
		max-height: 100dvh;
	}

	.pell-wrapper.full-page :global(.pell-content) {
		height: calc(100dvh - 42px);
	}

	.pell-wrapper.full-page.html-mode {
		height: auto;
		min-height: 0;
	}

	.pell-wrapper.full-page.html-mode :global(.pell-content) {
		display: none;
		height: 0;
		min-height: 0;
	}

	.pell-wrapper.full-page.html-mode + .html-source {
		position: fixed;
		left: 0;
		right: 0;
		top: 42px;
		bottom: 0;
		z-index: 1000;
		min-height: auto;
		max-height: none;
		height: auto;
		border-radius: 0;
		border-top: 0;
	}

	.pell-wrapper :global(.pell-content > *) {
		max-width: 100%;
	}

	.html-source {
		width: 100%;
		min-width: 0;
		max-width: 100%;
		height: auto;
		min-height: 400px;
		max-height: 90dvh;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		box-sizing: border-box;
		overflow: hidden;
	}

	.html-source :global(.cm-editor) {
		height: 100%;
		border-radius: 12px;
		overflow: hidden;
	}

	.html-source :global(.cm-scroller) {
		overflow: auto;
		font-family: "Atkinson Hyperlegible Mono", "JetBrains Mono",
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.875rem;
	}

	.pell-wrapper :global(.pell-content img),
	.pell-wrapper :global(.pell-content video) {
		display: block;
		margin: 0.7rem auto;
		width: auto;
		height: auto;
		max-width: min(90dvw, 100%);
		max-height: 30dvh;
		border-radius: 14px;
		box-shadow: 0 14px 30px -18px rgba(20, 18, 14, 0.55);
	}

	@media (min-width: 900px) {
		.pell-wrapper :global(.pell-content img),
		.pell-wrapper :global(.pell-content video) {
			float: left;
			margin: 0.7rem 0.7rem 0.7rem 0;
			margin-right: 50px;
		}
	}

	.pell-wrapper :global(.pell-content iframe) {
		display: block;
		margin: 0.7rem auto;
		/* width: 900px;
		aspect-ratio: 560 / 315; */
		max-width: min(90dvw, 100%);
		border-radius: 14px;
		box-shadow: 0 14px 30px -18px rgba(20, 18, 14, 0.55);
	}

	.pell-wrapper :global(.pell-content iframe),
	.pell-wrapper :global(.pell-content table),
	.pell-wrapper :global(.pell-content pre),
	.pell-wrapper :global(.pell-content code) {
		max-width: 100%;
		box-sizing: border-box;
	}

	.media-delete-btn {
		position: absolute;
		transform: translate(50%, -50%);
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 999px;
		border: 1px solid #d4c2ae;
		background: #fff7ee;
		color: #6d2b1f;
		font-size: 0.85rem;
		line-height: 1;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow: 0 6px 14px -10px rgba(20, 18, 14, 0.7);
		z-index: 6;
	}

	.media-delete-btn:hover {
		background: #ffe5df;
		border-color: #bf7e73;
	}

	/* Placeholder */
	.pell-wrapper :global(.pell-content:empty::before) {
		content: attr(data-placeholder);
		color: #a09080;
		pointer-events: none;
	}

	.editor-counter {
		margin: 0.45rem 0 0;
		text-align: right;
		font-size: 0.8rem;
		color: #506157;
	}

	.editor-counter.is-over {
		color: #8e2f21;
	}
</style>
