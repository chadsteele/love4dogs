export function isLikelyImageUrl(url = "") {
	return /\.(avif|gif|jpe?g|png|svg|webp)(\?|#|$)/i.test(url)
}

export function isLikelyVideoUrl(url = "") {
	return /\.(m3u8|mov|mp4|m4v|webm)(\?|#|$)/i.test(url)
}

export function isBskyHostedUrl(url = "") {
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

export function collectUrlTextNodes(root) {
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

export function convertPlainUrlsToAnchors(root) {
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
				fragment.appendChild(document.createTextNode(raw.slice(lastIndex, start)))
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
			fragment.appendChild(document.createTextNode(raw.slice(lastIndex)))
		}
		textNode.parentNode?.replaceChild(fragment, textNode)
	}
	return changed
}

export function materializeInlineMediaFromLinks(root) {
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
				String(anchor.textContent || anchor.title || "Image").trim(),
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

	for (const node of root.querySelectorAll("[style*='background-image']")) {
		if (node.querySelector("img,video,source")) continue
		const styleValue = String(node.getAttribute("style") || "")
		const match = styleValue.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i)
		const src = String(match?.[2] || "").trim()
		if (!/^https?:\/\//i.test(src)) continue
		if (!isLikelyImageUrl(src)) continue
		const img = document.createElement("img")
		img.setAttribute("src", src)
		img.setAttribute("alt", String(node.getAttribute("title") || "Image"))
		node.prepend(img)
		changed = true
	}

	return changed
}

export function normalizeThirdPartyMediaUrl(url = "") {
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

	const nextPath = parsed.pathname
		.replace(/,enc_avif(?=,|\/|$)/gi, "")
		.replace(/,,+/g, ",")
	if (nextPath === parsed.pathname) return source
	parsed.pathname = nextPath
	return parsed.toString()
}

export function normalizeThirdPartyMediaUrlsInRoot(root) {
	let changed = false
	for (const node of root.querySelectorAll("img[src],video[src],source[src]")) {
		const src = String(node.getAttribute("src") || "").trim()
		if (!src) continue
		const normalized = normalizeThirdPartyMediaUrl(src)
		if (!normalized || normalized === src) continue
		node.setAttribute("src", normalized)
		changed = true
	}
	return changed
}

export function buildLocalImageProxyUrl(url = "") {
	const source = String(url || "").trim()
	if (!source || !/^https?:\/\//i.test(source)) return source
	return `/api/download-image?url=${encodeURIComponent(source)}`
}

export function isLocalImageProxyUrl(url = "") {
	return /^\/api\/download-image\?url=/i.test(String(url || "").trim())
}

export function tryDecodeUrlComponent(value = "") {
	const source = String(value || "")
	try {
		return decodeURIComponent(source)
	} catch {
		return source
	}
}

export function resolveUploadSourceUrl(url = "") {
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
		const nestedRaw = String(parsed.searchParams.get("url") || "").trim()
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

export function extensionFromMimeType(mimeType = "") {
	const value = String(mimeType || "").toLowerCase()
	if (value.includes("png")) return "png"
	if (value.includes("webp")) return "webp"
	if (value.includes("gif")) return "gif"
	if (value.includes("svg")) return "svg"
	if (value.includes("jpeg") || value.includes("jpg")) return "jpg"
	return "jpg"
}

export function proxyExternalImageUrlsInRoot(root) {
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

export function getBlobCid(blobRef) {
	if (typeof blobRef !== "object" || !blobRef) return ""
	return String(blobRef.ref?.$link || blobRef.cid || "")
}

export function replaceMediaUrlInHtml(html = "", fromUrl = "", toUrl = "") {
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
