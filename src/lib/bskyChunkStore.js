import { resolvePostTimestampMs } from './dateTime.js';

const DEFAULT_CHUNK_ALT_PAYLOAD_TARGET_CHARS = 2000
const DEFAULT_CONTENT_CHUNK_SIZE = 1800
const STATIC_HTML_DICT_VERSION = 1
// Leave a small buffer below the hard limit so coalesce can absorb tiny residuals
// that binary-split would otherwise leave as orphaned 1-3 char fragments.
const SPLIT_BUFFER_CHARS = 40
const BSKY_PUBLIC_XRPC = "https://public.api.bsky.app/xrpc"
function sortUniqueHtmlCandidates(candidates = []) {
	const unique = [...new Set(candidates.map((entry) => String(entry || "")).filter(Boolean))]
	return unique.sort((a, b) => {
		if (b.length !== a.length) return b.length - a.length
		if (a < b) return -1
		if (a > b) return 1
		return 0
	})
}

const STATIC_HTML_DICT = sortUniqueHtmlCandidates([
	"<figure><img src=",
	"><figcaption>",
	"></figcaption></figure>",
	"</figcaption></figure>",
	"</figure><figure>",
	"<figcaption>",
	"</figcaption>",
	"<iframe src=",
	"<iframe ",
	"</iframe>",
	" allowfullscreen",
	" frameborder=0",
	" width=",
	" height=",
	" style=",
	" class=",
	" href=",
	" title=",
	" referrerpolicy=no-referrer",
	" fetchpriority=high",
	" loading=lazy",
	" decoding=async",
	"<p><strong>",
	"</strong></p>",
	"<strong>",
	"</strong>",
	"<figure><img ",
	"<figure>",
	"</figure>",
	"<img src=",
	"<img ",
	"<div>",
	"</div>",
	"<span",
	"</span>",
	"<p>",
	"</p>",
	"<section>",
	"</section>",
	"<article>",
	"</article>",
	"<header>",
	"</header>",
	"<footer>",
	"</footer>",
	"<main>",
	"</main>",
	"<aside>",
	"</aside>",
	"<nav>",
	"</nav>",
	"<table>",
	"</table>",
	"<thead>",
	"</thead>",
	"<tbody>",
	"</tbody>",
	"<tr>",
	"</tr>",
	"<td>",
	"</td>",
	"<th>",
	"</th>",
	"<colgroup>",
	"</colgroup>",
	"<video",
	"</video>",
	"<source src=",
	" type=",
	" controls",
	" playsinline",
	" muted",
	" loop",
	" poster=",
	" allow=",
	" referrerpolicy=",
	"<ul>",
	"</ul>",
	"<ol>",
	"</ol>",
	"<li>",
	"</li>",
	" target=_blank",
	" rel=noopener noreferrer",
	" alt=",
	" src=",
	"src=",
])

function staticToken(index) {
	return `\uE000${index}\uE001`
}

function compressWithStaticDict(html = "") {
	let working = String(html || "")
	if (!working) {
		return {html: "", staticVersion: 0}
	}

	let changed = false
	for (let i = 0; i < STATIC_HTML_DICT.length; i += 1) {
		const needle = STATIC_HTML_DICT[i]
		if (!needle || needle.length < 8) continue
		const token = staticToken(i)
		if (token.length >= needle.length) continue
		const count = working.split(needle).length - 1
		if (count < 2) continue
		working = working.split(needle).join(token)
		changed = true
	}

	if (!changed) {
		return {html: String(html || ""), staticVersion: 0}
	}

	return {
		html: working,
		staticVersion: STATIC_HTML_DICT_VERSION,
	}
}

