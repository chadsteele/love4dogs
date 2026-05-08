<script>
	import {onMount} from "svelte"
	import {Eraser, Save, X} from "lucide-svelte"
	import Editor from "$lib/Editor.svelte"
	import ProfileImages from "$lib/ProfileImages.svelte"
	import {
		CONTACT_LOCK_PREFIX,
		encryptContact,
		normalizeContactInput,
		mediaTokenFromBuffer,
	} from "$lib/utils"

	const PROFILE_STORAGE_KEY = "love4dogs.profile-v2"
	const NORMALIZED_IMAGE_MAX_DIM = 1800
	const CONTENT_CHUNK_SIZE = 1800
	const CHUNK_ALT_PAYLOAD_TARGET_CHARS = 2000
	const CHUNK_BODY_TEXT_SIZE = 300
	const MEDIA_UPLOAD_CONCURRENCY = 4
	const CDN_PROMOTION_TICK_MS = 20000
	const CDN_PROMOTION_BASE_BACKOFF_MS = 15000
	const CDN_PROMOTION_MAX_BACKOFF_MS = 180000
	const EDITOR_MAX_HTML_CHARS = 300000
	// Set to false only when debugging paste rendering without Bluesky uploads.
	const ENABLE_EDITOR_MEDIA_UPLOADS = true

	let uuid = $state("")
	let primaryVersion = $state("")
	let priorVersion = $state("")

	let email = $state("")
	let profileName = $state("")
	let profileDescription = $state("")
	let contentHtml = $state("")

	let profileUploadedMedia = $state([])
	let backgroundUploadedMedia = $state([])
	let editorMediaList = $state([])
	let editorMediaProcessing = false
	let queuedEditorMediaSource = ""
	let hasQueuedEditorMediaRun = false
	let mediaUploadTotal = $state(0)
	let mediaUploadCompleted = $state(0)
	let mediaUploadActive = $state(false)

	let uploadError = $state("")
	let saveMessage = $state("")
	let saveWarning = $state("")
	let publishMessage = $state("")
	let publishError = $state("")
	let publishing = $state(false)
	let touchedName = $state(false)
	let touchedEmail = $state(false)
	let validationActive = $state(false)
	let profileImageWrapEl
	let profileNameInputEl
	let emailInputEl
	let storageReady = $state(false)
	let initialProfileSnapshot = null
	let suppressAutosave = false
	let lastAutosaveSnapshot = ""

	let minifiedChunkEntries = $state([])
	let chunkBuildVersion = 0
	const cdnPromotionMeta = new Map()
	const editorUploadCache = new Map()
	let failedCdnUrls = $state(new Set())

	function generateShortUuid() {
		return Math.random().toString(36).slice(2, 10)
	}

	function makeVersion() {
		return Date.now().toString(36)
	}

	function chunkHtmlByNodes(html = "", maxChars = CONTENT_CHUNK_SIZE) {
		const source = String(html || "")
		if (!source) return []
		if (typeof document === "undefined") {
			const fallback = []
			for (let i = 0; i < source.length; i += maxChars) {
				fallback.push(source.slice(i, i + maxChars))
			}
			return fallback
		}

		const root = document.createElement("div")
		root.innerHTML = source

		const chunks = []
		let current = ""

		for (const node of root.childNodes) {
			const next =
				node.nodeType === Node.TEXT_NODE
					? node.textContent || ""
					: node.outerHTML || ""
			if (!next) continue

			if ((current + next).length <= maxChars) {
				current += next
				continue
			}

			if (current) {
				chunks.push(current)
				current = ""
			}

			if (next.length <= maxChars) {
				current = next
				continue
			}

			for (let i = 0; i < next.length; i += maxChars) {
				chunks.push(next.slice(i, i + maxChars))
			}
		}

		if (current) chunks.push(current)
		return chunks
	}

	function measureChunkAltPayloadLength(htmlFragment = "", meta = {}) {
		const payload = buildChunkAltPayload(
			{
				uuid: String(meta?.uuid || "u"),
				version: String(meta?.version || "v"),
				index: Number(meta?.index || 1),
				total: Number(meta?.total || 1),
			},
			htmlFragment,
			{forceCompression: Boolean(meta?.forceCompression)},
		)
		return JSON.stringify(payload).length
	}

	function splitFragmentByAltPayload(
		fragment = "",
		maxPayloadChars = CHUNK_ALT_PAYLOAD_TARGET_CHARS,
		meta = {},
	) {
		const source = String(fragment || "")
		if (!source) return []
		const parts = []
		let start = 0
		while (start < source.length) {
			let low = 1
			let high = source.length - start
			let best = 0
			while (low <= high) {
				const mid = Math.floor((low + high) / 2)
				const candidate = source.slice(start, start + mid)
				const payloadLength = measureChunkAltPayloadLength(
					candidate,
					meta,
				)
				if (payloadLength <= maxPayloadChars) {
					best = mid
					low = mid + 1
				} else {
					high = mid - 1
				}
			}
			if (best <= 0) best = 1
			parts.push(source.slice(start, start + best))
			start += best
		}
		return parts
	}

	function enforceAltPayloadLimit(
		fragments = [],
		maxPayloadChars = CHUNK_ALT_PAYLOAD_TARGET_CHARS,
		meta = {},
	) {
		let working = [...fragments]
		let changed = true
		let guard = 0
		while (changed && guard < 12) {
			guard += 1
			changed = false
			const total = working.length
			const next = []
			for (let i = 0; i < total; i += 1) {
				const fragment = String(working[i] || "")
				const payloadLength = measureChunkAltPayloadLength(fragment, {
					uuid: meta?.uuid,
					version: meta?.version,
					index: i + 1,
					total,
					forceCompression: meta?.forceCompression,
				})
				if (payloadLength <= maxPayloadChars) {
					next.push(fragment)
					continue
				}
				const parts = splitFragmentByAltPayload(
					fragment,
					maxPayloadChars,
					{
						uuid: meta?.uuid,
						version: meta?.version,
						index: i + 1,
						total,
						forceCompression: meta?.forceCompression,
					},
				)
				if (parts.length > 1) changed = true
				next.push(...parts)
			}
			working = next
		}
		return working
	}

	function coalesceAltPayloadChunks(
		fragments = [],
		maxPayloadChars = CHUNK_ALT_PAYLOAD_TARGET_CHARS,
		meta = {},
	) {
		const source = fragments
			.map((entry) => String(entry || ""))
			.filter(Boolean)
		if (source.length < 2) return source

		const merged = []
		let i = 0
		while (i < source.length) {
			let current = source[i]
			let nextIndex = i + 1
			while (nextIndex < source.length) {
				const candidate = `${current}${source[nextIndex]}`
				const remainingAfterMerge = source.length - (nextIndex - i)
				const payloadLength = measureChunkAltPayloadLength(candidate, {
					uuid: meta?.uuid,
					version: meta?.version,
					index: merged.length + 1,
					total: remainingAfterMerge,
					forceCompression: meta?.forceCompression,
				})
				if (payloadLength > maxPayloadChars) break
				current = candidate
				nextIndex += 1
			}
			merged.push(current)
			i = nextIndex
		}

		return merged
	}

	function chunkHtmlByAltPayload(
		html = "",
		maxPayloadChars = CHUNK_ALT_PAYLOAD_TARGET_CHARS,
		meta = {},
	) {
		const source = String(html || "")
		if (!source) return []
		if (typeof document === "undefined") {
			const fallback = chunkHtmlByNodes(source, CONTENT_CHUNK_SIZE)
			const limited = enforceAltPayloadLimit(
				fallback,
				maxPayloadChars,
				meta,
			)
			return coalesceAltPayloadChunks(limited, maxPayloadChars, meta)
		}

		const root = document.createElement("div")
		root.innerHTML = source
		const nodeFragments = Array.from(root.childNodes)
			.map((node) =>
				node.nodeType === Node.TEXT_NODE
					? node.textContent || ""
					: node.outerHTML || "",
			)
			.filter(Boolean)

		const chunks = []
		let current = ""
		for (const next of nodeFragments) {
			const candidate = `${current}${next}`
			const estimatedIndex = chunks.length + 1
			const candidateLength = measureChunkAltPayloadLength(candidate, {
				uuid: meta?.uuid,
				version: meta?.version,
				index: estimatedIndex,
				total: estimatedIndex,
				forceCompression: meta?.forceCompression,
			})
			if (candidateLength <= maxPayloadChars) {
				current = candidate
				continue
			}

			if (current) {
				chunks.push(current)
				current = ""
			}

			const nextLength = measureChunkAltPayloadLength(next, {
				uuid: meta?.uuid,
				version: meta?.version,
				index: chunks.length + 1,
				total: chunks.length + 1,
				forceCompression: meta?.forceCompression,
			})
			if (nextLength <= maxPayloadChars) {
				current = next
				continue
			}

			const splitNext = splitFragmentByAltPayload(next, maxPayloadChars, {
				uuid: meta?.uuid,
				version: meta?.version,
				index: chunks.length + 1,
				total: chunks.length + 1,
				forceCompression: meta?.forceCompression,
			})
			chunks.push(...splitNext)
		}
		if (current) chunks.push(current)

		const limited = enforceAltPayloadLimit(chunks, maxPayloadChars, meta)
		return coalesceAltPayloadChunks(limited, maxPayloadChars, meta)
	}

	async function minifyHtmlForChunking(html = "") {
		const source = String(html || "")
		if (!source.trim()) return ""
		try {
			const response = await fetch("/api/minify-html", {
				method: "POST",
				headers: {"content-type": "application/json"},
				body: JSON.stringify({html: source}),
			})
			const json = await response.json().catch(() => ({}))
			if (
				!response.ok ||
				!json?.ok ||
				typeof json.minifiedHtml !== "string"
			) {
				return source
			}
			return json.minifiedHtml
		} catch {
			return source
		}
	}

	function buildChunkAltPayload(meta, htmlFragment = "", options = {}) {
		const sourceHtml = String(htmlFragment || "")
		const compressed = compressChunkHtmlForAlt(sourceHtml, options)
		// Use compact keys to maximize useful HTML inside alt text size limits.
		const payload = {
			u: String(meta?.uuid || ""),
			v: String(meta?.version || ""),
			i: Number(meta?.index || 0),
			t: Number(meta?.total || 0),
			h: compressed.html,
		}
		if (compressed.prefix) {
			payload.p = compressed.prefix
			payload.f = 1
		}
		if (compressed.dict?.length) {
			payload.d = compressed.dict
			payload.f = 2
		}
		return payload
	}

	function findCommonPrefix(values = []) {
		if (!values.length) return ""
		let prefix = String(values[0] || "")
		for (let i = 1; i < values.length && prefix; i += 1) {
			const next = String(values[i] || "")
			let j = 0
			const max = Math.min(prefix.length, next.length)
			while (j < max && prefix[j] === next[j]) j += 1
			prefix = prefix.slice(0, j)
		}
		return prefix
	}

	function compressChunkHtmlForAlt(html = "", options = {}) {
		const source = String(html || "")
		if (!source) return {html: "", prefix: "", dict: []}

		let packed = source
		let prefix = ""
		const urlMatches = [
			...packed.matchAll(
				/https:\/\/cdn\.bsky\.app\/img\/feed_fullsize\/plain\/[^\s"'<>)]+/g,
			),
		].map((match) => match[0])
		const uniqueUrls = [...new Set(urlMatches)]
		if (uniqueUrls.length >= 2) {
			const rawPrefix = findCommonPrefix(uniqueUrls)
			const slashIndex = rawPrefix.lastIndexOf("/")
			if (slashIndex > 0) {
				const candidatePrefix = rawPrefix.slice(0, slashIndex + 1)
				if (candidatePrefix.length >= 40) {
					const token = "~c~"
					const escapedPrefix = candidatePrefix.replace(
						/[.*+?^${}()|[\]\\]/g,
						"\\$&",
					)
					let replacements = 0
					const replaced = packed.replace(
						new RegExp(escapedPrefix, "g"),
						() => {
							replacements += 1
							return token
						},
					)
					if (replacements >= 2) {
						packed = replaced
						prefix = candidatePrefix
					}
				}
			}
		}

		const dictCompression = compressCommonHtmlSubstrings(packed)
		const withDict = dictCompression.html
		const dict = dictCompression.dict

		const baselinePayloadLength = JSON.stringify({h: source}).length
		const candidatePayload = {h: withDict}
		if (prefix) {
			candidatePayload.p = prefix
			candidatePayload.f = 1
		}
		if (dict.length > 0) {
			candidatePayload.d = dict
			candidatePayload.f = 2
		}
		if (JSON.stringify(candidatePayload).length >= baselinePayloadLength) {
			return {html: source, prefix: "", dict: []}
		}

		return {html: withDict, prefix, dict}
	}

	function compressCommonHtmlSubstrings(html = "") {
		let working = String(html || "")
		if (!working) return {html: "", dict: []}

		const candidates = [
			"<figure><img src=",
			"></figcaption></figure>",
			"><figcaption>",
			"</figcaption></figure>",
			"</figure><figure>",
			"<figcaption>",
			"</figcaption>",
			" referrerpolicy=no-referrer",
			" fetchpriority=high",
			" loading=lazy",
			" decoding=async",
			"<p><strong>",
			"</strong></p>",
			"<strong>",
			"</strong>",
			"<figure>",
			"</figure>",
			"<p>",
			"</p>",
			" alt=",
			" src=",
		]

		const dict = []
		for (const needle of candidates) {
			if (!needle || needle.length < 8) continue
			const count = working.split(needle).length - 1
			if (count < 2) continue
			const token = `~${dict.length}~`
			if (token.length >= needle.length) continue
			working = working.split(needle).join(token)
			dict.push(needle)
			if (dict.length >= 12) break
		}

		if (!dict.length) return {html: html, dict: []}
		return {html: working, dict}
	}

	function extractChunkBodyText(html = "", maxChars = CHUNK_BODY_TEXT_SIZE) {
		const source = String(html || "")
		let text = ""
		if (typeof document !== "undefined") {
			const root = document.createElement("div")
			root.innerHTML = source
			const pieces = []
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
			let node = walker.nextNode()
			while (node) {
				const parentTag = node.parentElement?.tagName || ""
				if (!/^(SCRIPT|STYLE|NOSCRIPT)$/i.test(parentTag)) {
					const value = String(node.nodeValue || "")
						.replace(/\s+/g, " ")
						.trim()
					if (value) pieces.push(value)
				}
				node = walker.nextNode()
			}
			text = pieces.join(" ")
		} else {
			text = source.replace(/<[^>]+>/g, " ")
		}
		const normalized = text.replace(/\s+/g, " ").trim()
		return normalized.slice(0, Math.max(0, maxChars))
	}

	function isLikelyImageUrl(url = "") {
		return /\.(avif|gif|jpe?g|png|svg|webp)(\?|#|$)/i.test(url)
	}

	function isLikelyVideoUrl(url = "") {
		return /\.(m3u8|mov|mp4|m4v|webm)(\?|#|$)/i.test(url)
	}

	function isBskyHostedUrl(url = "") {
		const value = String(url || "").trim()
		if (!value) return false
		if (/^at:\/\//i.test(value)) return true
		if (/^https?:\/\/(cdn|video)\.bsky\.app\//i.test(value)) {
			return true
		}
		try {
			const parsed = new URL(value)
			return /^(cdn|video)\.bsky\.app$/i.test(parsed.hostname)
		} catch {
			return false
		}
	}

	function collectUrlTextNodes(root) {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
		const nodes = []
		let current = walker.nextNode()
		while (current) {
			const parentTag = current.parentElement?.tagName || ""
			if (
				current.nodeValue &&
				/https?:\/\//i.test(current.nodeValue) &&
				!/(A|SCRIPT|STYLE|CODE|PRE)/i.test(parentTag)
			) {
				nodes.push(current)
			}
			current = walker.nextNode()
		}
		return nodes
	}

	function convertPlainUrlsToAnchors(root) {
		const urlRegex = /(https?:\/\/[^\s<]+)/gi
		let changed = false
		for (const textNode of collectUrlTextNodes(root)) {
			const raw = String(textNode.nodeValue || "")
			if (!urlRegex.test(raw)) continue
			urlRegex.lastIndex = 0
			const fragment = document.createDocumentFragment()
			let lastIndex = 0
			for (const match of raw.matchAll(urlRegex)) {
				const full = match[0]
				const start = match.index || 0
				if (start > lastIndex) {
					fragment.appendChild(
						document.createTextNode(raw.slice(lastIndex, start)),
					)
				}
				const anchor = document.createElement("a")
				anchor.href = full
				anchor.textContent = full
				anchor.rel = "noopener noreferrer"
				anchor.target = "_blank"
				fragment.appendChild(anchor)
				lastIndex = start + full.length
				changed = true
			}
			if (lastIndex < raw.length) {
				fragment.appendChild(
					document.createTextNode(raw.slice(lastIndex)),
				)
			}
			textNode.parentNode?.replaceChild(fragment, textNode)
		}
		return changed
	}

	function materializeInlineMediaFromLinks(root) {
		let changed = false
		for (const anchor of root.querySelectorAll("a[href]")) {
			const href = String(anchor.getAttribute("href") || "").trim()
			if (!/^https?:\/\//i.test(href)) continue
			if (anchor.querySelector("img,video,source")) continue
			const looksImage = isLikelyImageUrl(href)
			const looksVideo = isLikelyVideoUrl(href)
			if (!looksImage && !looksVideo) continue

			if (looksImage) {
				const img = document.createElement("img")
				img.setAttribute("src", href)
				img.setAttribute(
					"alt",
					String(
						anchor.textContent || anchor.title || "Image",
					).trim(),
				)
				anchor.appendChild(img)
				changed = true
				continue
			}

			const video = document.createElement("video")
			video.setAttribute("src", href)
			video.setAttribute("controls", "")
			anchor.appendChild(video)
			changed = true
		}

		for (const node of root.querySelectorAll(
			"[style*='background-image']",
		)) {
			if (node.querySelector("img,video,source")) continue
			const styleValue = String(node.getAttribute("style") || "")
			const match = styleValue.match(
				/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i,
			)
			const src = String(match?.[2] || "").trim()
			if (!/^https?:\/\//i.test(src)) continue
			if (!isLikelyImageUrl(src)) continue
			const img = document.createElement("img")
			img.setAttribute("src", src)
			img.setAttribute(
				"alt",
				String(node.getAttribute("title") || "Image"),
			)
			node.prepend(img)
			changed = true
		}

		return changed
	}

	function normalizeThirdPartyMediaUrl(url = "") {
		const source = String(url || "").trim()
		if (!source) return source
		if (!/^https?:\/\//i.test(source)) return source
		let parsed
		try {
			parsed = new URL(source)
		} catch {
			return source
		}
		if (!/static\.wixstatic\.com$/i.test(parsed.hostname)) return source

		// Wix URLs often force AVIF with ",enc_avif" in the path segment.
		// Remove only the encoding token to let the CDN choose a broadly compatible format.
		const nextPath = parsed.pathname
			.replace(/,enc_avif(?=,|\/|$)/gi, "")
			.replace(/,,+/g, ",")
		if (nextPath === parsed.pathname) return source
		parsed.pathname = nextPath
		return parsed.toString()
	}

	function normalizeThirdPartyMediaUrlsInRoot(root) {
		let changed = false
		for (const node of root.querySelectorAll(
			"img[src],video[src],source[src]",
		)) {
			const src = String(node.getAttribute("src") || "").trim()
			if (!src) continue
			const normalized = normalizeThirdPartyMediaUrl(src)
			if (!normalized || normalized === src) continue
			node.setAttribute("src", normalized)
			changed = true
		}
		return changed
	}

	function buildLocalImageProxyUrl(url = "") {
		const source = String(url || "").trim()
		if (!source || !/^https?:\/\//i.test(source)) return source
		return `/api/download-image?url=${encodeURIComponent(source)}`
	}

	function isLocalImageProxyUrl(url = "") {
		return /^\/api\/download-image\?url=/i.test(String(url || "").trim())
	}

	function tryDecodeUrlComponent(value = "") {
		const source = String(value || "")
		try {
			return decodeURIComponent(source)
		} catch {
			return source
		}
	}

	function resolveUploadSourceUrl(url = "") {
		let current = String(url || "").trim()
		if (!current) return ""

		for (let i = 0; i < 6; i += 1) {
			if (!isLocalImageProxyUrl(current)) break
			let parsed
			try {
				parsed = new URL(current, window.location.origin)
			} catch {
				break
			}
			const nestedRaw = String(
				parsed.searchParams.get("url") || "",
			).trim()
			if (!nestedRaw) break
			const decoded = tryDecodeUrlComponent(nestedRaw)
			if (!decoded || decoded === current) break
			current = decoded
		}

		if (isLocalImageProxyUrl(current)) {
			return ""
		}
		return current
	}

	function extensionFromMimeType(mimeType = "") {
		const value = String(mimeType || "").toLowerCase()
		if (value.includes("png")) return "png"
		if (value.includes("webp")) return "webp"
		if (value.includes("gif")) return "gif"
		if (value.includes("svg")) return "svg"
		if (value.includes("jpeg") || value.includes("jpg")) return "jpg"
		return "jpg"
	}

	function proxyExternalImageUrlsInRoot(root) {
		let changed = false
		for (const img of root.querySelectorAll("img[src]")) {
			const current = String(img.getAttribute("src") || "").trim()
			if (!current) continue
			if (isLocalImageProxyUrl(current)) continue
			if (!/^https?:\/\//i.test(current)) continue
			if (isBskyHostedUrl(current)) continue
			const proxied = buildLocalImageProxyUrl(current)
			if (!proxied || proxied === current) continue
			img.setAttribute("src", proxied)
			changed = true
		}
		return changed
	}

	async function loadImageFile(file) {
		return await new Promise((resolve, reject) => {
			const objectUrl = URL.createObjectURL(file)
			const image = new Image()
			image.onload = () => {
				URL.revokeObjectURL(objectUrl)
				resolve(image)
			}
			image.onerror = () => {
				URL.revokeObjectURL(objectUrl)
				reject(new Error(`Unable to read image: ${file.name}`))
			}
			image.src = objectUrl
		})
	}

	function canvasToPngBlob(canvas) {
		return new Promise((resolve) => {
			canvas.toBlob((blob) => resolve(blob), "image/png")
		})
	}

	function replaceFileExt(fileName = "", nextExt = ".png") {
		if (!fileName) return `upload${nextExt}`
		const withoutExt = fileName.replace(/\.[^/.]+$/, "")
		return `${withoutExt}${nextExt}`
	}

	async function normalizeImageForSlot(file, maxWidth, maxHeight) {
		const image = await loadImageFile(file)
		const scale = Math.min(
			1,
			maxWidth / Math.max(1, image.naturalWidth),
			maxHeight / Math.max(1, image.naturalHeight),
		)

		let width = Math.max(1, Math.round(image.naturalWidth * scale))
		let height = Math.max(1, Math.round(image.naturalHeight * scale))

		const canvas = document.createElement("canvas")
		const context = canvas.getContext("2d")
		if (!context)
			throw new Error("Unable to process image on this browser.")

		while (true) {
			canvas.width = width
			canvas.height = height
			context.clearRect(0, 0, width, height)
			context.drawImage(image, 0, 0, width, height)

			const blob = await canvasToPngBlob(canvas)
			if (!blob) throw new Error(`Unable to convert image: ${file.name}`)

			if (blob.size <= 2_000_000) {
				return new File([blob], replaceFileExt(file.name, ".png"), {
					type: "image/png",
					lastModified: Date.now(),
				})
			}

			const nextWidth = Math.max(1, Math.floor(width * 0.9))
			const nextHeight = Math.max(1, Math.floor(height * 0.9))
			if (nextWidth === width && nextHeight === height) {
				throw new Error("Image is too large after processing.")
			}
			width = nextWidth
			height = nextHeight
		}
	}

	function getBlobCid(blobRef) {
		if (typeof blobRef !== "object" || !blobRef) return ""
		return String(blobRef.ref?.$link || blobRef.cid || "")
	}

	function replaceMediaUrlInHtml(html = "", fromUrl = "", toUrl = "") {
		const source = String(html || "")
		const from = String(fromUrl || "")
		const to = String(toUrl || "")
		if (!source.trim() || !from || !to || from === to) {
			return {html: source, changed: false}
		}
		if (typeof document === "undefined") {
			const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			const replaced = source.replace(new RegExp(escapedFrom, "g"), to)
			return {html: replaced, changed: replaced !== source}
		}
		const root = document.createElement("div")
		root.innerHTML = source
		let changed = false
		for (const node of root.querySelectorAll("[src],[href]")) {
			for (const attr of ["src", "href"]) {
				if (!node.hasAttribute(attr)) continue
				if (node.getAttribute(attr) !== from) continue
				node.setAttribute(attr, to)
				changed = true
			}
		}
		return {html: changed ? root.innerHTML : source, changed}
	}

	async function isCdnUrlAvailable(url = "") {
		const target = String(url || "").trim()
		if (!target) return false
		try {
			const response = await fetch(
				`/api/check-cdn?url=${encodeURIComponent(target)}`,
				{cache: "no-store"},
			)
			if (!response.ok) return false
			const data = await response.json()
			return data.available === true
		} catch {
			return false
		}
	}

	async function maybePromoteCdnUrls() {
		const pending = editorMediaList.filter((entry) => {
			if (!entry || entry.kind !== "image") return false
			if (!entry.blob || !entry.url || !entry.bskyUrl) return false
			if (!/^https?:\/\//i.test(String(entry.url || ""))) return false
			if (isBskyHostedUrl(entry.url)) return false
			return true
		})

		if (!pending.length) return

		// Check all pending CDN URLs in parallel
		const results = await Promise.all(
			pending.map(async (entry) => {
				const key = `${entry.url}=>${entry.bskyUrl}`
				const meta = cdnPromotionMeta.get(key) || {
					attempts: 0,
					nextAt: 0,
					inFlight: false,
				}
				if (meta.inFlight || Date.now() < meta.nextAt) return null

				meta.inFlight = true
				cdnPromotionMeta.set(key, meta)
				const available = await isCdnUrlAvailable(entry.bskyUrl)
				if (available) {
					cdnPromotionMeta.delete(key)
					return {
						fromUrl: entry.url,
						sourceUrl: entry.sourceUrl,
						bskyUrl: entry.bskyUrl,
					}
				}

				meta.attempts += 1
				const delay = Math.min(
					CDN_PROMOTION_MAX_BACKOFF_MS,
					CDN_PROMOTION_BASE_BACKOFF_MS *
						Math.max(1, 2 ** (meta.attempts - 1)),
				)
				meta.nextAt = Date.now() + delay
				meta.inFlight = false
				cdnPromotionMeta.set(key, meta)
				console.log("[profile] CDN not ready, will retry", {
					fromUrl: entry.url,
					bskyUrl: entry.bskyUrl,
					attempts: meta.attempts,
					nextRetryMs: delay,
				})
				return null
			}),
		)

		// Apply ALL successful promotions in a single contentHtml write
		const toPromote = results.filter(Boolean)
		if (!toPromote.length) return

		let html = contentHtml
		let anyChanged = false
		for (const {fromUrl, sourceUrl, bskyUrl} of toPromote) {
			const promoted = replaceMediaUrlInHtml(html, fromUrl, bskyUrl)
			if (promoted.changed) {
				html = promoted.html
				anyChanged = true
				console.log("[profile] promoted media URL to CDN", {
					fromUrl,
					sourceUrl,
					bskyUrl,
				})
				continue
			}

			if (sourceUrl && sourceUrl !== fromUrl) {
				const fallbackPromoted = replaceMediaUrlInHtml(
					html,
					sourceUrl,
					bskyUrl,
				)
				if (fallbackPromoted.changed) {
					html = fallbackPromoted.html
					anyChanged = true
					console.log("[profile] promoted media URL to CDN", {
						fromUrl,
						sourceUrl,
						bskyUrl,
					})
				}
			}
		}
		if (anyChanged) {
			contentHtml = html
		}
	}

	async function uploadMediaFile(file) {
		const formData = new FormData()
		formData.append("mode", "upload-media")
		formData.append("file", file)
		const response = await fetch("/api/post", {
			method: "POST",
			body: formData,
		})
		const json = await response.json().catch(() => ({}))
		if (!response.ok || !json?.ok || !json?.blob) {
			throw new Error(json?.error || `Failed to upload ${file.name}.`)
		}
		const cid = getBlobCid(json.blob)
		const did = String(json.did || "")
		const bskyUrl =
			json.url ||
			(json.kind === "image" && cid && did
				? `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`
				: "")
		return {
			kind: json.kind,
			alt: file.name || json.alt || "Media",
			blob: json.blob,
			sourceName: file.name || "uploaded",
			sourceUrl: "",
			bskyUrl,
		}
	}

	async function cacheMediaUrlInBsky(sourceUrl, file) {
		const formData = new FormData()
		formData.append("mode", "cache-media-url")
		formData.append("sourceUrl", sourceUrl)
		formData.append("file", file)
		formData.append("profileName", profileName)
		formData.append("profileDescription", profileDescription)
		const response = await fetch("/api/post", {
			method: "POST",
			body: formData,
		})
		const json = await response.json().catch(() => ({}))
		if (!response.ok || !json?.ok || !json?.blob) {
			throw new Error(
				json?.error || `Failed to cache media URL: ${sourceUrl}`,
			)
		}
		const cid = getBlobCid(json.blob)
		const did = String(json.did || "")
		const bskyUrl =
			json.url ||
			(cid && did
				? `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`
				: "")
		return {
			kind: json.kind || "image",
			alt: file.name || json.alt || "Media",
			blob: json.blob,
			sourceName: file.name || "uploaded",
			sourceUrl,
			bskyUrl,
			cacheUri: String(json.cacheUri || ""),
			cacheCid: String(json.cacheCid || ""),
			cached: Boolean(json.cached),
		}
	}

	async function uploadExternalMediaUrl(url, preferredKind = "") {
		const sourceUrl = String(url || "").trim()
		const resolvedSourceUrl = resolveUploadSourceUrl(sourceUrl) || sourceUrl
		if (!resolvedSourceUrl) return null
		if (isBskyHostedUrl(resolvedSourceUrl)) return null
		if (isInlineMediaDataUrl(resolvedSourceUrl)) {
			const response = await fetch(resolvedSourceUrl)
			if (!response.ok)
				throw new Error("Unable to read inline image data.")
			const blob = await response.blob()

			const ext = extensionFromMimeType(blob.type)
			const file = new File([blob], `inline-upload.${ext}`, {
				type: blob.type || "image/jpeg",
			})
			const normalized = await normalizeImageForSlot(
				file,
				NORMALIZED_IMAGE_MAX_DIM,
				NORMALIZED_IMAGE_MAX_DIM,
			)
			const token = await mediaTokenFromBuffer(
				await normalized.arrayBuffer(),
			)
			const result = {
				...uploaded,
				sourceUrl: token,
				alt: uploaded.alt || token,
			}
			editorUploadCache.set(token, result)
			if (sourceUrl) editorUploadCache.set(sourceUrl, result)
			if (resolvedSourceUrl !== sourceUrl)
				editorUploadCache.set(resolvedSourceUrl, result)
			console.log("[profile] inline image uploaded to bsky", {
				token,
				bskyUrl: result?.bskyUrl || "",
			})
			return result
		}
		if (editorUploadCache.has(resolvedSourceUrl))
			return editorUploadCache.get(resolvedSourceUrl)
		const wantsImage =
			preferredKind === "image" || isLikelyImageUrl(resolvedSourceUrl)
		const wantsVideo =
			preferredKind === "video" || isLikelyVideoUrl(resolvedSourceUrl)
		if (!wantsImage && !wantsVideo) return null

		if (wantsImage) {
			console.log("[profile] download image for upload", {
				sourceUrl: resolvedSourceUrl,
			})
			const upstream = await fetch(
				`/api/download-image?url=${encodeURIComponent(resolvedSourceUrl)}`,
			)
			if (!upstream.ok) {
				throw new Error(
					`Unable to fetch image URL: ${resolvedSourceUrl}`,
				)
			}
			const blob = await upstream.blob()
			const sourceName = resolvedSourceUrl.split("/").pop() || "image"
			const imageFile = new File([blob], sourceName, {
				type: blob.type || "image/jpeg",
			})
			const normalized = await normalizeImageForSlot(
				imageFile,
				NORMALIZED_IMAGE_MAX_DIM,
				NORMALIZED_IMAGE_MAX_DIM,
			)
			const token = await mediaTokenFromBuffer(
				await normalized.arrayBuffer(),
			)
			if (editorUploadCache.has(token)) {
				const cached = editorUploadCache.get(token)
				editorUploadCache.set(resolvedSourceUrl, cached)
				if (sourceUrl && sourceUrl !== resolvedSourceUrl) {
					editorUploadCache.set(sourceUrl, cached)
				}
				return cached
			}
			const uploaded = await cacheMediaUrlInBsky(token, normalized)
			console.log("[profile] image uploaded to bsky", {
				sourceUrl: resolvedSourceUrl,
				bskyUrl: uploaded?.bskyUrl || "",
				cached: Boolean(uploaded?.cached),
			})
			const result = {
				...uploaded,
				sourceUrl: token,
				alt: uploaded.alt || sourceName,
			}
			editorUploadCache.set(token, result)
			editorUploadCache.set(resolvedSourceUrl, result)
			if (sourceUrl && sourceUrl !== resolvedSourceUrl) {
				editorUploadCache.set(sourceUrl, result)
			}
			return result
		}

		const videoRes = await fetch(resolvedSourceUrl)
		if (!videoRes.ok) {
			throw new Error(`Unable to fetch video URL: ${resolvedSourceUrl}`)
		}
		const videoBlob = await videoRes.blob()
		const sourceName = resolvedSourceUrl.split("/").pop() || "video.mp4"
		const videoFile = new File([videoBlob], sourceName, {
			type: videoBlob.type || "video/mp4",
		})
		const uploaded = await uploadMediaFile(videoFile)
		console.log("[profile] video uploaded to bsky", {
			sourceUrl: resolvedSourceUrl,
			bskyUrl: uploaded?.bskyUrl || "",
		})
		return {
			...uploaded,
			sourceUrl: resolvedSourceUrl,
			alt: uploaded.alt || sourceName,
		}
	}

	async function normalizeEditorMediaHtml(html = "") {
		const source = String(html || "")
		if (!source.trim()) {
			mediaUploadTotal = 0
			mediaUploadCompleted = 0
			mediaUploadActive = false
			editorMediaList = []
			return source
		}
		if (typeof document === "undefined") return source
		console.log("[profile] normalizeEditorMediaHtml:start", {
			sourceLength: source.length,
		})

		const root = document.createElement("div")
		root.innerHTML = source
		let changed = convertPlainUrlsToAnchors(root)
		changed = materializeInlineMediaFromLinks(root) || changed
		changed = normalizeThirdPartyMediaUrlsInRoot(root) || changed
		changed = proxyExternalImageUrlsInRoot(root) || changed

		const candidates = []
		for (const node of root.querySelectorAll(
			"img[src],video[src],source[src],a[href]",
		)) {
			const url =
				node.getAttribute("src") || node.getAttribute("href") || ""
			if (!url) continue
			const tag = node.tagName
			const mediaType =
				tag === "IMG"
					? "image"
					: tag === "VIDEO"
						? "video"
						: tag === "SOURCE"
							? String(node.getAttribute("type") || "")
									.toLowerCase()
									.startsWith("image/")
								? "image"
								: "video"
							: isLikelyImageUrl(url)
								? "image"
								: isLikelyVideoUrl(url)
									? "video"
									: ""
			if (!mediaType) continue
			candidates.push({node, url, mediaType})
		}
		console.log("[profile] normalizeEditorMediaHtml:candidates", {
			candidateCount: candidates.length,
		})

		const uploadedByUrl = new Map()

		if (!ENABLE_EDITOR_MEDIA_UPLOADS) {
			mediaUploadTotal = 0
			mediaUploadCompleted = 0
			mediaUploadActive = false
			console.log("[profile] editor media uploads paused", {
				candidateCount: candidates.length,
			})
		} else {
			// Remove any nodes whose CDN URL is confirmed broken (blob evicted from Bluesky)
			for (const entry of candidates) {
				if (!failedCdnUrls.has(entry.url)) continue
				const el = entry.node
				const container = el.closest("figure,p,div") || el.parentElement
				if (container && container !== root) {
					container.remove()
				} else {
					el.remove()
				}
				changed = true
			}
			// Clear failed set so we don't re-run for the same URLs
			if (failedCdnUrls.size > 0) failedCdnUrls = new Set()

			const uniqueUploadEntries = []
			const seenUploadUrls = new Set()
			for (const entry of candidates) {
				if (seenUploadUrls.has(entry.url)) continue
				seenUploadUrls.add(entry.url)
				if (isBskyHostedUrl(entry.url)) continue
				uniqueUploadEntries.push(entry)
			}

			mediaUploadTotal = uniqueUploadEntries.length
			mediaUploadCompleted = 0
			mediaUploadActive = uniqueUploadEntries.length > 0

			const workers = Array.from(
				{
					length: Math.min(
						MEDIA_UPLOAD_CONCURRENCY,
						uniqueUploadEntries.length,
					),
				},
				() =>
					(async () => {
						while (uniqueUploadEntries.length > 0) {
							const entry = uniqueUploadEntries.shift()
							if (!entry) return
							try {
								const uploaded = await uploadExternalMediaUrl(
									entry.url,
									entry.mediaType,
								)
								if (uploaded) {
									console.log(
										"[profile] normalizeEditorMediaHtml:uploaded",
										{
											url: entry.url,
											mediaType: entry.mediaType,
											hasBskyUrl: Boolean(
												uploaded.bskyUrl,
											),
										},
									)
									uploadedByUrl.set(entry.url, uploaded)
									if (uploaded.bskyUrl) {
										uploadedByUrl.set(
											uploaded.bskyUrl,
											uploaded,
										)
									}
								}
							} catch (error) {
								console.warn(
									"[profile] editor media upload failed",
									{
										url: entry.url,
										error: error?.message || String(error),
									},
								)
							} finally {
								mediaUploadCompleted += 1
							}
						}
					})(),
			)
			await Promise.all(workers)
			mediaUploadActive = false
		}

		for (const entry of candidates) {
			const uploaded = uploadedByUrl.get(entry.url)
			if (!uploaded?.bskyUrl) continue
			if (!isInlineMediaDataUrl(entry.url)) continue
			if (uploaded.bskyUrl === entry.url) continue
			if (entry.node.tagName === "A") {
				if (entry.node.getAttribute("href") !== uploaded.bskyUrl) {
					entry.node.setAttribute("href", uploaded.bskyUrl)
					changed = true
				}
				continue
			}
			if (entry.node.getAttribute("src") !== uploaded.bskyUrl) {
				entry.node.setAttribute("src", uploaded.bskyUrl)
				changed = true
			}
		}

		const pendingPromotionCount = candidates.filter((entry) => {
			const uploaded = uploadedByUrl.get(entry.url)
			if (isInlineMediaDataUrl(entry.url)) return false
			return Boolean(uploaded?.bskyUrl)
		}).length
		console.log("[profile] normalizeEditorMediaHtml:replacement", {
			uploadedCount: uploadedByUrl.size,
			pendingPromotionCount,
			changed,
		})

		const extractedMedia = []
		const existingMediaByUrl = new Map()
		for (const entry of editorMediaList) {
			if (!entry || typeof entry !== "object") continue
			const entryUrl = String(entry.url || "").trim()
			const entrySourceUrl = String(entry.sourceUrl || "").trim()
			if (entryUrl) existingMediaByUrl.set(entryUrl, entry)
			if (entrySourceUrl) existingMediaByUrl.set(entrySourceUrl, entry)
		}
		for (const node of root.querySelectorAll(
			"img[src],video[src],source[src],a[href]",
		)) {
			const url =
				node.getAttribute("src") || node.getAttribute("href") || ""
			if (!url) continue
			const tag = node.tagName
			const mediaType =
				tag === "IMG"
					? "image"
					: tag === "VIDEO"
						? "video"
						: tag === "SOURCE"
							? String(node.getAttribute("type") || "")
									.toLowerCase()
									.startsWith("image/")
								? "image"
								: "video"
							: isLikelyImageUrl(url)
								? "image"
								: isLikelyVideoUrl(url)
									? "video"
									: ""
			if (!mediaType) continue
			const uploaded = uploadedByUrl.get(url)
			const existing = existingMediaByUrl.get(url)
			extractedMedia.push({
				kind: mediaType,
				alt:
					node.getAttribute("alt") ||
					node.getAttribute("title") ||
					existing?.alt ||
					uploaded?.alt ||
					"Media",
				sourceUrl: uploaded?.sourceUrl || existing?.sourceUrl || url,
				url,
				blob: uploaded?.blob || existing?.blob || null,
				bskyUrl:
					uploaded?.bskyUrl ||
					existing?.bskyUrl ||
					(isBskyHostedUrl(url) ? url : ""),
			})
		}
		editorMediaList = extractedMedia
		if (ENABLE_EDITOR_MEDIA_UPLOADS) {
			queueMicrotask(() => {
				maybePromoteCdnUrls().catch((error) => {
					console.warn("[profile] CDN promotion pass failed", {
						error: error?.message || String(error),
					})
				})
			})
		}
		console.log("[profile] normalizeEditorMediaHtml:done", {
			extractedCount: extractedMedia.length,
			visibleImageCount: root.querySelectorAll("img[src]").length,
			visibleVideoCount: root.querySelectorAll(
				"video[src],video source[src]",
			).length,
			resultLength: changed ? root.innerHTML.length : source.length,
		})

		return changed ? root.innerHTML : source
	}

	const contentChunks = $derived(
		minifiedChunkEntries.map((entry) => entry.htmlFragment),
	)

	const combinedCharCount = $derived(
		profileName.length + profileDescription.length,
	)
	const descMaxLength = $derived(Math.max(0, 300 - profileName.length))

	const uploadedProfileImage = $derived(
		profileUploadedMedia.find((entry) => entry?.kind === "image") || null,
	)

	const uploadedBackgroundImage = $derived(
		backgroundUploadedMedia.find((entry) => entry?.kind === "image") ||
			null,
	)

	const nameError = $derived(!profileName.trim() ? "Name is required." : "")

	const emailError = $derived(
		!email.trim()
			? "Email is required."
			: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
				? "Enter a valid email address."
				: "",
	)

	const profileImageError = $derived(
		!uploadedProfileImage ? "Profile picture is required." : "",
	)

	const unresolvedEditorMediaCount = $derived(
		!ENABLE_EDITOR_MEDIA_UPLOADS
			? 0
			: editorMediaList.filter((entry) => {
					if (
						!entry ||
						(entry.kind !== "image" && entry.kind !== "video")
					) {
						return false
					}
					if (entry.blob) return false
					const url = String(entry.bskyUrl || entry.url || "")
					return !isBskyHostedUrl(url)
				}).length,
	)

	const mediaUploadPercent = $derived(
		mediaUploadTotal > 0
			? Math.max(
					0,
					Math.min(
						100,
						Math.round(
							(mediaUploadCompleted / mediaUploadTotal) * 100,
						),
					),
				)
			: 0,
	)

	const mediaUploadLabel = $derived(
		!ENABLE_EDITOR_MEDIA_UPLOADS
			? "Media upload to Bluesky is paused (paste rendering debug mode)."
			: mediaUploadActive
				? `Uploading media to Bluesky (${mediaUploadCompleted}/${mediaUploadTotal})`
				: unresolvedEditorMediaCount > 0
					? `${unresolvedEditorMediaCount} media item${unresolvedEditorMediaCount === 1 ? "" : "s"} still not on Bluesky`
					: "",
	)

	const publishBlockedByMedia = $derived(
		mediaUploadActive || unresolvedEditorMediaCount > 0,
	)

	function encryptEmailForPayload(value = "") {
		const normalized = normalizeContactInput(value)
		if (!normalized) return ""
		return CONTACT_LOCK_PREFIX + encryptContact(normalized)
	}

	const primaryPostPayload = $derived({
		uuid,
		version: primaryVersion,
		email: encryptEmailForPayload(email),
		profilePic: uploadedProfileImage?.blob || null,
		backgroundPic: uploadedBackgroundImage?.blob || null,
		name: profileName,
		description: profileDescription,
	})

	const subsequentPostsPayload = $derived(
		minifiedChunkEntries.map((entry, index) => ({
			uuid,
			version: priorVersion,
			index: index + 1,
			total: minifiedChunkEntries.length,
			htmlFragment: entry.htmlFragment,
			postBody: entry.postBody,
			forceCompression: Boolean(entry.forceCompression),
		})),
	)

	function mapSubsequentPayloadForBundle(entries = []) {
		return entries.map((entry) => ({
			index: entry.index,
			total: entry.total,
			htmlFragment: entry.htmlFragment,
			postBody: entry.postBody,
		}))
	}

	const subsequentPayloadForBundlePreview = $derived(
		mapSubsequentPayloadForBundle(subsequentPostsPayload),
	)

	const combinedPayloadBundlePreview = $derived(
		buildCombinedPayloadBundle(
			primaryPostPayload,
			subsequentPayloadForBundlePreview,
		),
	)

	const combinedPayloadPostsEstimate = $derived(
		Math.max(
			1,
			Math.ceil(combinedPayloadBundlePreview.fragments.length / 4),
		),
	)

	function normalizeStoredMedia(value) {
		if (!Array.isArray(value)) return []
		return value
			.filter((entry) => entry && typeof entry === "object")
			.map((entry) => ({
				...entry,
				kind:
					entry.kind === "video" || entry.kind === "image"
						? entry.kind
						: "image",
			}))
			.filter((entry) => {
				const blob = entry?.blob
				return Boolean(
					blob &&
						(typeof blob === "object" || typeof blob === "string"),
				)
			})
	}

	function cloneStoredProfile(value) {
		return JSON.parse(JSON.stringify(value))
	}

	function buildStoredProfile() {
		return {
			uuid,
			primaryVersion,
			priorVersion,
			email,
			profileName,
			profileDescription,
			contentHtml,
			profileUploadedMedia,
			backgroundUploadedMedia,
			editorMediaList,
		}
	}

	function isInlineMediaDataUrl(value = "") {
		return /^data:(image|video)\//i.test(String(value || "").trim())
	}

	function stripInlineMediaDataUrlsFromHtml(html = "") {
		const source = String(html || "")
		if (!source.trim()) return source
		if (typeof document === "undefined") {
			return source.replace(
				/\b(src|href|poster)=(["'])data:(image|video)\/[^"']*\2/gi,
				(_match, attr, quote) => `${attr}=${quote}${quote}`,
			)
		}

		const root = document.createElement("div")
		root.innerHTML = source
		for (const node of root.querySelectorAll("[src],[href],[poster]")) {
			for (const attr of ["src", "href", "poster"]) {
				const value = String(node.getAttribute(attr) || "")
				if (!isInlineMediaDataUrl(value)) continue
				node.setAttribute(attr, "")
			}
		}
		return root.innerHTML
	}

	function buildStoredProfileForStorage() {
		const base = buildStoredProfile()
		return {
			...base,
			contentHtml: stripInlineMediaDataUrlsFromHtml(base.contentHtml),
			editorMediaList: Array.isArray(base.editorMediaList)
				? base.editorMediaList.map((entry) => {
						if (!entry || typeof entry !== "object") return entry
						const next = {...entry}
						for (const field of ["url", "sourceUrl", "bskyUrl"]) {
							if (isInlineMediaDataUrl(next[field]))
								next[field] = ""
						}
						return next
					})
				: [],
		}
	}

	function getDraftSaveWarning() {
		const html = String(contentHtml || "")
		if (html.length <= EDITOR_MAX_HTML_CHARS) return ""
		const hasDataUrl = /data:(image|video)\//i.test(html)
		if (hasDataUrl) {
			return "Draft is temporarily too large to save while embedded media data URLs are present. It will save automatically after uploads replace them with Bluesky URLs."
		}
		return `Draft is too large to save (${html.length.toLocaleString()} chars, limit ${EDITOR_MAX_HTML_CHARS.toLocaleString()}).`
	}

	function applyStoredProfile(profile = {}) {
		uuid = String(profile.uuid || "") || generateShortUuid()
		primaryVersion = String(profile.primaryVersion || "") || makeVersion()
		priorVersion =
			String(profile.priorVersion || profile.subsequentVersion || "") ||
			primaryVersion
		email = String(profile.email || "")
		profileName = String(profile.profileName || "")
		profileDescription = String(profile.profileDescription || "")
		contentHtml = String(profile.contentHtml || "")
		profileUploadedMedia = normalizeStoredMedia(
			profile.profileUploadedMedia,
		)
		backgroundUploadedMedia = normalizeStoredMedia(
			profile.backgroundUploadedMedia,
		)
		editorMediaList = Array.isArray(profile.editorMediaList)
			? profile.editorMediaList.filter(
					(entry) => entry && typeof entry === "object",
				)
			: []
	}

	function validateRequiredFields() {
		console.log("[profile] validateRequiredFields", {
			hasName: Boolean(profileName.trim()),
			hasEmail: Boolean(email.trim()),
			hasProfileImage: Boolean(uploadedProfileImage),
			nameError,
			emailError,
			profileImageError,
		})
		return nameError || emailError || profileImageError || null
	}

	function activateValidation() {
		console.log("[profile] activateValidation")
		validationActive = true
	}

	function handleFieldBlur(field) {
		console.log("[profile] handleFieldBlur", {field})
		activateValidation()
		if (field === "name") touchedName = true
		if (field === "email") touchedEmail = true
	}

	function focusFirstInvalidField() {
		console.log("[profile] focusFirstInvalidField", {
			profileImageError,
			nameError,
			emailError,
		})
		if (profileImageError) {
			console.log("[profile] focusing profile image section")
			profileImageWrapEl?.focus()
			profileImageWrapEl?.scrollIntoView({
				behavior: "smooth",
				block: "nearest",
			})
			return
		}
		if (nameError) {
			console.log("[profile] focusing name input")
			profileNameInputEl?.focus()
			return
		}
		if (emailError) {
			console.log("[profile] focusing email input")
			emailInputEl?.focus()
		}
	}

	function clampPostTextForApi(text = "", maxChars = 300) {
		const normalized = String(text || "")
			.replace(/\r\n?/g, "\n")
			.trim()
		let result = ""
		let count = 0
		for (const char of normalized) {
			// Multipart/form-data can normalize newlines to CRLF, so reserve 2 chars for line breaks.
			const nextCount = count + (char === "\n" ? 2 : 1)
			if (nextCount > maxChars) break
			result += char
			count = nextCount
		}
		return result
	}

	function buildCombinedPayloadBundle(
		primaryPayload = {},
		subsequentPayload = [],
	) {
		const combinedJson = JSON.stringify({
			primary: primaryPayload,
			subsequent: subsequentPayload,
		})
		const forceCompression = true
		const limited = enforceAltPayloadLimit(
			[combinedJson],
			CHUNK_ALT_PAYLOAD_TARGET_CHARS,
			{
				uuid: String(primaryPayload?.uuid || uuid || ""),
				version: String(primaryPayload?.version || priorVersion || ""),
				forceCompression,
			},
		)
		const fragments = coalesceAltPayloadChunks(
			limited,
			CHUNK_ALT_PAYLOAD_TARGET_CHARS,
			{
				uuid: String(primaryPayload?.uuid || uuid || ""),
				version: String(primaryPayload?.version || priorVersion || ""),
				forceCompression,
			},
		)
		return {
			combinedJson,
			forceCompression,
			fragments,
		}
	}

	async function publishToBluesky() {
		console.log("[profile] publishToBluesky:start", {
			uuid,
			primaryVersion,
			priorVersion,
			chunkCount: minifiedChunkEntries.length,
			editorMediaCount: editorMediaList.length,
		})
		activateValidation()
		if (publishBlockedByMedia) {
			publishError =
				mediaUploadLabel ||
				"Please wait for media uploads to finish before publishing."
			publishMessage = ""
			return
		}
		touchedName = true
		touchedEmail = true
		const validationError = validateRequiredFields()
		if (validationError) {
			console.warn("[profile] publish blocked by validation", {
				validationError,
				nameError,
				emailError,
				profileImageError,
			})
			publishError = validationError
			publishMessage = ""
			focusFirstInvalidField()
			return
		}
		console.log("[profile] publish validation passed")
		publishError = ""
		publishMessage = ""
		publishing = true

		try {
			console.log("[profile] saving draft before publish")
			saveProfile(false)

			const subsequentPayloadForBundle = mapSubsequentPayloadForBundle(
				subsequentPostsPayload,
			)
			const primaryPayloadForBundle = {
				uuid,
				version: primaryVersion,
				email: encryptEmailForPayload(email),
				profilePic: uploadedProfileImage?.blob || null,
				backgroundPic: uploadedBackgroundImage?.blob || null,
				name: profileName,
				description: profileDescription,
			}
			const combinedBundle = buildCombinedPayloadBundle(
				primaryPayloadForBundle,
				subsequentPayloadForBundle,
			)
			const chunks = combinedBundle.fragments.map(
				(fragment, index, all) => ({
					index: index + 1,
					total: all.length,
					bundleFragment: fragment,
					forceCompression: combinedBundle.forceCompression,
				}),
			)

			// Build post text: name + description (≤300 chars enforced by the form)
			const postText = clampPostTextForApi(
				[profileName.trim(), profileDescription.trim()]
					.filter(Boolean)
					.join("\n"),
			)
			console.log("[profile] primary post text prepared", {
				textLength: [...postText].length,
				textPreview: postText.slice(0, 80),
			})

			const primaryMedia = []
			if (uploadedProfileImage?.blob) {
				primaryMedia.push({
					...uploadedProfileImage,
					kind: "image",
					alt: String(uploadedProfileImage.alt || "Profile image"),
				})
			}
			if (uploadedBackgroundImage?.blob) {
				primaryMedia.push({
					...uploadedBackgroundImage,
					kind: "image",
					alt: String(
						uploadedBackgroundImage.alt || "Profile background",
					),
				})
			}

			const imageAttachments = editorMediaList
				.filter((entry) => entry?.kind === "image" && entry?.blob)
				.map((entry) => ({
					kind: "image",
					alt: String(entry.alt || "Image"),
					blob: entry.blob,
				}))
			const videoAttachments = editorMediaList
				.filter((entry) => entry?.kind === "video" && entry?.blob)
				.slice(0, 1)
				.map((entry) => ({
					kind: "video",
					alt: String(entry.alt || "Video"),
					blob: entry.blob,
				}))
			const fallbackImage = uploadedProfileImage
				? [
						{
							kind: "image",
							alt: String(
								uploadedProfileImage.alt || "Profile image",
							),
							blob: uploadedProfileImage.blob,
						},
					]
				: []
			const attachmentPool =
				imageAttachments.length > 0
					? imageAttachments
					: primaryMedia.length > 0
						? primaryMedia
						: fallbackImage

			const primaryMediaForPost = primaryMedia.map((entry) => ({
				...entry,
			}))
			const primaryChunkCapacity = Math.min(4, chunks.length)
			const primaryChunks = chunks.slice(0, primaryChunkCapacity)
			if (primaryChunks.length > 0) {
				if (primaryMediaForPost.length === 0) {
					publishError =
						"Unable to attach payload chunks on the primary post: at least one profile/background image is required."
					return
				}
				const primaryCarrierSeed = primaryMediaForPost.map((entry) => ({
					...entry,
				}))
				while (primaryMediaForPost.length < primaryChunks.length) {
					const seed =
						primaryCarrierSeed[
							primaryMediaForPost.length %
								primaryCarrierSeed.length
						]
					primaryMediaForPost.push({...seed})
				}
				for (let i = 0; i < primaryChunks.length; i += 1) {
					const chunkEntry = primaryChunks[i]
					const meta = {
						uuid,
						version: priorVersion,
						index: chunkEntry.index,
						total: chunks.length,
					}
					const altPayload = buildChunkAltPayload(
						meta,
						chunkEntry?.bundleFragment || "",
						{
							forceCompression: Boolean(
								chunkEntry?.forceCompression,
							),
						},
					)
					primaryMediaForPost[i] = {
						...primaryMediaForPost[i],
						alt: JSON.stringify(altPayload),
					}
				}
			}
			console.log("[profile] primary media prepared", {
				mediaCount: primaryMediaForPost.length,
				kinds: primaryMediaForPost.map(
					(entry) => entry?.kind || "unknown",
				),
				primaryChunkCapacity,
				primaryChunkUsed: primaryChunks.length,
				remainingChunkCount: Math.max(
					0,
					chunks.length - primaryChunks.length,
				),
			})

			const chunkDiagnostics = chunks.map((entry, index) => ({
				index: index + 1,
				bundleFragmentLength: String(entry?.bundleFragment || "")
					.length,
				payloadLength: measureChunkAltPayloadLength(
					entry?.bundleFragment || "",
					{
						uuid,
						version: priorVersion,
						index: index + 1,
						total: chunks.length,
						forceCompression: Boolean(entry?.forceCompression),
					},
				),
			}))
			console.log("[profile] chunk diagnostics", chunkDiagnostics)

			const primaryFd = new FormData()
			primaryFd.append("text", postText)
			if (primaryMediaForPost.length) {
				primaryFd.append(
					"uploadedMedia",
					JSON.stringify(primaryMediaForPost),
				)
			}
			console.log("[profile] posting primary profile to /api/post", {
				hasUploadedMedia: primaryMediaForPost.length > 0,
			})

			const primaryRes = await fetch("/api/post", {
				method: "POST",
				body: primaryFd,
			})
			const primaryJson = await primaryRes.json().catch(() => ({}))
			console.log("[profile] primary publish response", {
				status: primaryRes.status,
				ok: primaryRes.ok,
				json: primaryJson,
			})
			if (!primaryRes.ok || !primaryJson?.ok) {
				console.error("[profile] primary publish failed", {
					status: primaryRes.status,
					json: primaryJson,
				})
				publishError =
					primaryJson?.error ||
					"Failed to publish primary profile post."
				return
			}

			const primaryUri = primaryJson?.result?.uri || ""
			const primaryCid = primaryJson?.result?.cid || ""
			const replyRef =
				primaryUri && primaryCid
					? JSON.stringify({
							root: {uri: primaryUri, cid: primaryCid},
							parent: {uri: primaryUri, cid: primaryCid},
						})
					: null
			console.log("[profile] primary post ref for replies", {
				primaryUri,
				primaryCid,
				hasReplyRef: Boolean(replyRef),
			})

			if (videoAttachments.length > 0) {
				const videoFd = new FormData()
				videoFd.append("text", "Video")
				videoFd.append(
					"uploadedMedia",
					JSON.stringify([videoAttachments[0]]),
				)
				if (replyRef) {
					videoFd.append("reply", replyRef)
				}
				console.log("[profile] posting video reply", {
					hasReplyRef: Boolean(replyRef),
					alt: videoAttachments[0]?.alt || "Video",
				})
				const videoRes = await fetch("/api/post", {
					method: "POST",
					body: videoFd,
				})
				const videoJson = await videoRes.json().catch(() => ({}))
				if (!videoRes.ok || !videoJson?.ok) {
					console.error("[profile] video publish failed", {
						status: videoRes.status,
						videoJson,
					})
					publishError =
						videoJson?.error ||
						"Failed to publish video attachment post."
					return
				}
			}

			const chunksForReplies = chunks.slice(primaryChunks.length)
			const replyAttachmentPool = attachmentPool
			const chunkTotal = chunksForReplies.length
			const chunkGroups = []
			for (let i = 0; i < chunkTotal; i += 4) {
				chunkGroups.push(chunksForReplies.slice(i, i + 4))
			}
			const attachmentTotal = replyAttachmentPool.length
			const totalPosts = chunkGroups.length
			console.log("[profile] chunk publish plan", {
				chunkTotal,
				chunkGroupCount: chunkGroups.length,
				attachmentTotal,
				totalPosts,
				hasFallbackImage: fallbackImage.length > 0,
				hasVideoAttachment: videoAttachments.length > 0,
				primaryChunkUsed: primaryChunks.length,
			})

			for (let i = 0; i < totalPosts; i += 1) {
				const chunkGroup = chunkGroups[i] || []
				const text = `Payload ${i + 1}/${totalPosts}`

				const mediaForPost = []
				if (replyAttachmentPool.length > 0) {
					for (let j = 0; j < chunkGroup.length; j += 1) {
						const chunkEntry = chunkGroup[j]
						const meta = {
							uuid,
							version: priorVersion,
							index: chunkEntry.index,
							total: chunks.length,
						}
						const attachment =
							replyAttachmentPool[
								(chunkEntry.index - 1) %
									replyAttachmentPool.length
							]
						const chunkAltPayload = buildChunkAltPayload(
							meta,
							chunkEntry?.bundleFragment || "",
							{
								forceCompression: Boolean(
									chunkEntry?.forceCompression,
								),
							},
						)
						mediaForPost.push({
							...attachment,
							alt: JSON.stringify(chunkAltPayload),
						})
					}
				} else if (
					videoAttachments.length > 0 &&
					chunkGroup.length === 1
				) {
					const chunkEntry = chunkGroup[0]
					const meta = {
						uuid,
						version: priorVersion,
						index: chunkEntry.index,
						total: chunks.length,
					}
					mediaForPost.push({
						...videoAttachments[0],
						alt: JSON.stringify(
							buildChunkAltPayload(
								meta,
								chunkEntry?.bundleFragment || "",
								{
									forceCompression: Boolean(
										chunkEntry?.forceCompression,
									),
								},
							),
						),
					})
				}
				if (!mediaForPost.length && chunkGroup.length > 0) {
					publishError =
						"Unable to attach payload chunks: add at least one image carrier (profile, background, or editor image)."
					return
				}

				const chunkFd = new FormData()
				chunkFd.append("text", text)
				if (mediaForPost.length > 0) {
					chunkFd.append(
						"uploadedMedia",
						JSON.stringify(mediaForPost),
					)
				}
				if (replyRef) {
					chunkFd.append("reply", replyRef)
				}

				console.log("[profile] posting chunk", {
					index: i + 1,
					total: totalPosts,
					chunkCountInPost: chunkGroup.length,
					textPreview: text.slice(0, 80),
					mediaKinds: mediaForPost.map((entry) => entry.kind),
				})
				const chunkRes = await fetch("/api/post", {
					method: "POST",
					body: chunkFd,
				})
				const chunkJson = await chunkRes.json().catch(() => ({}))
				if (!chunkRes.ok || !chunkJson?.ok) {
					console.error("[profile] chunk publish failed", {
						index: i + 1,
						status: chunkRes.status,
						chunkJson,
					})
					publishError =
						chunkJson?.error ||
						`Failed to publish chunk ${i + 1} of ${totalPosts}.`
					return
				}
			}

			publishMessage = `Published profile + ${totalPosts} chunk${totalPosts === 1 ? "" : "s"} at ${new Date().toLocaleTimeString()}`
			console.log("[profile] publishToBluesky:success", {
				message: publishMessage,
			})
		} catch (err) {
			console.error("[profile] publishToBluesky:exception", err)
			publishError = err?.message || "Unexpected error while publishing."
		} finally {
			console.log("[profile] publishToBluesky:finally", {
				publishingBeforeReset: publishing,
			})
			publishing = false
		}
	}

	function saveProfile(showMessage = true) {
		console.log("[profile] saveProfile", {showMessage})
		if (typeof localStorage === "undefined") return
		const warning = getDraftSaveWarning()
		if (warning) {
			saveWarning = warning
			if (showMessage) saveMessage = ""
			console.warn("[profile] saveProfile skipped", {
				reason: warning,
			})
			return
		}
		saveWarning = ""
		const snapshot = JSON.stringify(buildStoredProfileForStorage())
		lastAutosaveSnapshot = snapshot
		localStorage.setItem(PROFILE_STORAGE_KEY, snapshot)
		if (showMessage) {
			saveMessage = `Saved at ${new Date().toLocaleTimeString()}`
		}
	}

	function bumpPrimaryVersion() {
		primaryVersion = makeVersion()
	}

	function setPriorVersionFromPrimary() {
		priorVersion = ""
	}

	function clearProfileDraft() {
		console.log("[profile] clearProfileDraft:start")
		if (
			typeof window !== "undefined" &&
			!window.confirm("Clear all profile draft fields?")
		) {
			console.log("[profile] clearProfileDraft:cancelled")
			return
		}

		suppressAutosave = true
		uuid = generateShortUuid()
		primaryVersion = makeVersion()
		priorVersion = ""
		email = ""
		profileName = ""
		profileDescription = ""
		contentHtml = ""
		profileUploadedMedia = []
		backgroundUploadedMedia = []
		editorMediaList = []
		minifiedChunkEntries = []
		uploadError = ""
		saveMessage = ""
		publishMessage = ""
		publishError = ""
		touchedName = false
		touchedEmail = false
		validationActive = false
		suppressAutosave = false
		saveProfile(false)
		console.log("[profile] clearProfileDraft:done")
	}

	function cancelProfileEdit() {
		if (initialProfileSnapshot) {
			suppressAutosave = true
			applyStoredProfile(initialProfileSnapshot)
			saveProfile(false)
			suppressAutosave = false
		}
		saveMessage = ""
		publishMessage = ""
		publishError = ""
		touchedName = false
		touchedEmail = false
		validationActive = false
		uploadError = ""
		if (typeof window !== "undefined") {
			if (window.history.length > 1) {
				window.history.back()
				return
			}
			window.location.href = "/"
		}
	}

	onMount(() => {
		console.log("[profile] onMount:start")
		const intervalId = ENABLE_EDITOR_MEDIA_UPLOADS
			? setInterval(() => {
					maybePromoteCdnUrls().catch((error) => {
						console.warn(
							"[profile] scheduled CDN promotion failed",
							{
								error: error?.message || String(error),
							},
						)
					})
				}, CDN_PROMOTION_TICK_MS)
			: null

		if (typeof localStorage === "undefined") {
			console.log("[profile] onMount:no localStorage")
			uuid = generateShortUuid()
			primaryVersion = makeVersion()
			priorVersion = primaryVersion
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
			storageReady = true
			return () => {
				if (intervalId) clearInterval(intervalId)
			}
		}

		const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
		if (!raw) {
			console.log("[profile] onMount:no stored profile")
			uuid = generateShortUuid()
			primaryVersion = makeVersion()
			priorVersion = primaryVersion
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
			storageReady = true
			saveProfile(false)
			return () => {
				if (intervalId) clearInterval(intervalId)
			}
		}

		try {
			const parsed = JSON.parse(raw)
			console.log("[profile] onMount:loaded stored profile", {
				hasUuid: Boolean(parsed?.uuid),
				hasContentHtml: Boolean(parsed?.contentHtml),
			})
			applyStoredProfile(parsed)
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
		} catch {
			console.warn("[profile] onMount:failed to parse stored profile")
			uuid = generateShortUuid()
			primaryVersion = makeVersion()
			priorVersion = primaryVersion
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
		}

		storageReady = true
		console.log("[profile] onMount:ready")
		return () => {
			if (intervalId) clearInterval(intervalId)
		}
	})

	$effect(() => {
		if (!storageReady || suppressAutosave) return
		const warning = getDraftSaveWarning()
		if (warning) {
			saveWarning = warning
			return
		}
		saveWarning = ""
		const snapshot = JSON.stringify(buildStoredProfileForStorage())
		if (snapshot === lastAutosaveSnapshot) return
		lastAutosaveSnapshot = snapshot
		console.log("[profile] autosave effect triggered")
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(PROFILE_STORAGE_KEY, snapshot)
		}
	})

	$effect(() => {
		const source = String(contentHtml || "")
		const _failedCdn = failedCdnUrls // track for re-run when CDN failures arrive
		queuedEditorMediaSource = source
		hasQueuedEditorMediaRun = true
		if (editorMediaProcessing) return
		;(async () => {
			editorMediaProcessing = true
			while (hasQueuedEditorMediaRun) {
				hasQueuedEditorMediaRun = false
				const runSource = String(queuedEditorMediaSource || "")
				const normalized = await normalizeEditorMediaHtml(runSource)
				if (normalized !== runSource) {
					console.log("[profile] editor media html normalized", {
						beforeLength: runSource.length,
						afterLength: normalized.length,
					})
					contentHtml = normalized
					queuedEditorMediaSource = normalized
				}
			}
		})()
			.catch((error) => {
				console.warn("[profile] editor media normalization failed", {
					error: error?.message || String(error),
				})
			})
			.finally(() => {
				editorMediaProcessing = false
			})
	})

	$effect(() => {
		const source = String(contentHtml || "")
		const currentBuild = ++chunkBuildVersion
		console.log("[profile] chunk effect:start", {
			currentBuild,
			sourceLength: source.length,
		})
		;(async () => {
			const minifiedHtml = await minifyHtmlForChunking(source)
			if (currentBuild !== chunkBuildVersion) return
			const forceCompression = true
			const fragments = chunkHtmlByAltPayload(
				minifiedHtml,
				CHUNK_ALT_PAYLOAD_TARGET_CHARS,
				{uuid, version: priorVersion, forceCompression},
			)
			const payloadLengths = fragments.map((htmlFragment, index) =>
				measureChunkAltPayloadLength(htmlFragment, {
					uuid,
					version: priorVersion,
					index: index + 1,
					total: fragments.length,
					forceCompression,
				}),
			)
			minifiedChunkEntries = fragments.map((htmlFragment) => ({
				htmlFragment,
				forceCompression,
				postBody: extractChunkBodyText(
					htmlFragment,
					CHUNK_BODY_TEXT_SIZE,
				),
			}))
			console.log("[profile] chunk effect:success", {
				currentBuild,
				forceCompression,
				fragmentCount: fragments.length,
				fragmentLengths: fragments.map((chunk) => chunk.length),
				payloadLengths,
			})
		})().catch(() => {
			if (currentBuild !== chunkBuildVersion) return
			const forceCompression = true
			const fragments = chunkHtmlByAltPayload(
				source,
				CHUNK_ALT_PAYLOAD_TARGET_CHARS,
				{uuid, version: priorVersion, forceCompression},
			)
			const payloadLengths = fragments.map((htmlFragment, index) =>
				measureChunkAltPayloadLength(htmlFragment, {
					uuid,
					version: priorVersion,
					index: index + 1,
					total: fragments.length,
					forceCompression,
				}),
			)
			minifiedChunkEntries = fragments.map((htmlFragment) => ({
				htmlFragment,
				forceCompression,
				postBody: extractChunkBodyText(
					htmlFragment,
					CHUNK_BODY_TEXT_SIZE,
				),
			}))
			console.warn("[profile] chunk effect:fallback", {
				currentBuild,
				forceCompression,
				fragmentCount: fragments.length,
				fragmentLengths: fragments.map((chunk) => chunk.length),
				payloadLengths,
			})
		})
	})
</script>

<svelte:head>
	<title>Profile | Love4Dogs</title>
</svelte:head>

<main class="page">
	<header class="topline">
		<a class="back" href="/">&lt; Back home</a>
		<h1>Profile</h1>
	</header>

	<section class="panel ids">
		<div>
			<p class="label">Short UUID</p>
			<p class="mono">{uuid}</p>
		</div>
		<div class="version-group">
			<div>
				<p class="label">Primary version</p>
				<p class="mono">{primaryVersion}</p>
			</div>
			<button type="button" onclick={bumpPrimaryVersion}>Bump</button>
		</div>
		<div class="version-group">
			<div>
				<p class="label">Prior version</p>
				<p class="mono">{priorVersion}</p>
			</div>
			<button type="button" onclick={setPriorVersionFromPrimary}
				>Use current</button
			>
		</div>
	</section>

	<section class="panel">
		<div
			bind:this={profileImageWrapEl}
			class="profile-image-wrap"
			class:invalid-profile-image={validationActive &&
				!!profileImageError}
			tabindex="-1"
		>
			<ProfileImages
				bind:profileUploadedMedia
				bind:backgroundUploadedMedia
				bind:errorMessage={uploadError}
				onchange={activateValidation}
				disabled={false}
			/>
		</div>
		{#if validationActive && profileImageError}
			<p class="field-error profile-image-error">{profileImageError}</p>
		{/if}

		<label>
			<input
				bind:this={profileNameInputEl}
				type="text"
				bind:value={profileName}
				onblur={() => handleFieldBlur("name")}
				class:invalid-field={touchedName && !!nameError}
				placeholder="Name"
				maxlength={100}
				style="font-size: 1.25rem; font-weight: 600;"
			/>
		</label>
		{#if touchedName && nameError}
			<p class="field-error">{nameError}</p>
		{/if}
		<label>
			<textarea
				rows="4"
				bind:value={profileDescription}
				placeholder="Short profile description"
				maxlength={descMaxLength}
				style="min-height: 100px; resize: vertical;"
			></textarea>
		</label>
		<p class="char-count">{300 - combinedCharCount}/{descMaxLength}</p>
		<div class="editor-wrap">
			<Editor
				bind:value={contentHtml}
				bind:uploadedMedia={editorMediaList}
				placeholder="Write formatted profile content..."
				uploadProgressActive={mediaUploadActive}
				uploadProgressPercent={mediaUploadPercent}
				uploadProgressLabel={mediaUploadLabel}
				onmediaerror={(url) => {
					if (!failedCdnUrls.has(url)) {
						failedCdnUrls = new Set([...failedCdnUrls, url])
					}
				}}
			/>
		</div>
		<label>
			<span>Private</span>
			<input
				bind:this={emailInputEl}
				type="email"
				bind:value={email}
				onblur={() => handleFieldBlur("email")}
				class:invalid-field={touchedEmail && !!emailError}
				placeholder="you@email.com"
				required
			/>
		</label>
		{#if touchedEmail && emailError}
			<p class="field-error">{emailError}</p>
		{/if}

		<div class="actions-row">
			<div aria-hidden="true"></div>
			<button
				type="button"
				class="primary"
				onclick={publishToBluesky}
				disabled={publishing || publishBlockedByMedia}
			>
				<Save size={16} aria-hidden="true" />
				<span>{publishing ? "Publishing…" : "Publish to Bluesky"}</span>
			</button>
			<div class="actions-right">
				<button type="button" onclick={saveProfile}>
					<Save size={16} aria-hidden="true" />
					<span>Save draft</span>
				</button>
				<button type="button" onclick={clearProfileDraft}>
					<Eraser size={16} aria-hidden="true" />
					<span>Clear</span>
				</button>
				<button type="button" onclick={cancelProfileEdit}>
					<X size={16} aria-hidden="true" />
					<span>Cancel</span>
				</button>
			</div>
		</div>
		{#if publishMessage}
			<p class="success">{publishMessage}</p>
		{/if}
		{#if publishError}
			<p class="warning">{publishError}</p>
		{/if}
		{#if saveMessage}
			<p class="success">{saveMessage}</p>
		{/if}
		{#if saveWarning}
			<p class="warning">{saveWarning}</p>
		{/if}
		{#if uploadError}
			<p class="warning">{uploadError}</p>
		{/if}
	</section>

	<section class="panel payloads">
		<h2>Primary Payload Preview</h2>
		<pre>{JSON.stringify(primaryPostPayload, null, 2)}</pre>
		<h2>Subsequent Payload Preview ({subsequentPostsPayload.length})</h2>
		<pre>{JSON.stringify(subsequentPostsPayload, null, 2)}</pre>
		<h2>Combined Payload Bundle Preview</h2>
		<p class="char-count">
			Combined JSON chars: {combinedPayloadBundlePreview.combinedJson
				.length}
		</p>
		<p class="char-count">
			Bundle chunks ({CHUNK_ALT_PAYLOAD_TARGET_CHARS} chars target each):
			{combinedPayloadBundlePreview.fragments.length}
		</p>
		<p class="char-count">
			Estimated Bluesky posts (up to 4 chunk-images/post):
			{combinedPayloadPostsEstimate}
		</p>
		<p class="char-count">
			Forced compression mode:
			{combinedPayloadBundlePreview.forceCompression ? "yes" : "no"}
		</p>
		<pre>{JSON.stringify(
				combinedPayloadBundlePreview.fragments,
				null,
				2,
			)}</pre>
	</section>
</main>

<style>
	.page {
		max-width: 1080px;
		margin: 0 auto;
		padding: 1rem;
		display: grid;
		gap: 0.8rem;
		min-width: 0;
	}
	.topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.back {
		text-decoration: none;
		color: #1f5135;
		font-weight: 600;
	}
	h1,
	h2 {
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		margin-bottom: 0.6rem;
	}
	.panel {
		background: rgba(255, 250, 241, 0.9);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 0.9rem;
		box-shadow: 0 8px 20px rgba(65, 42, 20, 0.1);
		min-width: 0;
		overflow-x: hidden;
	}
	.ids {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.6rem;
	}
	.version-group {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
	.label {
		margin: 0 0 0.3rem;
		font-size: 0.82rem;
		color: #51655a;
	}
	.mono {
		margin: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
			monospace;
		font-size: 0.9rem;
	}
	label {
		display: grid;
		gap: 0.3rem;
		margin-bottom: 0.55rem;
	}
	input,
	textarea {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		padding: 0.6rem 0.7rem;
		font: inherit;
	}
	textarea {
		resize: vertical;
	}
	.invalid-field {
		border-color: #b53a2b;
		box-shadow: 0 0 0 1px rgba(181, 58, 43, 0.2);
	}
	button {
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.45rem 0.8rem;
		font: inherit;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.38rem;
	}
	button.primary {
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.58;
	}
	.actions-row {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		width: 100%;
		gap: 0.6rem;
	}
	.actions-right {
		display: inline-flex;
		align-items: center;
		justify-self: end;
		gap: 0.45rem;
	}
	.profile-image-wrap {
		margin-top: 0.65rem;
	}
	.invalid-profile-image :global(.banner) {
		border-color: #b53a2b;
		box-shadow: 0 0 0 1px rgba(181, 58, 43, 0.2);
	}
	.invalid-profile-image :global(.profile-button) {
		border-color: #b53a2b;
		box-shadow:
			0 0 0 2px rgba(181, 58, 43, 0.2),
			0 10px 24px rgba(0, 0, 0, 0.16);
	}
	.editor-wrap {
		margin-top: 0.55rem;
		min-width: 0;
		width: 100%;
	}
	.char-count {
		margin: 0;
		text-align: right;
		font-size: 0.78rem;
		color: #56695f;
	}
	.field-error {
		margin: -0.2rem 0 0.4rem;
		font-size: 0.84rem;
		color: #8e2f21;
	}
	.profile-image-error {
		margin-top: 0.1rem;
	}
	.warning {
		margin: 0.35rem 0 0;
		font-size: 0.84rem;
		color: #8e2f21;
	}
	.success {
		margin: 0.4rem 0 0;
		color: #24633f;
		font-size: 0.88rem;
	}
	.payloads pre {
		margin: 0.45rem 0 0.8rem;
		padding: 0.7rem;
		background: #fffdf8;
		border: 1px solid #e4d8c9;
		border-radius: 12px;
		overflow: auto;
		font-size: 0.78rem;
		line-height: 1.42;
	}

	@media (max-width: 900px) {
		.ids {
			grid-template-columns: 1fr;
		}
		.actions-row {
			grid-template-columns: 1fr;
		}
		.actions-row > button,
		.actions-right {
			justify-self: start;
		}
	}

	/*
Source - https://stackoverflow.com/a/79793317
Posted by Debtanu Coder
Retrieved 2026-05-08, License - CC BY-SA 4.0
*/
</style>
