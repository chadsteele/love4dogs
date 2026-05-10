const DEFAULT_CHUNK_ALT_PAYLOAD_TARGET_CHARS = 2000
const DEFAULT_CONTENT_CHUNK_SIZE = 1800

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

	if (!dict.length) return {html, dict: []}
	return {html: working, dict}
}

function compressChunkHtmlForAlt(html = "") {
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

export function buildChunkAltPayload(meta = {}, htmlFragment = "") {
	const sourceHtml = String(htmlFragment || "")
	const compressed = compressChunkHtmlForAlt(sourceHtml)
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

export function inflateChunkAltPayloadHtml(payload = {}) {
	let html = String(payload?.h || "")
	const dict = Array.isArray(payload?.d) ? payload.d : []
	if (dict.length > 0) {
		html = html.replace(/~(\d+)~/g, (match, idx) => {
			const value = dict[Number(idx)]
			return typeof value === "string" ? value : match
		})
	}
	const prefix = String(payload?.p || "")
	if (prefix) {
		html = html.replace(/~c~/g, prefix)
	}
	return html
}

export function measureChunkAltPayloadLength(htmlFragment = "", meta = {}) {
	const payload = buildChunkAltPayload(
		{
			uuid: String(meta?.uuid || "u"),
			version: String(meta?.version || "v"),
			index: Number(meta?.index || 1),
			total: Number(meta?.total || 1),
		},
		htmlFragment,
	)
	return JSON.stringify(payload).length
}

function chunkHtmlByNodes(html = "", maxChars = DEFAULT_CONTENT_CHUNK_SIZE) {
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

function splitFragmentByAltPayload(
	fragment = "",
	maxPayloadChars = DEFAULT_CHUNK_ALT_PAYLOAD_TARGET_CHARS,
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
			const payloadLength = measureChunkAltPayloadLength(candidate, meta)
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
	maxPayloadChars = DEFAULT_CHUNK_ALT_PAYLOAD_TARGET_CHARS,
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
			})
			if (payloadLength <= maxPayloadChars) {
				next.push(fragment)
				continue
			}
			const parts = splitFragmentByAltPayload(fragment, maxPayloadChars, {
				uuid: meta?.uuid,
				version: meta?.version,
				index: i + 1,
				total,
			})
			if (parts.length > 1) changed = true
			next.push(...parts)
		}
		working = next
	}
	return working
}