function inflateWithStaticDict(html = "", staticVersion = 0) {
	if (Number(staticVersion) !== STATIC_HTML_DICT_VERSION) {
		return String(html || "")
	}

	let working = String(html || "")
	for (let i = 0; i < STATIC_HTML_DICT.length; i += 1) {
		const token = staticToken(i)
		working = working.split(token).join(STATIC_HTML_DICT[i])
	}
	return working
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

function compressCommonHtmlSubstrings(html = "") {
	let working = String(html || "")
	if (!working) return {html: "", dict: []}

	const dict = []
	for (const needle of STATIC_HTML_DICT) {
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

	const staticCompression = compressWithStaticDict(packed)
	const staticPacked = staticCompression.html
	const staticVersion = staticCompression.staticVersion
	const dictCompression = compressCommonHtmlSubstrings(staticPacked)
	const withDict = dictCompression.html
	const dict = dictCompression.dict

	const baselinePayloadLength = JSON.stringify({h: source}).length
	const candidatePayload = {h: withDict}
	if (prefix) {
		candidatePayload.p = prefix
		candidatePayload.f = 1
	}
	if (staticVersion > 0) {
		candidatePayload.sv = staticVersion
		candidatePayload.f = (candidatePayload.f || 0) | 4
	}
	if (dict.length > 0) {
		candidatePayload.d = dict
		candidatePayload.f = (candidatePayload.f || 0) | 2
	}
	if (JSON.stringify(candidatePayload).length >= baselinePayloadLength) {
		return {html: source, prefix: "", dict: []}
	}

	return {html: withDict, prefix, dict, staticVersion}
}

export function buildChunkAltPayload(meta = {}, htmlFragment = "") {
	const sourceHtml = String(htmlFragment || "")
	const compressed = compressChunkHtmlForAlt(sourceHtml)
	const payload = {
		u: String(meta?.uuid || ""),
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
		payload.f = (payload.f || 0) | 2
	}
	if (Number(compressed?.staticVersion || 0) > 0) {
		payload.sv = Number(compressed.staticVersion)
		payload.f = (payload.f || 0) | 4
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

	html = inflateWithStaticDict(html, payload?.sv)
	return html
}

export function measureChunkAltPayloadLength(htmlFragment = "", meta = {}) {
	const payload = buildChunkAltPayload(
		{
			uuid: String(meta?.uuid || "u"),
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
			const effectiveMax = Math.max(50, maxPayloadChars - SPLIT_BUFFER_CHARS)
			const payloadLength = measureChunkAltPayloadLength(candidate, meta)
			if (payloadLength <= effectiveMax) {
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
				index: i + 1,
				total,
			})
			if (payloadLength <= maxPayloadChars) {
				next.push(fragment)
				continue
			}
			const parts = splitFragmentByAltPayload(fragment, maxPayloadChars, {
				uuid: meta?.uuid,
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
	// Strip large html blob from primary: the reader always uses subsequent.join("") for
	// display, so storing html in primary is pure duplication and doubles the combined JSON.
	const {html: _primaryHtml, ...primaryForBundle} = primaryPayload || {}
	const combinedJson = JSON.stringify({
		primary: primaryForBundle,
		subsequent: subsequentPayload,
	})
	const limited = enforceAltPayloadLimit([combinedJson], maxPayloadChars, {
		uuid: String(options?.uuid || primaryPayload?.uuid || ""),
		forceCompression,
	})
	const fragments = coalesceAltPayloadChunks(limited, maxPayloadChars, {
		uuid: String(options?.uuid || primaryPayload?.uuid || ""),
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

function isValidPostAtUri(uri = "") {
	return /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/?#]+$/i.test(
		String(uri || "").trim(),
	)
}

export async function deletePostUriViaApi({
	fetchImpl = fetch,
	endpoint = "/api/post",
	uri = "",
} = {}) {
	const targetUri = String(uri || "").trim()
	if (!targetUri) {
		return {ok: true, skipped: true, reason: "missing-uri"}
	}
	if (!isValidPostAtUri(targetUri)) {
		throw new Error(`Invalid post URI: ${targetUri}`)
	}

	const formData = new FormData()
	formData.append("mode", "delete-post-uri")
	formData.append("uri", targetUri)

	const response = await fetchImpl(endpoint, {
		method: "POST",
		body: formData,
	})
	const json = await response.json().catch(() => ({}))
	if (!response.ok || !json?.ok) {
		throw new Error(json?.error || `Failed to delete post URI: ${targetUri}`)
	}

	return {
		ok: true,
		skipped: false,
		deletedUri: targetUri,
		result: json,
	}
}

export async function replacePostUriViaApi({
	fetchImpl = fetch,
	endpoint = "/api/post",
	previousUri = "",
	nextUri = "",
} = {}) {
	const oldUri = String(previousUri || "").trim()
	const newUri = String(nextUri || "").trim()
	if (!oldUri || !newUri || oldUri === newUri) {
		return {ok: true, replaced: false, skipped: true}
	}

	await deletePostUriViaApi({
		fetchImpl,
		endpoint,
		uri: oldUri,
	})

	return {
		ok: true,
		replaced: true,
		oldUri,
		newUri,
	}
}

export async function publishChunkBundleToBsky({
	fetchImpl = fetch,
	endpoint = "/api/post",
	uuid = "",
	postType = "",
	tags = [],
	postText = "",
	primaryPayload = {},
	chunks = [],
	primaryMedia = [],
	replyAttachmentPool = [],
	videoAttachments = [],
} = {}) {
	const normalizedChunks = Array.isArray(chunks) ? chunks : []
	const normalizedPrimaryMedia = Array.isArray(primaryMedia)
		? primaryMedia.map((entry) => ({...entry}))
		: []
	let normalizedTags = Array.isArray(tags) ? tags : [];
	normalizedTags = normalizedTags.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean);
	normalizedTags = [...new Set(normalizedTags)];
	const chunkCarrierPool = [
		...normalizedPrimaryMedia,
		...(Array.isArray(replyAttachmentPool) ? replyAttachmentPool : []),
		...(Array.isArray(videoAttachments)
			? videoAttachments.filter((entry) => entry?.blob)
			: []),
	].filter((entry) => entry && entry.blob)

	if (normalizedChunks.length > 0 && chunkCarrierPool.length === 0) {
		throw new Error(
			"Unable to attach payload chunks: add at least one image or video carrier.",
		)
	}

	const chunkGroups = []
	for (let i = 0; i < normalizedChunks.length; i += 4) {
		chunkGroups.push(normalizedChunks.slice(i, i + 4))
	}

	let manifestPrimaryPayload = { ...primaryPayload, tags: normalizedTags }

	       const chunkResults = []
	       for (let i = 0; i < chunkGroups.length; i += 1) {
		       const chunkGroup = chunkGroups[i] || []
		       const mediaForPost = []

		       for (const chunkEntry of chunkGroup) {
			       const carrier =
				       chunkCarrierPool[(chunkEntry.index - 1) % chunkCarrierPool.length]
			       const chunkAltPayload = buildChunkAltPayload(
				       {
					       uuid,
					       index: chunkEntry.index,
					       total: normalizedChunks.length,
				       },
				       chunkEntry?.bundleFragment || "",
			       )
			       mediaForPost.push({
				       ...carrier,
				       alt: JSON.stringify(chunkAltPayload),
			       })
		       }

		       if (mediaForPost.length === 0) {
			       continue
		       }

		       const chunkFd = new FormData()
		       chunkFd.append("text", postText || "❤️")
		       if (postType) chunkFd.append("postType", postType)
		       if (normalizedTags.length > 0) {
			       chunkFd.append("tags", JSON.stringify(normalizedTags))
		       }
		       chunkFd.append("uploadedMedia", JSON.stringify(mediaForPost))
		       const result = await postToBskyApi(fetchImpl, endpoint, chunkFd)
		       chunkResults.push(result?.result || null)
	       }

	       const chunkUris = chunkResults
		       .map((entry) => String(entry?.uri || "").trim())
		       .filter(Boolean)
	       const chunkManifest = buildChunkUriManifest(chunkUris)
	       // Omit the full html from the manifest image alt — it is already stored in the
	       // chunk posts. Keeping it bloats the manifest to 20K+ chars unnecessarily.
	       const {html: _manifestHtml, ...manifestSummary} = manifestPrimaryPayload || {}
	       const originPayload = {
		       u: uuid,
		       primary: manifestSummary,
		       chunks: chunkManifest,
	       }
	       const originMedia = normalizedPrimaryMedia.map((entry) => ({...entry}))
	       if (originMedia.length > 0) {
		       originMedia[0] = {
			       ...originMedia[0],
			       alt: JSON.stringify(originPayload),
		       }
	       }

	       let originText = String(postText || "")
	       if (!originMedia.length && chunkUris.length > 0) {
		       const manifestText = buildOriginManifestText(chunkManifest)
		       originText = originText
			       ? `${originText}\n\n${manifestText}`
			       : manifestText
	       }

	       const originFd = new FormData()
	       // Defensive: ensure text is always present and non-empty
	       if (!originText || !originText.trim()) {
		       console.error("[bskyChunkStore] Refusing to publish: missing or empty post text", { originText })
		       throw new Error("Post text is required and was blank at publish time.")
	       }
	       originFd.append("text", originText)
	       if (postType) originFd.append("postType", postType)
	       if (normalizedTags.length > 0) {
		       originFd.append("tags", JSON.stringify(normalizedTags))
	       }
	       if (originMedia.length > 0) {
		       originFd.append("uploadedMedia", JSON.stringify(originMedia))
	       }
	       // Debug: log outgoing FormData text value
	       if (typeof window !== "undefined") {
		       console.debug("[bskyChunkStore] Publishing with text:", originText)
	       }

	       const originJson = await postToBskyApi(fetchImpl, endpoint, originFd)

	       return {
		       originResult: originJson?.result || null,
		       primaryResult: originJson?.result || null,
		       chunkResults,
		       totalChunkPosts: chunkResults.length,
		       chunkCount: normalizedChunks.length,
		       primaryChunkCount: 0,
		       replyChunkCount: 0,
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

function summarizeChunkPayloadIndexes(payloads = []) {
	const indexes = [...new Set(
		(Array.isArray(payloads) ? payloads : [])
			.map((payload) => Number(payload?.i || 0))
			.filter((index) => Number.isFinite(index) && index > 0),
	)]
		.sort((a, b) => a - b)
	return indexes
}

function buildMissingIndexList(indexes = [], total = 0) {
	const present = new Set(Array.isArray(indexes) ? indexes : [])
	const missing = []
	for (let i = 1; i <= total; i += 1) {
		if (!present.has(i)) missing.push(i)
	}
	return missing
}

function collectPostsFromThreadNode(node, posts = [], seenUris = new Set()) {
	if (!node || typeof node !== "object") return posts

	const post = node?.post && typeof node.post === "object" ? node.post : null
	if (post) {
		const uri = String(post?.uri || "")
		if (uri && !seenUris.has(uri)) {
			seenUris.add(uri)
			posts.push(post)
		}
	}

	if (
		node?.uri &&
		node?.author &&
		typeof node?.uri === "string" &&
		!seenUris.has(node.uri)
	) {
		seenUris.add(node.uri)
		posts.push(node)
	}

	if (Array.isArray(node?.replies)) {
		for (const reply of node.replies) {
			collectPostsFromThreadNode(reply, posts, seenUris)
		}
	}

	if (node?.parent && typeof node.parent === "object") {
		collectPostsFromThreadNode(node.parent, posts, seenUris)
	}

	return posts
}

async function fetchThreadPostsFromPublicBsky(fetchImpl, uri, debugLog, warnLog) {
	const targetUri = String(uri || "").trim()
	if (!targetUri) return []
	const threadUrl = `${BSKY_PUBLIC_XRPC}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(targetUri)}&depth=100&parentHeight=100`

	try {
		const response = await fetchImpl(threadUrl)
		debugLog("thread response", {
			uri: targetUri,
			status: response.status,
			ok: response.ok,
		})
		if (!response.ok) return []
		const json = await response.json().catch(() => ({}))
		const thread = json?.thread
		const posts = collectPostsFromThreadNode(thread, [], new Set())
		debugLog("thread posts", {
			uri: targetUri,
			count: posts.length,
			uris: posts.map((post) => String(post?.uri || "")).filter(Boolean),
		})
		return posts
	} catch (error) {
		warnLog("thread fetch failed", {
			uri: targetUri,
			error: error?.message || String(error),
		})
		return []
	}
}

async function fetchAuthorFeedPostsFromPublicBsky(
	fetchImpl,
	author,
	options = {},
	debugLog = () => {},
	warnLog = () => {},
) {
	const actor = String(author || "").trim()
	if (!actor) return []

	const maxPages = Math.max(1, Number(options?.maxPages || 6))
	const pageLimit = Math.max(1, Math.min(100, Number(options?.pageLimit || 100)))
	const postsByUri = new Map()
	let cursor = ""

	for (let page = 1; page <= maxPages; page += 1) {
		const feedUrl = `${BSKY_PUBLIC_XRPC}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${encodeURIComponent(String(pageLimit))}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
		try {
			const response = await fetchImpl(feedUrl)
			debugLog("author feed response", {
				page,
				status: response.status,
				ok: response.ok,
				feedUrl,
			})
			if (!response.ok) break

			const json = await response.json().catch(() => ({}))
			const items = Array.isArray(json?.feed) ? json.feed : []
			const pagePosts = items
				.map((item) => (item && typeof item === "object" ? item.post : null))
				.filter((post) => post && typeof post === "object")

			for (const post of pagePosts) {
				const uri = String(post?.uri || "").trim()
				if (!uri || postsByUri.has(uri)) continue
				postsByUri.set(uri, post)
			}

			debugLog("author feed page", {
				page,
				itemCount: items.length,
				postCount: pagePosts.length,
				totalCollected: postsByUri.size,
			})

			const nextCursor = String(json?.cursor || "").trim()
			if (!nextCursor || items.length === 0) break
			cursor = nextCursor
		} catch (error) {
			warnLog("author feed fetch failed", {
				page,
				error: error?.message || String(error),
			})
			break
		}
	}

	return Array.from(postsByUri.values())
}

export function extractImagesFromPost(post = {}) {
	const embed = post?.embed || post?.record?.embed
	const media =
		embed?.$type === "app.bsky.embed.recordWithMedia#view" || embed?.$type === "app.bsky.embed.recordWithMedia"
			? embed.media
			: embed
	const images =
		media?.$type === "app.bsky.embed.images#view" || media?.$type === "app.bsky.embed.images" || Array.isArray(media?.images)
			? media.images || []
			: []
	return images
}

export function collectChunkPayloadsFromPosts(posts = [], {uuid} = {}) {
	const expectedUuid = String(uuid || "")
	const byIndex = new Map()

	for (const post of Array.isArray(posts) ? posts : []) {
		const images = extractImagesFromPost(post)
		for (const image of images) {
			const payload = parseChunkPayloadFromAlt(image?.alt || "")
			if (!payload) continue
			const payloadUuid = String(payload?.u || payload?.uuid || "")
			if (payloadUuid !== expectedUuid) {
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
	const indexes = summarizeChunkPayloadIndexes(payloads)
	const total = Math.max(...payloads.map((payload) => Number(payload?.t || 0), 0))
	if (!total || indexes.length < total) {
		const missing = total > 0 ? buildMissingIndexList(indexes, total) : []
		const details = {
			total,
			foundCount: indexes.length,
			indexes,
			missing,
		}
		const error = new Error(
			`Profile payload is incomplete (found ${indexes.length}/${total || "?"} chunks)`
		)
		error.details = details
		throw error
	}
	const fragments = new Array(total).fill("")
	for (const payload of payloads) {
		const index = Number(payload?.i || 0)
		if (!Number.isFinite(index) || index <= 0 || index > total) continue
		fragments[index - 1] = inflateChunkAltPayloadHtml(payload)
	}
	if (fragments.some((entry) => !entry)) {
		const missing = fragments
			.map((entry, index) => ({entry, index: index + 1}))
			.filter(({entry}) => !entry)
			.map(({index}) => index)
		const error = new Error(
			`Profile payload is missing chunk data (missing indexes: ${missing.join(",")})`,
		)
		error.details = {
			total,
			indexes,
			missing,
		}
		throw error
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

function resolvePostThreadRootUri(post = {}) {
	const explicitRoot = String(
		post?.reply?.root?.uri || post?.record?.reply?.root?.uri || "",
	).trim()
	if (explicitRoot) return explicitRoot
	return String(post?.uri || "").trim()
}

export async function loadMostRecentProfileBundleFromPublicBsky({
	fetchImpl = fetch,
	uuid,
	author = "love4dogs.club",
	debug = false,
	maxPages = 8,
	pageLimit = 100,
} = {}) {
	const debugLog = (...args) => {
		if (debug) console.log("[bskyChunkStore]", ...args)
	}
	const warnLog = (...args) => {
		if (debug) console.warn("[bskyChunkStore]", ...args)
	}

	const id = String(uuid || "").trim()
	if (!id) throw new Error("Missing uuid route param")
	const postsByUri = new Map()
	const searchQueries = [`${id} profile`].filter(Boolean)
	for (const query of searchQueries) {
		const searchUrl = `${BSKY_PUBLIC_XRPC}/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&author=${encodeURIComponent(author)}&limit=1`
		try {
			const response = await fetchImpl(searchUrl)
			debugLog("latest-by-uuid public search response", {
				query,
				status: response.status,
				ok: response.ok,
				searchUrl,
			})
			if (!response.ok) continue
			const json = await response.json().catch(() => ({}))
			const searchPosts = Array.isArray(json?.posts) ? json.posts : []
			for (const post of searchPosts) {
				const uri = String(post?.uri || "").trim()
				if (!uri || postsByUri.has(uri)) continue
				postsByUri.set(uri, post)
			}
		} catch (error) {
			warnLog("latest-by-uuid public search failed", {
				query,
				error: error?.message || String(error),
			})
		}
	}

	// 2. Fetch page 1 of the author feed
	const actor = String(author || "").trim()
	if (actor) {
		const feedUrl = `${BSKY_PUBLIC_XRPC}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${encodeURIComponent(String(pageLimit))}`
		try {
			const response = await fetchImpl(feedUrl)
			debugLog("author feed response", {
				page: 1,
				status: response.status,
				ok: response.ok,
				feedUrl,
			})
			if (response.ok) {
				const json = await response.json().catch(() => ({}))
				const items = Array.isArray(json?.feed) ? json.feed : []
				const pagePosts = items
					.map((item) => (item && typeof item === "object" ? item.post : null))
					.filter((post) => post && typeof post === "object")

				for (const post of pagePosts) {
					const uri = String(post?.uri || "").trim()
					if (!uri || postsByUri.has(uri)) continue
					postsByUri.set(uri, post)
				}
				debugLog("author feed page", {
					page: 1,
					itemCount: items.length,
					postCount: pagePosts.length,
					totalCollected: postsByUri.size,
				})
			}
		} catch (error) {
			warnLog("author feed page 1 fetch failed", {
				actor,
				error: error?.message || String(error),
			})
		}
	}

	const posts = Array.from(postsByUri.values())

	debugLog("latest-by-uuid author feed scan", {
		uuid: id,
		postCount: posts.length,
	})

	// Try resolving with manifest candidates from search + page 1 posts first
	const originCandidates = collectOriginPayloadCandidatesFromPosts(posts, {
		uuid: id,
	})

	let lastError = null
	for (const candidate of originCandidates) {
		try {
			const manifestPosts = await fetchPostsByUrisFromPublicBsky(
				fetchImpl,
				candidate.chunkUris,
				debugLog,
				warnLog,
			)
			const mergedByUri = new Map()
			for (const post of [candidate.post, ...manifestPosts]) {
				const uri = String(post?.uri || "").trim()
				if (!uri || mergedByUri.has(uri)) continue
				mergedByUri.set(uri, post)
			}
			const candidatePosts = Array.from(mergedByUri.values())
			const payloads = collectChunkPayloadsFromPosts(candidatePosts, {uuid: id})

			debugLog("latest-by-uuid manifest candidate", {
				uuid: id,
				originUri: candidate.originUri,
				manifestChunkPostCount: candidate.chunkUris.length,
				recoveredChunkPayloadCount: payloads.length,
			})

			if (payloads.length > 0) {
				const reconstructed = reconstructBundleFromChunkPayloads(payloads)
				return {
					uuid: id,
					posts: candidatePosts,
					payloads,
					originPayload: candidate.originPayload,
					chunkUris: candidate.chunkUris,
					...reconstructed,
				}
			}
		} catch (error) {
			lastError = error
			warnLog("latest-by-uuid manifest reconstruction failed", {
				uuid: id,
				originUri: candidate.originUri,
				chunkUris: candidate.chunkUris,
				error: error?.message || String(error),
				details: error?.details || null,
			})
		}
	}

	const groupsByRevision = new Map()

	for (const post of posts) {
		const rootUri = resolvePostThreadRootUri(post)
		if (!rootUri) continue
		const postTimestampMs = resolvePostTimestampMs(post)

		const images = extractImagesFromPost(post)

		for (const image of images) {
			const payload = parseChunkPayloadFromAlt(image?.alt || "")
			if (!payload) continue
			const payloadUuid = String(payload?.u || payload?.uuid || "")
			if (payloadUuid !== id) continue
			const legacyToken = String(payload?.v || payload?.version || "").trim()
			const groupKey = legacyToken
				? `legacy:${legacyToken}`
				: `root:${rootUri}`

			const index = Number(payload?.i || 0)
			if (!Number.isFinite(index) || index <= 0) continue

			if (!groupsByRevision.has(groupKey)) {
				groupsByRevision.set(groupKey, {
					groupKey,
					legacyToken,
					rootUri,
					byIndex: new Map(),
					latestMs: postTimestampMs,
					seedUris: new Set(),
				})
			}
			const group = groupsByRevision.get(groupKey)
			group.latestMs = Math.max(group.latestMs, postTimestampMs)
			group.seedUris.add(String(post?.uri || "").trim())
			group.seedUris.add(rootUri)
			if (!group.byIndex.has(index)) group.byIndex.set(index, payload)
		}
	}

	const groups = Array.from(groupsByRevision.values()).sort(
		(a, b) => b.latestMs - a.latestMs,
	)

	debugLog("latest-by-uuid candidate groups", {
		uuid: id,
		groupCount: groups.length,
		originCandidateCount: originCandidates.length,
		groups: groups.map((group) => ({
			groupKey: group.groupKey,
			rootUri: group.rootUri,
			chunkCount: group.byIndex.size,
			latestMs: group.latestMs,
		})),
	})

	for (const group of groups) {
		const seedUris = Array.from(group.seedUris).filter(Boolean)
		const seedPosts = posts.filter((post) => {
			const uri = String(post?.uri || "").trim()
			return uri && seedUris.includes(uri)
		})
		const threadResults = await Promise.all(
			seedUris.map((uri) =>
				fetchThreadPostsFromPublicBsky(
					fetchImpl,
					uri,
					debugLog,
					warnLog,
				),
			),
		)
		const threadPosts = threadResults.flat()
		const postsByUri = new Map()
		for (const post of [...seedPosts, ...threadPosts]) {
			const uri = String(post?.uri || "").trim()
			if (!uri || postsByUri.has(uri)) continue
			postsByUri.set(uri, post)
		}
		const groupPosts = Array.from(postsByUri.values())
		const payloads = collectChunkPayloadsFromPosts(groupPosts, {uuid: id})
		if (!payloads.length) continue
		try {
			const reconstructed = reconstructBundleFromChunkPayloads(payloads)
			debugLog("latest-by-uuid reconstruction success", {
				uuid: id,
				groupKey: group.groupKey,
				rootUri: group.rootUri,
				chunkCount: payloads.length,
			})
			return {
				uuid: id,
				posts: groupPosts,
				payloads,
				...reconstructed,
			}
		} catch (error) {
			lastError = error
			warnLog("latest-by-uuid reconstruction failed", {
				uuid: id,
				groupKey: group.groupKey,
				rootUri: group.rootUri,
				error: error?.message || String(error),
				details: error?.details || null,
			})

			if (typeof window === "undefined" && group.legacyToken) {
				const fallbackQuery = `${id} ${group.legacyToken}`.trim()
				const fallbackSearchUrl = `${BSKY_PUBLIC_XRPC}/app.bsky.feed.searchPosts?q=${encodeURIComponent(fallbackQuery)}&author=${encodeURIComponent(author)}&limit=${encodeURIComponent(String(pageLimit))}`
				try {
					const response = await fetchImpl(fallbackSearchUrl)
					if (response.ok) {
						const json = await response.json().catch(() => ({}))
						const fallbackPosts = Array.isArray(json?.posts) ? json.posts : []
						const mergedByUri = new Map()
						for (const post of [...groupPosts, ...fallbackPosts]) {
							const uri = String(post?.uri || "").trim()
							if (!uri || mergedByUri.has(uri)) continue
							mergedByUri.set(uri, post)
						}

						const fallbackSeedUris = Array.from(mergedByUri.values())
							.map((post) => String(post?.uri || "").trim())
							.filter(Boolean)
						const fallbackThreads = await Promise.all(
							fallbackSeedUris.map((uri) =>
								fetchThreadPostsFromPublicBsky(
									fetchImpl,
									uri,
									debugLog,
									warnLog,
								),
							),
						)
						for (const post of fallbackThreads.flat()) {
							const uri = String(post?.uri || "").trim()
							if (!uri || mergedByUri.has(uri)) continue
							mergedByUri.set(uri, post)
						}

						const expandedPosts = Array.from(mergedByUri.values())
						const expandedPayloads = collectChunkPayloadsFromPosts(
							expandedPosts,
							{uuid: id},
						)
						if (expandedPayloads.length > payloads.length) {
							const reconstructed = reconstructBundleFromChunkPayloads(
								expandedPayloads,
							)
							debugLog(
								"latest-by-uuid fallback reconstruction success",
								{
									uuid: id,
									groupKey: group.groupKey,
									legacyToken: group.legacyToken,
									chunkCount: expandedPayloads.length,
								},
							)
							return {
								uuid: id,
								posts: expandedPosts,
								payloads: expandedPayloads,
								...reconstructed,
							}
						}
					}
				} catch (fallbackError) {
					warnLog("latest-by-uuid fallback search failed", {
						uuid: id,
						groupKey: group.groupKey,
						legacyToken: group.legacyToken,
						error: fallbackError?.message || String(fallbackError),
					})
				}
			}
		}
	}

	for (const post of posts) {
		const images = extractImagesFromPost(post)
		for (const image of images) {
			const alt = String(image?.alt || "")
			if (!alt) continue
			let parsed
			try {
				parsed = JSON.parse(alt)
			} catch {
				continue
			}
			if (!parsed || typeof parsed !== "object") continue

			const payloadUuid = String(parsed?.uuid || parsed?.u || "")
			if (payloadUuid !== id) continue

			if (parsed?.primary && Array.isArray(parsed?.subsequent)) {
				const serialized = JSON.stringify(parsed)
				return {
					uuid: id,
					posts: [post],
					payloads: [],
					combinedJson: serialized,
					combined: parsed,
					fragments: [serialized],
				}
			}

			if (parsed?.canonicalurl || parsed?.name || parsed?.description) {
				const combined = {
					primary: parsed,
					subsequent: [],
				}
				const serialized = JSON.stringify(combined)
				return {
					uuid: id,
					posts: [post],
					payloads: [],
					combinedJson: serialized,
					combined,
					fragments: [serialized],
				}
			}
		}
	}

	if (lastError) throw lastError
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

function normalizeChunkUriList(uris = []) {
	return [...new Set(
		(Array.isArray(uris) ? uris : [])
			.map((uri) => String(uri || "").trim())
			.filter((uri) => isValidPostAtUri(uri)),
	)]
}

function parseChunkUriManifest(manifest = "") {
	if (Array.isArray(manifest)) {
		return normalizeChunkUriList(manifest)
	}

	const source = String(manifest || "").trim()
	if (!source) return []

	const matches = source.match(/at:\/\/[^\s]+\/app\.bsky\.feed\.post\/[^\s]+/gi) || []
	return normalizeChunkUriList(matches)
}

function parseOriginPayloadValue(value = "", expectedUuid = "") {
	const source = String(value || "").trim()
	if (!source) return null

	let parsed
	try {
		parsed = JSON.parse(source)
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== "object") return null
	if (!("primary" in parsed) || !("chunks" in parsed)) return null

	const payloadUuid = String(parsed?.u || parsed?.uuid || parsed?.primary?.uuid || "").trim()
	if (expectedUuid && payloadUuid !== expectedUuid) return null

	const chunkUris = parseChunkUriManifest(parsed?.chunks)
	if (!chunkUris.length) return null

	return {
		...parsed,
		uuid: payloadUuid,
		chunkUris,
	}
}

function collectOriginPayloadCandidatesFromPosts(posts = [], {uuid} = {}) {
	const expectedUuid = String(uuid || "").trim()
	const candidates = []
	const seenKeys = new Set()

	for (const post of Array.isArray(posts) ? posts : []) {
		const valuesToInspect = []
		const text = String(post?.record?.text || post?.text || "").trim()
		if (text) valuesToInspect.push(text)

		const images = extractImagesFromPost(post)
		for (const image of images) {
			const alt = String(image?.alt || "").trim()
			if (alt) valuesToInspect.push(alt)
		}

		for (const value of valuesToInspect) {
			const parsed = parseOriginPayloadValue(value, expectedUuid)
			if (!parsed) continue
			const postUri = String(post?.uri || "").trim()
			const key = `${postUri}:${parsed.chunkUris.join("|")}`
			if (seenKeys.has(key)) continue
			seenKeys.add(key)
			candidates.push({
				post,
				originUri: postUri,
				originPayload: parsed,
				chunkUris: parsed.chunkUris,
				timestampMs: resolvePostTimestampMs(post),
			})
		}
	}

	return candidates.sort((a, b) => b.timestampMs - a.timestampMs)
}

async function fetchPostsByUrisFromPublicBsky(
	fetchImpl,
	uris = [],
	debugLog = () => {},
	warnLog = () => {},
) {
	const normalizedUris = normalizeChunkUriList(uris)
	if (!normalizedUris.length) return []

	const results = []
	const batchSize = 5
	for (let i = 0; i < normalizedUris.length; i += batchSize) {
		const batch = normalizedUris.slice(i, i + batchSize)
		const batchResults = await Promise.all(
			batch.map(async (uri) => {
				try {
					const posts = await fetchThreadPostsFromPublicBsky(
						fetchImpl,
						uri,
						debugLog,
						warnLog,
					)
					if (!posts.length) {
						debugLog("manifest uri produced no posts", {uri})
					}
					return posts
				} catch (error) {
					warnLog("manifest uri fetch failed", {
						uri,
						error: error?.message || String(error),
					})
					return []
				}
			})
		)
		results.push(...batchResults)
	}

	const postsByUri = new Map()
	for (const post of results.flat()) {
		const uri = String(post?.uri || "").trim()
		if (!uri || postsByUri.has(uri)) continue
		postsByUri.set(uri, post)
	}
	return Array.from(postsByUri.values())
}

function buildChunkUriManifest(uris = []) {
	const normalizedUris = normalizeChunkUriList(uris)
	if (!normalizedUris.length) return ""
	return normalizedUris.map((uri, index) => `${index + 1}. ${uri}`).join("\n")
}

function buildOriginManifestText(chunkManifest = []) {
	const chunkUris = parseChunkUriManifest(chunkManifest)
	if (!chunkUris.length) return "No chunks available."
	const manifestLines = chunkUris.map((uri, index) => `Chunk ${index + 1}: ${uri}`)
	return `Chunk Manifest:\n\n${manifestLines.join("\n")}`
}
