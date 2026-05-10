<script>
	import {onMount} from "svelte"
	import {Eraser, Save, Send, X} from "lucide-svelte"
	import Editor from "$lib/Editor.svelte"
	import NavBar from "$lib/NavBar.svelte"
	import ProfileImages from "$lib/ProfileImages.svelte"
	import LocationPicker from "$lib/LocationPicker.svelte"
	import {
		buildCanonicalUrl,
		buildLocationBlock,
		cleanCanonicalName,
		CONTACT_LOCK_PREFIX,
		encryptContact,
		normalizeContactInput,
		lookupLocationDetails,
		mediaTokenFromBuffer,
	} from "$lib/utils"
	import {
		buildCombinedPayloadBundle as buildBskyCombinedPayloadBundle,
		buildChunkEntriesFromBundle,
		chunkHtmlByAltPayload,
		measureChunkAltPayloadLength as measureBskyChunkAltPayloadLength,
		publishChunkBundleToBsky,
	} from "$lib/bskyChunkStore"
	import ShowAdmin from "$lib/ShowAdmin.svelte"

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
	const DEBUG_PROFILE = false

	let uuid = $state("")
	let primaryVersion = $state("")
	let priorVersion = $state("")

	let email = $state("")
	let profileName = $state("")
	let profileDescription = $state("")
	let contentHtml = $state("")
	let addressText = $state("")
	let locationConfirmed = $state(false)
	let confirmedAddress = $state("")
	let confirmedLocation = $state(null)
	let locationError = $state("")
	let showLocationModal = $state(false)
	let pinMovedInModal = $state(false)
	let modalLocation = $state(null)

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
	let uploadingProfileImage = $state(false)
	let uploadingBackgroundImage = $state(false)
	let currentView = $state("feed")
	let touchedName = $state(false)
	let touchedEmail = $state(false)
	let validationActive = $state(false)
	let profileImageWrapEl
	let profileNameInputEl
	let emailInputEl
	let storageReady = $state(false)
	let initialProfileSnapshot = null
	let storedSnapshotByStamp = null
	let hasChangedFromStoredSnapshot = $state(false)
	let clearSnapshot = null
	let showUndo = $state(false)
	let clearUndoTimer = null
	let suppressAutosave = false
	let lastAutosaveSnapshot = ""

	let minifiedChunkEntries = $state([])
	let chunkBuildVersion = 0
	const cdnPromotionMeta = new Map()
	const editorUploadCache = new Map()
	let failedCdnUrls = $state(new Set())

	function debugProfile(...args) {
		if (DEBUG_PROFILE) console.log(...args)
	}

	function warnProfile(...args) {
		if (DEBUG_PROFILE) console.warn(...args)
	}

	function generateShortUuid() {
		return Math.random().toString(36).slice(2, 10)
	}

	function makeVersion() {
		return Date.now().toString(36)
	}

	function measureChunkAltPayloadLength(htmlFragment = "", meta = {}) {
		return measureBskyChunkAltPayloadLength(htmlFragment, meta)
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
				debugProfile("[profile] CDN not ready, will retry", {
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
				debugProfile("[profile] promoted media URL to CDN", {
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
					debugProfile("[profile] promoted media URL to CDN", {
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
		const buffer = await file.arrayBuffer()
		const sourceUrl = await mediaTokenFromBuffer(buffer)
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
			throw new Error(json?.error || `Failed to upload ${file.name}.`)
		}
		const cid = getBlobCid(json.blob)
		const did = String(json.did || "")
		const bskyUrl =
			json.url ||
			(cid && did
				? `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`
				: "")
		return {
			kind: json.kind,
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
			if (editorUploadCache.has(token)) {
				const cached = editorUploadCache.get(token)
				editorUploadCache.set(resolvedSourceUrl, cached)
				if (sourceUrl && sourceUrl !== resolvedSourceUrl) {
					editorUploadCache.set(sourceUrl, cached)
				}
				return cached
			}
			const uploaded = await cacheMediaUrlInBsky(token, normalized)
			const result = {
				...uploaded,
				sourceUrl: token,
				alt: uploaded.alt || token,
			}
			editorUploadCache.set(token, result)
			if (sourceUrl) editorUploadCache.set(sourceUrl, result)
			if (resolvedSourceUrl !== sourceUrl)
				editorUploadCache.set(resolvedSourceUrl, result)
			debugProfile("[profile] inline image uploaded to bsky", {
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
			debugProfile("[profile] download image for upload", {
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
			debugProfile("[profile] image uploaded to bsky", {
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
		debugProfile("[profile] video uploaded to bsky", {
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
		debugProfile("[profile] normalizeEditorMediaHtml:start", {
			sourceLength: source.length,
		})

		const root = document.createElement("div")
		root.innerHTML = source
		let changed = convertPlainUrlsToAnchors(root)
		changed = materializeInlineMediaFromLinks(root) || changed
		changed = normalizeThirdPartyMediaUrlsInRoot(root) || changed
		changed = proxyExternalImageUrlsInRoot(root) || changed

		const pickUploadUrlFromSrcset = (value = "") => {
			const source = String(value || "").trim()
			if (!source) return ""
			const entries = source
				.split(",")
				.map(
					(part) =>
						String(part || "")
							.trim()
							.split(/\s+/)[0],
				)
				.filter(Boolean)
			const absolute = entries.filter((entry) =>
				/^https?:\/\//i.test(entry),
			)
			return absolute.length > 0 ? absolute[absolute.length - 1] : ""
		}

		const candidates = []
		for (const node of root.querySelectorAll(
			"img[src],video[src],source[src],a[href]",
		)) {
			const rawUrl =
				node.getAttribute("src") || node.getAttribute("href") || ""
			if (!rawUrl) continue
			let url = rawUrl
			if (node.tagName === "IMG" && !/^https?:\/\//i.test(url)) {
				const srcsetUrl = pickUploadUrlFromSrcset(
					node.getAttribute("srcset") ||
						node.getAttribute("data-srcset") ||
						"",
				)
				if (srcsetUrl) {
					url = srcsetUrl
				}
			}
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

		for (const img of root.querySelectorAll("img")) {
			if (img.hasAttribute("srcset")) {
				img.removeAttribute("srcset")
				changed = true
			}
			if (img.hasAttribute("sizes")) {
				img.removeAttribute("sizes")
				changed = true
			}
			if (img.hasAttribute("data-srcset")) {
				img.removeAttribute("data-srcset")
				changed = true
			}
		}
		debugProfile("[profile] normalizeEditorMediaHtml:candidates", {
			candidateCount: candidates.length,
		})

		const uploadedByUrl = new Map()

		if (!ENABLE_EDITOR_MEDIA_UPLOADS) {
			mediaUploadTotal = 0
			mediaUploadCompleted = 0
			mediaUploadActive = false
			debugProfile("[profile] editor media uploads paused", {
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
									debugProfile(
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
								warnProfile(
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
			if (entry.node.tagName === "IMG") {
				if (entry.node.hasAttribute("srcset")) {
					entry.node.removeAttribute("srcset")
					changed = true
				}
				if (entry.node.hasAttribute("sizes")) {
					entry.node.removeAttribute("sizes")
					changed = true
				}
				if (entry.node.hasAttribute("data-srcset")) {
					entry.node.removeAttribute("data-srcset")
					changed = true
				}
			}
		}

		const pendingPromotionCount = candidates.filter((entry) => {
			const uploaded = uploadedByUrl.get(entry.url)
			if (!uploaded?.bskyUrl) return false
			if (entry.node.tagName === "A") {
				return entry.node.getAttribute("href") !== uploaded.bskyUrl
			}
			return entry.node.getAttribute("src") !== uploaded.bskyUrl
		}).length
		debugProfile("[profile] normalizeEditorMediaHtml:replacement", {
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
					warnProfile("[profile] CDN promotion pass failed", {
						error: error?.message || String(error),
					})
				})
			})
		}
		debugProfile("[profile] normalizeEditorMediaHtml:done", {
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

	const nameCharCount = $derived(String(profileName || "").trim().length)
	const combinedCharCount = $derived(
		nameCharCount + profileDescription.length,
	)
	const descMaxLength = $derived(Math.max(0, 300 - nameCharCount))
	const remainingProfileChars = $derived(Math.max(0, 300 - combinedCharCount))

	const selectedProfileImage = $derived(
		profileUploadedMedia.find((entry) => entry?.kind === "image") || null,
	)

	const uploadedProfileImage = $derived(
		profileUploadedMedia.find(
			(entry) =>
				entry?.kind === "image" && !!entry?.blob && !!entry?.bskyUrl,
		) || null,
	)

	const uploadedBackgroundImage = $derived(
		backgroundUploadedMedia.find(
			(entry) =>
				entry?.kind === "image" && !!entry?.blob && !!entry?.bskyUrl,
		) || null,
	)

	// Display URLs derived from stored bskyUrl so saved images are always visible.
	const storedProfileImageSrc = $derived(
		String(uploadedProfileImage?.bskyUrl || ""),
	)
	const storedBackgroundImageSrc = $derived(
		String(uploadedBackgroundImage?.bskyUrl || ""),
	)

	const nameError = $derived(!profileName.trim() ? "Name is required." : "")

	const canonicalurl = $derived.by(() => {
		return buildCanonicalUrl(uuid, primaryVersion, profileName)
	})

	const emailError = $derived(
		!email.trim()
			? "Email is required."
			: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
				? "Enter a valid email address."
				: "",
	)

	const profileImageError = $derived(
		!selectedProfileImage ? "Profile picture is required." : "",
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
			? "Media upload is paused (paste rendering debug mode)."
			: mediaUploadActive
				? `Uploading media (${mediaUploadCompleted}/${mediaUploadTotal})`
				: unresolvedEditorMediaCount > 0
					? `${unresolvedEditorMediaCount} media item${unresolvedEditorMediaCount === 1 ? "" : "s"} still not saved`
					: "",
	)

	const imageUploadActive = $derived(
		uploadingProfileImage || uploadingBackgroundImage,
	)

	const imageUploadLabel = $derived(
		uploadingProfileImage && uploadingBackgroundImage
			? "Uploading profile and background images…"
			: uploadingProfileImage
				? "Uploading profile image…"
				: uploadingBackgroundImage
					? "Uploading background image…"
					: "",
	)

	const publishBlockedByMedia = $derived(
		imageUploadActive ||
			mediaUploadActive ||
			unresolvedEditorMediaCount > 0,
	)

	function encryptEmailForPayload(value = "") {
		const normalized = normalizeContactInput(value)
		if (!normalized) return ""
		return CONTACT_LOCK_PREFIX + encryptContact(normalized)
	}

	const primaryPostPayload = $derived({
		uuid,
		version: primaryVersion,
		canonicalurl,
		email: encryptEmailForPayload(email),
		profilePic: uploadedProfileImage?.bskyUrl || null,
		backgroundPic: uploadedBackgroundImage?.bskyUrl || null,
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
		return entries
			.map((entry) => String(entry?.htmlFragment || ""))
			.filter(Boolean)
	}

	const subsequentPayloadForBundlePreview = $derived(
		mapSubsequentPayloadForBundle(subsequentPostsPayload),
	)

	const combinedPayloadBundlePreview = $derived(
		buildBskyCombinedPayloadBundle(
			primaryPostPayload,
			subsequentPayloadForBundlePreview,
			{
				uuid,
				version: priorVersion,
				maxPayloadChars: CHUNK_ALT_PAYLOAD_TARGET_CHARS,
			},
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

	function getProfileStamp(profile = {}) {
		const stampUuid = String(profile?.uuid || "")
		const stampVersion = String(profile?.primaryVersion || "")
		return `${stampUuid}:${stampVersion}`
	}

	function setStoredSnapshotBaseline(
		profile = buildStoredProfileForStorage(),
	) {
		storedSnapshotByStamp = cloneStoredProfile(profile)
		hasChangedFromStoredSnapshot = false
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

	function filterMediaForStorage(list) {
		if (!Array.isArray(list)) return []
		return list.filter((entry) => {
			if (!entry || typeof entry !== "object") return false
			const blob = entry?.blob
			const bskyUrl = String(entry?.bskyUrl || "").trim()
			return Boolean(
				blob &&
					(typeof blob === "object" || typeof blob === "string") &&
					bskyUrl,
			)
		})
	}

	function buildStoredProfileForStorage() {
		const base = buildStoredProfile()
		return {
			...base,
			profileUploadedMedia: filterMediaForStorage(
				base.profileUploadedMedia,
			),
			backgroundUploadedMedia: filterMediaForStorage(
				base.backgroundUploadedMedia,
			),
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
			return "Draft is temporarily too large to save while embedded media data URLs are present. It will save automatically after uploads replace them with CDN URLs."
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
		const submitProfileImageError = !uploadedProfileImage
			? selectedProfileImage
				? "Profile picture is still uploading. Please wait."
				: "Profile picture is required."
			: ""
		debugProfile("[profile] validateRequiredFields", {
			hasName: Boolean(profileName.trim()),
			hasEmail: Boolean(email.trim()),
			hasProfileImage: Boolean(uploadedProfileImage),
			hasSelectedProfileImage: Boolean(selectedProfileImage),
			locationConfirmed,
			nameError,
			emailError,
			profileImageError,
			submitProfileImageError,
		})
		return nameError || emailError || submitProfileImageError || null
	}

	function activateValidation() {
		debugProfile("[profile] activateValidation")
		validationActive = true
	}

	function handleFieldBlur(field) {
		debugProfile("[profile] handleFieldBlur", {field})
		activateValidation()
		if (field === "name") touchedName = true
		if (field === "email") touchedEmail = true
	}

	function focusFirstInvalidField() {
		debugProfile("[profile] focusFirstInvalidField", {
			profileImageError,
			nameError,
			emailError,
		})
		if (profileImageError) {
			debugProfile("[profile] focusing profile image section")
			profileImageWrapEl?.focus()
			profileImageWrapEl?.scrollIntoView({
				behavior: "smooth",
				block: "nearest",
			})
			return
		}
		if (nameError) {
			debugProfile("[profile] focusing name input")
			profileNameInputEl?.focus()
			return
		}
		if (emailError) {
			debugProfile("[profile] focusing email input")
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

	/**
	 * Check if a new address preserves the location confirmation.
	 * Only the beginning of the address can be edited; the ending must be identical.
	 * This ensures city/country/zip (which correspond to the pin) remain unchanged.
	 */
	function hasRequiredLocationParts(location) {
		if (!location || typeof location !== "object") return false
		return [location.city, location.country, location.zip].every(
			(value) => String(value || "").trim().length > 0,
		)
	}

	function addressOkay(oldAddress, newAddress) {
		if (!hasRequiredLocationParts(confirmedLocation)) return false
		const old = oldAddress.trim().toLowerCase()
		const neu = newAddress.trim().toLowerCase()
		const required = [
			confirmedLocation?.city,
			confirmedLocation?.country,
			confirmedLocation?.zip,
		]

		if (!old || !neu) return false

		if (required.some((part) => !part || !neu.includes(part.toLowerCase())))
			return false

		return old[old.length - 1] === neu[old.length - 1]
	}

	$effect(() => {
		locationConfirmed =
			locationConfirmed && addressOkay(confirmedAddress, addressText)
		if (locationConfirmed) locationError = ""
	})

	async function handleModalConfirm() {
		locationError = ""
		if (
			modalLocation &&
			(pinMovedInModal || !hasRequiredLocationParts(confirmedLocation))
		) {
			const {location} = await lookupLocationDetails(
				modalLocation.lat,
				modalLocation.lon,
			)
			if (location) {
				confirmedLocation = location
				const parts = [
					location.city,
					location.state,
					location.country,
					location.zip,
				].filter(Boolean)
				if (parts.length) addressText = parts.join(", ")
				modalLocation = {...modalLocation, ...location}
			}
		}

		if (!hasRequiredLocationParts(confirmedLocation)) {
			locationConfirmed = false
			locationError =
				"Location must include city, country, and zip before it can be confirmed."
			return
		}

		confirmedAddress = addressText.trim()
		locationConfirmed = true
		locationError = ""
		showLocationModal = false
	}

	function handleModalCancel() {
		showLocationModal = false
		pinMovedInModal = false
		locationError = ""
	}

	async function publishToBluesky() {
		debugProfile("[profile] publishToBluesky:start", {
			uuid,
			primaryVersion,
			priorVersion,
			chunkCount: minifiedChunkEntries.length,
			editorMediaCount: editorMediaList.length,
		})
		activateValidation()
		touchedName = true
		touchedEmail = true
		const validationError = validateRequiredFields()
		if (validationError) {
			warnProfile("[profile] publish blocked by validation", {
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
		debugProfile("[profile] publish validation passed")
		publishError = ""
		publishMessage = ""
		if (publishBlockedByMedia) {
			publishError =
				mediaUploadLabel ||
				"Please wait for media uploads to finish before publishing."
			return
		}

		// Always require location confirmation before publishing.
		if (!locationConfirmed) {
			debugProfile("[profile] location not confirmed, showing modal")
			locationError = ""
			modalLocation = modalLocation // Use existing modal location if available
			pinMovedInModal = false
			showLocationModal = true
			return
		}

		publishing = true

		try {
			debugProfile("[profile] saving draft before publish")
			saveProfile(false)

			const publishedPriorVersion = primaryVersion
			const publishedPrimaryVersion = makeVersion()
			const publishedCanonicalUrl = buildCanonicalUrl(
				uuid,
				publishedPrimaryVersion,
				profileName,
			)
			const publishedSlugPath = cleanCanonicalName(profileName)
				.split("/")
				.map((segment) => segment.trim())
				.filter(Boolean)
				.map((segment) => encodeURIComponent(segment))
				.join("/")
			const publishedViewUrl = `/profile/view/${encodeURIComponent(uuid)}/${encodeURIComponent(publishedPrimaryVersion)}/${publishedSlugPath || "profile"}`

			const subsequentPayloadForBundle = mapSubsequentPayloadForBundle(
				subsequentPostsPayload,
			)
			const primaryPayloadForBundle = {
				uuid,
				version: publishedPrimaryVersion,
				canonicalurl: publishedCanonicalUrl,
				email: encryptEmailForPayload(email),
				profilePic: uploadedProfileImage?.bskyUrl || null,
				backgroundPic: uploadedBackgroundImage?.bskyUrl || null,
				name: profileName,
				description: profileDescription,
			}
			const combinedBundle = buildBskyCombinedPayloadBundle(
				primaryPayloadForBundle,
				subsequentPayloadForBundle,
				{
					uuid: String(primaryPayloadForBundle?.uuid || uuid || ""),
					version: String(
						publishedPrimaryVersion ||
							primaryPayloadForBundle?.version ||
							"",
					),
					maxPayloadChars: CHUNK_ALT_PAYLOAD_TARGET_CHARS,
				},
			)
			const chunks = buildChunkEntriesFromBundle(combinedBundle)

			// Build post text: name + description (≤300 chars enforced by the form)
			const postText = clampPostTextForApi(
				[profileName.trim(), profileDescription.trim()]
					.filter(Boolean)
					.join("\n"),
			)
			debugProfile("[profile] primary post text prepared", {
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

			const chunkDiagnostics = chunks.map((entry, index) => ({
				index: index + 1,
				bundleFragmentLength: String(entry?.bundleFragment || "")
					.length,
				payloadLength: measureChunkAltPayloadLength(
					entry?.bundleFragment || "",
					{
						uuid,
						version: publishedPrimaryVersion,
						index: index + 1,
						total: chunks.length,
						forceCompression: Boolean(entry?.forceCompression),
					},
				),
			}))
			debugProfile("[profile] chunk diagnostics", chunkDiagnostics)

			const publishResult = await publishChunkBundleToBsky({
				fetchImpl: fetch,
				endpoint: "/api/post",
				uuid,
				priorVersion: publishedPrimaryVersion,
				postText,
				chunks,
				primaryMedia,
				replyAttachmentPool: attachmentPool,
				videoAttachments,
			})

			priorVersion = publishedPriorVersion
			primaryVersion = publishedPrimaryVersion

			publishMessage = `Published profile + ${publishResult.totalChunkPosts} chunk${publishResult.totalChunkPosts === 1 ? "" : "s"} at ${new Date().toLocaleTimeString()}`
			debugProfile("[profile] publishToBluesky:success", {
				message: publishMessage,
				publishedPrimaryVersion,
				publishedPriorVersion,
				canonicalUrl: publishedCanonicalUrl,
				viewUrl: publishedViewUrl,
				nextPrimaryVersion: publishedPrimaryVersion,
				priorVersion,
			})

			if (typeof window !== "undefined") {
				window.location.href = publishedViewUrl
				return
			}
		} catch (err) {
			console.error("[profile] publishToBluesky:exception", err)
			publishError = err?.message || "Unexpected error while publishing."
		} finally {
			debugProfile("[profile] publishToBluesky:finally", {
				publishingBeforeReset: publishing,
			})
			publishing = false
		}
	}

	function saveProfile(showMessage = true) {
		debugProfile("[profile] saveProfile", {showMessage})
		if (typeof localStorage === "undefined") return
		const warning = getDraftSaveWarning()
		if (warning) {
			saveWarning = warning
			if (showMessage) saveMessage = ""
			warnProfile("[profile] saveProfile skipped", {
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
		priorVersion = primaryVersion
	}

	function clearProfileDraft() {
		debugProfile("[profile] clearProfileDraft:start")

		clearSnapshot = buildStoredProfileForStorage()

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
		setStoredSnapshotBaseline(buildStoredProfileForStorage())

		if (clearUndoTimer) clearTimeout(clearUndoTimer)
		showUndo = true
		clearUndoTimer = setTimeout(() => {
			showUndo = false
			clearSnapshot = null
		}, 10000)

		debugProfile("[profile] clearProfileDraft:done")
	}

	function undoProfileChanges() {
		if (!clearSnapshot) return
		if (clearUndoTimer) {
			clearTimeout(clearUndoTimer)
			clearUndoTimer = null
		}
		showUndo = false
		suppressAutosave = true
		applyStoredProfile(clearSnapshot)
		suppressAutosave = false
		saveMessage = ""
		publishMessage = ""
		publishError = ""
		uploadError = ""
		locationError = ""
		touchedName = false
		touchedEmail = false
		validationActive = false
		clearSnapshot = null

		const snapshot = JSON.stringify(buildStoredProfileForStorage())
		lastAutosaveSnapshot = snapshot
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(PROFILE_STORAGE_KEY, snapshot)
		}
	}

	function handleClearOrUndo() {
		if (showUndo) {
			undoProfileChanges()
			return
		}
		clearProfileDraft()
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

	function setView(view = "feed") {
		currentView = String(view || "feed")
	}

	onMount(() => {
		debugProfile("[profile] onMount:start")
		const intervalId = ENABLE_EDITOR_MEDIA_UPLOADS
			? setInterval(() => {
					maybePromoteCdnUrls().catch((error) => {
						warnProfile(
							"[profile] scheduled CDN promotion failed",
							{
								error: error?.message || String(error),
							},
						)
					})
				}, CDN_PROMOTION_TICK_MS)
			: null

		if (typeof localStorage === "undefined") {
			debugProfile("[profile] onMount:no localStorage")
			uuid = generateShortUuid()
			primaryVersion = makeVersion()
			priorVersion = primaryVersion
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
			setStoredSnapshotBaseline(buildStoredProfileForStorage())
			storageReady = true
			return () => {
				if (intervalId) clearInterval(intervalId)
			}
		}

		const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
		if (!raw) {
			debugProfile("[profile] onMount:no stored profile")
			uuid = generateShortUuid()
			primaryVersion = makeVersion()
			priorVersion = primaryVersion
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
			storageReady = true
			saveProfile(false)
			setStoredSnapshotBaseline(buildStoredProfileForStorage())
			return () => {
				if (intervalId) clearInterval(intervalId)
			}
		}

		try {
			const parsed = JSON.parse(raw)
			debugProfile("[profile] onMount:loaded stored profile", {
				hasUuid: Boolean(parsed?.uuid),
				hasContentHtml: Boolean(parsed?.contentHtml),
			})
			applyStoredProfile(parsed)
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
			setStoredSnapshotBaseline(buildStoredProfileForStorage())
		} catch {
			warnProfile("[profile] onMount:failed to parse stored profile")
			uuid = generateShortUuid()
			primaryVersion = makeVersion()
			priorVersion = primaryVersion
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
			setStoredSnapshotBaseline(buildStoredProfileForStorage())
		}

		storageReady = true
		debugProfile("[profile] onMount:ready")
		return () => {
			if (intervalId) clearInterval(intervalId)
		}
	})

	$effect(() => {
		if (!storageReady || !storedSnapshotByStamp) return
		if (hasChangedFromStoredSnapshot) return

		const currentSnapshot = buildStoredProfileForStorage()
		if (
			getProfileStamp(currentSnapshot) !==
			getProfileStamp(storedSnapshotByStamp)
		) {
			return
		}

		if (
			JSON.stringify(currentSnapshot) !==
			JSON.stringify(storedSnapshotByStamp)
		) {
			hasChangedFromStoredSnapshot = true
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
		debugProfile("[profile] autosave effect triggered")
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
					debugProfile("[profile] editor media html normalized", {
						beforeLength: runSource.length,
						afterLength: normalized.length,
					})
					contentHtml = normalized
					queuedEditorMediaSource = normalized
				}
			}
		})()
			.catch((error) => {
				warnProfile("[profile] editor media normalization failed", {
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
		debugProfile("[profile] chunk effect:start", {
			currentBuild,
			sourceLength: source.length,
		})
		;(async () => {
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
			debugProfile("[profile] chunk effect:success", {
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
			warnProfile("[profile] chunk effect:fallback", {
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
	<NavBar {currentView} onSetView={setView} />

	<ShowAdmin {currentView}>
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
	</ShowAdmin>

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
				bind:uploadingProfile={uploadingProfileImage}
				bind:uploadingBackground={uploadingBackgroundImage}
				currentProfileSrc={storedProfileImageSrc}
				currentBackgroundSrc={storedBackgroundImageSrc}
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
				onfocus={activateValidation}
				onblur={() => handleFieldBlur("name")}
				class:invalid-field={touchedName && !!nameError}
				placeholder="Name"
				maxlength={100}
				style="font-size: 1.25rem; font-weight: 600;"
			/>
		</label>
		<ShowAdmin {currentView}>
			<div class="canonicalurl-preview">{canonicalurl}</div>
		</ShowAdmin>
		{#if touchedName && nameError}
			<p class="field-error">{nameError}</p>
		{/if}
		<label>
			<textarea
				rows="4"
				bind:value={profileDescription}
				onfocus={activateValidation}
				placeholder="Short profile description"
				maxlength={descMaxLength}
				style="min-height: 100px; resize: vertical;"
			></textarea>
		</label>
		<p class="char-count">{remainingProfileChars}/{descMaxLength}</p>
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
				onfocus={activateValidation}
				onblur={() => handleFieldBlur("email")}
				class:invalid-field={touchedEmail && !!emailError}
				placeholder="you@email.com"
				required
			/>
		</label>
		{#if touchedEmail && emailError}
			<p class="field-error">{emailError}</p>
		{/if}
		<div class="address-row">
			<input
				class="address-input"
				type="text"
				bind:value={addressText}
				onfocus={activateValidation}
				oninput={() => {
					locationError = ""
				}}
				placeholder="Location is required, but exact address is not"
			/>
			{#if locationConfirmed}
				<span class="address-confirmed-badge">✓ Confirmed</span>
			{/if}
		</div>
		{#if locationError}
			<p class="field-error">{locationError}</p>
		{/if}

		{#if imageUploadActive}
			<div class="upload-progress-bar-wrap">
				<div class="upload-progress-bar indeterminate"></div>
				<p class="upload-progress-label">{imageUploadLabel}</p>
			</div>
		{/if}

		<div class="actions-row">
			<div aria-hidden="true"></div>
			<button
				type="button"
				class="primary"
				onclick={publishToBluesky}
				disabled={publishing || publishBlockedByMedia}
			>
				<Send size={16} aria-hidden="true" />
				<span>{publishing ? "Publishing…" : "Publish"}</span>
			</button>
			<div class="actions-right">
				<button type="button" onclick={saveProfile}>
					<Save size={16} aria-hidden="true" />
					<span>draft</span>
				</button>
				<button type="button" onclick={handleClearOrUndo}>
					<Eraser size={16} aria-hidden="true" />
					<span>{showUndo ? "Undo" : "Clear"}</span>
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

	{#if showLocationModal}
		<div
			class="modal-overlay"
			role="dialog"
			aria-modal="true"
			aria-label="Confirm location"
		>
			<div class="modal-panel">
				<h2 class="modal-title">Confirm Location</h2>
				<p class="modal-hint">
					Search for your address or move the pin to the exact spot,
					then confirm.
				</p>
				<LocationPicker
					location={modalLocation}
					height={300}
					searchTerms={addressText}
					showConfirmToggle={false}
					autoSearch={true}
					onChange={(loc) => {
						modalLocation = loc
					}}
					onPinMoved={() => {
						pinMovedInModal = true
					}}
				/>
				<div class="modal-actions">
					<button
						class="modal-cancel-btn"
						type="button"
						onclick={handleModalCancel}>Cancel</button
					>
					<button
						class="modal-confirm-btn"
						type="button"
						onclick={handleModalConfirm}>Confirm Location</button
					>
				</div>
			</div>
		</div>
	{/if}

	<ShowAdmin {currentView}>
		<section class="panel payloads">
			<h2>Primary Payload Preview</h2>
			<pre>{JSON.stringify(primaryPostPayload, null, 2)}</pre>
			<h2>
				Subsequent Payload Preview ({subsequentPostsPayload.length})
			</h2>
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
	</ShowAdmin>
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
		margin-top: 1rem;
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
	.canonicalurl-preview {
		margin: -0.1rem 0 0.45rem;
		font-size: 0.78rem;
		color: #7a817b;
		word-break: break-all;
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

	.address-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.45rem;
	}
	.address-input {
		flex: 1;
		font: inherit;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		padding: 0.65rem 0.75rem;
		box-sizing: border-box;
	}
	.address-confirmed-badge {
		flex-shrink: 0;
		font-size: 0.85rem;
		color: #24633f;
		font-weight: 600;
		white-space: nowrap;
	}

	.upload-progress-bar-wrap {
		margin: 0.6rem 0 0.2rem;
	}
	.upload-progress-bar {
		height: 4px;
		border-radius: 999px;
		background: #d7e8dc;
		overflow: hidden;
		position: relative;
	}
	.upload-progress-bar.indeterminate::after {
		content: "";
		position: absolute;
		inset: 0;
		background: #3b6e4f;
		animation: indeterminate-slide 1.4s ease-in-out infinite;
		width: 40%;
	}
	@keyframes indeterminate-slide {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(350%);
		}
	}
	.upload-progress-label {
		margin: 0.3rem 0 0;
		font-size: 0.82rem;
		color: #3b6e4f;
	}

	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 1000;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 1rem;
		overflow-y: auto;
	}
	.modal-panel {
		background: rgba(255, 250, 241, 0.98);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 1.25rem;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
		width: 100%;
		max-width: 640px;
		margin-top: 2rem;
	}
	.modal-title {
		margin: 0 0 0.4rem;
		font-size: 1.1rem;
	}
	.modal-hint {
		margin: 0 0 0.85rem;
		font-size: 0.9rem;
		color: #5f665f;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.55rem;
		margin-top: 0.85rem;
	}
	.modal-cancel-btn {
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font: inherit;
		cursor: pointer;
	}
	.modal-confirm-btn {
		border: 1px solid #305741;
		background: #3b6e4f;
		color: #fff;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	/*
Source - https://stackoverflow.com/a/79793317
Posted by Debtanu Coder
Retrieved 2026-05-08, License - CC BY-SA 4.0
*/
</style>