function coalesceAltPayloadChunks(
	fragments = [],
	maxPayloadChars = DEFAULT_CHUNK_ALT_PAYLOAD_TARGET_CHARS,
	meta = {},
) {
	const source = fragments.map((entry) => String(entry || "")).filter(Boolean)
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

export function chunkHtmlByAltPayload(
	html = "",
	maxPayloadChars = DEFAULT_CHUNK_ALT_PAYLOAD_TARGET_CHARS,
	meta = {},
) {
	const source = String(html || "")
	if (!source) return []
	if (typeof document === "undefined") {
		const fallback = chunkHtmlByNodes(source, DEFAULT_CONTENT_CHUNK_SIZE)
		const limited = enforceAltPayloadLimit(fallback, maxPayloadChars, meta)
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

export function buildCombinedPayloadBundle(
	primaryPayload = {},
	subsequentPayload = [],
	options = {},
) {
	const maxPayloadChars = Number(
		options?.maxPayloadChars || DEFAULT_CHUNK_ALT_PAYLOAD_TARGET_CHARS,
	)
	const forceCompression = true
	const combinedJson = JSON.stringify({
		primary: primaryPayload,
		subsequent: subsequentPayload,
	})
	const limited = enforceAltPayloadLimit([combinedJson], maxPayloadChars, {
		uuid: String(options?.uuid || primaryPayload?.uuid || ""),
		version: String(options?.version || primaryPayload?.version || ""),
		forceCompression,
	})
	const fragments = coalesceAltPayloadChunks(limited, maxPayloadChars, {
		uuid: String(options?.uuid || primaryPayload?.uuid || ""),
		version: String(options?.version || primaryPayload?.version || ""),
		forceCompression,
	})
	return {
		combinedJson,
		forceCompression,
		fragments,
	}
}

export function buildChunkEntriesFromBundle(bundle = {}) {
	const fragments = Array.isArray(bundle?.fragments) ? bundle.fragments : []
	return fragments.map((fragment, index) => ({
		index: index + 1,
		total: fragments.length,
		bundleFragment: String(fragment || ""),
		forceCompression: Boolean(bundle?.forceCompression),
	}))
}

async function postToBskyApi(fetchImpl, endpoint, body) {
	const response = await fetchImpl(endpoint, {method: "POST", body})
	const json = await response.json().catch(() => ({}))
	if (!response.ok || !json?.ok) {
		throw new Error(json?.error || "Failed to publish post to Bluesky.")
	}
	return json
}

export async function publishChunkBundleToBsky({
	fetchImpl = fetch,
	endpoint = "/api/post",
	uuid = "",
	priorVersion = "",
	postText = "",
	chunks = [],
	primaryMedia = [],
	replyAttachmentPool = [],
	videoAttachments = [],
} = {}) {
	const normalizedChunks = Array.isArray(chunks) ? chunks : []
	const normalizedPrimaryMedia = Array.isArray(primaryMedia)
		? primaryMedia.map((entry) => ({...entry}))
		: []

	const primaryChunkCount = Math.min(4, normalizedChunks.length)
	const primaryChunks = normalizedChunks.slice(0, primaryChunkCount)

	if (primaryChunks.length > 0 && normalizedPrimaryMedia.length === 0) {
		throw new Error(
			"Unable to attach payload chunks on the primary post: at least one profile/background image is required.",
		)
	}

	if (primaryChunks.length > 0) {
		const primaryCarrierSeed = normalizedPrimaryMedia.map((entry) => ({
			...entry,
		}))
		while (normalizedPrimaryMedia.length < primaryChunks.length) {
			const seed =
				primaryCarrierSeed[
					normalizedPrimaryMedia.length % primaryCarrierSeed.length
				]
			normalizedPrimaryMedia.push({...seed})
		}
		for (let i = 0; i < primaryChunks.length; i += 1) {
			const chunkEntry = primaryChunks[i]
			const altPayload = buildChunkAltPayload(
				{
					uuid,
					version: priorVersion,
					index: chunkEntry.index,
					total: normalizedChunks.length,
				},
				chunkEntry?.bundleFragment || "",
			)
			normalizedPrimaryMedia[i] = {
				...normalizedPrimaryMedia[i],
				alt: JSON.stringify(altPayload),
			}
		}
	}

	const primaryFd = new FormData()
	primaryFd.append("text", String(postText || ""))
	if (normalizedPrimaryMedia.length > 0) {
		primaryFd.append("uploadedMedia", JSON.stringify(normalizedPrimaryMedia))
	}

	const primaryJson = await postToBskyApi(fetchImpl, endpoint, primaryFd)
	const primaryUri = String(primaryJson?.result?.uri || "")
	const primaryCid = String(primaryJson?.result?.cid || "")
	const replyRef =
		primaryUri && primaryCid
			? JSON.stringify({
					root: {uri: primaryUri, cid: primaryCid},
					parent: {uri: primaryUri, cid: primaryCid},
				})
			: null

	const primaryVideo = Array.isArray(videoAttachments)
		? videoAttachments.filter((entry) => entry?.blob).slice(0, 1)
		: []
	if (primaryVideo.length > 0) {
		const videoFd = new FormData()
		videoFd.append("text", "Video")
		videoFd.append("uploadedMedia", JSON.stringify([primaryVideo[0]]))
		if (replyRef) videoFd.append("reply", replyRef)
		await postToBskyApi(fetchImpl, endpoint, videoFd)
	}

	const chunksForReplies = normalizedChunks.slice(primaryChunks.length)
	const chunkGroups = []
	for (let i = 0; i < chunksForReplies.length; i += 4) {
		chunkGroups.push(chunksForReplies.slice(i, i + 4))
	}

	for (let i = 0; i < chunkGroups.length; i += 1) {
		const chunkGroup = chunkGroups[i] || []
		const mediaForPost = []

		if (Array.isArray(replyAttachmentPool) && replyAttachmentPool.length > 0) {
			for (const chunkEntry of chunkGroup) {
				const chunkAltPayload = buildChunkAltPayload(
					{
						uuid,
						version: priorVersion,
						index: chunkEntry.index,
						total: normalizedChunks.length,
					},
					chunkEntry?.bundleFragment || "",
				)
				const attachment =
					replyAttachmentPool[
						(chunkEntry.index - 1) % replyAttachmentPool.length
					]
				mediaForPost.push({
					...attachment,
					alt: JSON.stringify(chunkAltPayload),
				})
			}
		} else if (primaryVideo.length > 0 && chunkGroup.length === 1) {
			const chunkEntry = chunkGroup[0]
			const chunkAltPayload = buildChunkAltPayload(
				{
					uuid,
					version: priorVersion,
					index: chunkEntry.index,
					total: normalizedChunks.length,
				},
				chunkEntry?.bundleFragment || "",
			)
			mediaForPost.push({
				...primaryVideo[0],
				alt: JSON.stringify(chunkAltPayload),
			})
		}

		if (mediaForPost.length === 0 && chunkGroup.length > 0) {
			throw new Error(
				"Unable to attach payload chunks: add at least one image carrier (profile, background, or editor image).",
			)
		}

		const chunkFd = new FormData()
		chunkFd.append("text", `Payload ${i + 1}/${chunkGroups.length}`)
		if (mediaForPost.length > 0) {
			chunkFd.append("uploadedMedia", JSON.stringify(mediaForPost))
		}
		if (replyRef) chunkFd.append("reply", replyRef)

		await postToBskyApi(fetchImpl, endpoint, chunkFd)
	}

	return {
		primaryResult: primaryJson?.result || null,
		totalChunkPosts: chunkGroups.length,
		chunkCount: normalizedChunks.length,
		primaryChunkCount,
		replyChunkCount: chunksForReplies.length,
	}
}

function parseChunkPayloadFromAlt(alt = "") {
	const source = String(alt || "").trim()
	if (!source) return null
	let parsed
	try {
		parsed = JSON.parse(source)
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== "object") return null
	if (!("h" in parsed) || !Number.isFinite(Number(parsed?.i))) return null
	return parsed
}

export function collectChunkPayloadsFromPosts(posts = [], {uuid, version} = {}) {
	const expectedUuid = String(uuid || "")
	const expectedVersion = String(version || "")
	const byIndex = new Map()

	for (const post of Array.isArray(posts) ? posts : []) {
		const embed = post?.embed
		const media =
			embed?.$type === "app.bsky.embed.recordWithMedia#view"
				? embed.media
				: embed
		const images =
			media?.$type === "app.bsky.embed.images#view" ? media.images || [] : []
		for (const image of images) {
			const payload = parseChunkPayloadFromAlt(image?.alt || "")
			if (!payload) continue
			const payloadUuid = String(payload?.u || payload?.uuid || "")
			const payloadVersion = String(payload?.v || payload?.version || "")
			if (payloadUuid !== expectedUuid || payloadVersion !== expectedVersion) {
				continue
			}
			const index = Number(payload?.i || 0)
			if (!Number.isFinite(index) || index <= 0) continue
			if (!byIndex.has(index)) byIndex.set(index, payload)
		}
	}

	return Array.from(byIndex.entries())
		.sort((a, b) => a[0] - b[0])
		.map((entry) => entry[1])
}

export function reconstructBundleFromChunkPayloads(payloads = []) {
	if (!Array.isArray(payloads) || payloads.length === 0) {
		throw new Error("Profile not found")
	}
	const total = Math.max(...payloads.map((payload) => Number(payload?.t || 0), 0))
	if (!total || payloads.length < total) {
		throw new Error("Profile payload is incomplete")
	}
	const fragments = new Array(total).fill("")
	for (const payload of payloads) {
		const index = Number(payload?.i || 0)
		if (!Number.isFinite(index) || index <= 0 || index > total) continue
		fragments[index - 1] = inflateChunkAltPayloadHtml(payload)
	}
	if (fragments.some((entry) => !entry)) {
		throw new Error("Profile payload is missing chunk data")
	}
	const combinedJson = fragments.join("")
	let combined
	try {
		combined = JSON.parse(combinedJson)
	} catch {
		throw new Error("Profile payload JSON is invalid")
	}
	return {
		combinedJson,
		combined,
		fragments,
	}
}

export async function loadProfileBundleFromPublicBsky({
	fetchImpl = fetch,
	uuid,
	version,
	author = "love4dogs.club",
	querySuffix = "canonicalurl",
	limit = 100,
} = {}) {
	const id = String(uuid || "")
	const stamp = String(version || "")
	if (!id || !stamp) throw new Error("Missing uuid/stamp route params")

	const query = `${id} ${stamp} ${querySuffix}`.trim()
	const searchUrl = `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&author=${encodeURIComponent(author)}&limit=${encodeURIComponent(String(limit))}`
	const response = await fetchImpl(searchUrl)
	if (!response.ok) throw new Error("Profile not found")
	const json = await response.json().catch(() => ({}))
	const posts = Array.isArray(json?.posts) ? json.posts : []
	const payloads = collectChunkPayloadsFromPosts(posts, {
		uuid: id,
		version: stamp,
	})

	if (payloads.length > 0) {
		const reconstructed = reconstructBundleFromChunkPayloads(payloads)
		return {
			query,
			searchUrl,
			posts,
			payloads,
			...reconstructed,
		}
	}

	for (const post of posts) {
		const embed = post?.embed
		const media =
			embed?.$type === "app.bsky.embed.recordWithMedia#view"
				? embed.media
				: embed
		const images =
			media?.$type === "app.bsky.embed.images#view" ? media.images || [] : []
		for (const image of images) {
			const alt = String(image?.alt || "")
			if (!alt) continue
			let parsed
			try {
				parsed = JSON.parse(alt)
			} catch {
				continue
			}
			const payloadUuid = String(parsed?.uuid || parsed?.u || "")
			const payloadVersion = String(parsed?.version || parsed?.v || "")
			if (payloadUuid !== id || payloadVersion !== stamp) continue
			return {
				query,
				searchUrl,
				posts,
				payloads: [],
				combinedJson: JSON.stringify(parsed),
				combined: parsed,
				fragments: [JSON.stringify(parsed)],
			}
		}
	}

	throw new Error("Profile not found")
}

export function collectLinksFromValue(value, links = new Set()) {
	if (typeof value === "string") {
		const matches = value.match(/https?:\/\/[^\s"'<>]+/g) || []
		for (const match of matches) links.add(match)
		return links
	}
	if (Array.isArray(value)) {
		for (const item of value) collectLinksFromValue(item, links)
		return links
	}
	if (value && typeof value === "object") {
		for (const key of Object.keys(value)) {
			collectLinksFromValue(value[key], links)
		}
	}
	return links
}
