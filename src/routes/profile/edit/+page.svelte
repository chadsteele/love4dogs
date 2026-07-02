<script>
	import {onMount} from "svelte"
	import {page} from "$app/state"
	import {goto} from "$app/navigation"
	import {Eraser, Save, Send, X, MapPin} from "lucide-svelte"
	import Editor from "$lib/Editor.svelte"
	import NavBar from "$lib/NavBar.svelte"
	import ProfileImages from "$lib/ProfileImages.svelte"
	import LocationModal from "$lib/LocationModal.svelte"
	import ContactInput from "$lib/ContactInput.svelte"
	import HashTagCloud from "$lib/HashTagCloud.svelte"
	import {
		buildCanonicalUrl,
		buildLocationBlock,
		cleanCanonicalName,
		CONTACT_LOCK_PREFIX,
		decryptContact,
		encryptContact,
		isContactEncrypted,
		normalizeContactInput,
		lookupLocationDetails,
		mediaTokenFromFile,
		mediaTokenFromOrigin,
		expandMinifiedHtmlTags,
		minifyHtml,
		upsertApproxPostInCache,
		slowScrollIntoView,
	} from "$lib/utils"
	import {
		hasRequiredLocationParts,
		buildCompleteAddress,
		addressOkay,
	} from "$lib/locationUtils"
	import {
		getCurrentProfileUuid,
		readStoredProfileByUuid,
		setCurrentProfileUuid,
		upsertStoredProfile,
		writeStoredProfileByUuid,
	} from "$lib/profileRegistry"
	import {
		buildCombinedPayloadBundle as buildBskyCombinedPayloadBundle,
		buildChunkEntriesFromBundle,
		chunkHtmlByAltPayload,
		measureChunkAltPayloadLength as measureBskyChunkAltPayloadLength,
		publishChunkBundleToBsky,
		replacePostUriViaApi,
		loadMostRecentProfileBundleFromPublicBsky,
	} from "$lib/bskyChunkStore"
	import {
		buildCompressedTimestamp,
		formatLocalTime,
		resolvePostTimestampMs,
		parseTimestampMs,
	} from "$lib/dateTime"
	import ShowAdmin from "$lib/ShowAdmin.svelte"
	import {enqueueSync, setOfflineImage, setPost, setProfile} from "$lib/db"
	import {
		buildLocalImageProxyUrl,
		collectUrlTextNodes,
		convertPlainUrlsToAnchors,
		extensionFromMimeType,
		getBlobCid,
		isBskyHostedUrl,
		isLikelyImageUrl,
		isLikelyVideoUrl,
		isLocalImageProxyUrl,
		materializeInlineMediaFromLinks,
		normalizeThirdPartyMediaUrl,
		normalizeThirdPartyMediaUrlsInRoot,
		proxyExternalImageUrlsInRoot,
		replaceMediaUrlInHtml,
		resolveUploadSourceUrl,
		tryDecodeUrlComponent,
		loadImageFile,
		canvasToPngBlob,
		replaceFileExt,
		normalizeImageForSlot,
		isInlineMediaDataUrl,
		stripInlineMediaDataUrlsFromHtml,
	} from "$lib/editorMediaInterop"

	const LEGACY_PROFILE_STORAGE_KEY = "love4dogs.profile-v2"
	const PROFILE_VIEW_CACHE_PREFIX = "love4dogs.profile-view-cache"
	const SESSION_BUNDLE_CACHE_PREFIX = "love4dogs.bundle-session"
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
	const POST_EDIT_PATH_PREFIX = "/post/edit/"
	const EPOCH_OFFSET = 946684740000

	const getOfflineId = (url) => {
		if (typeof url !== 'string') return null;
		const match = url.match(/\/offline-media\/([a-zA-Z0-9-]+)/);
		return match ? match[1] : null;
	};

	let uuid = $state("")

	let email = $state("")
	let pin = $state("")
	let enteredPin = $state("")
	let isUnlocked = $state(true)
	let touchedPin = $state(false)
	let pinInputEl = $state(null)
	let unlockError = $state("")
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
	let profileImageWrapEl = $state(null)
	let profileNameInputEl = $state(null)
	let emailInputEl = $state(null)
	let storageReady = $state(false)
	let initialProfileSnapshot = null
	let storedSnapshotBaseline = null
	let hasChangedFromStoredSnapshot = $state(false)
	let existingProfileAtUri = $state("")
	let clearSnapshot = null
	let showUndo = $state(false)
	let clearUndoTimer = null
	let suppressAutosave = false
	let lastAutosaveSnapshot = ""
	let profileRecordStamp = $state(buildCompressedTimestamp())
	let postTags = $state([])

	function togglePostTag(tag) {
		if (postTags.includes(tag)) {
			postTags = postTags.filter((t) => t !== tag)
		} else {
			postTags = [...postTags, tag]
		}
		activateValidation()
	}

	let minifiedChunkEntries = $state([])
	let chunkBuildVersion = 0
	const cdnPromotionMeta = new Map()
	const editorUploadCache = new Map()
	let failedCdnUrls = $state(new Set())

	const isPostEditRoute = $derived.by(() => {
		const pathname = String(page.url?.pathname || "")
		return pathname === "/post/edit" || pathname.startsWith(POST_EDIT_PATH_PREFIX)
	})

	function debugProfile(...args) {
		if (DEBUG_PROFILE) console.log(...args)
	}

	function warnProfile(...args) {
		if (DEBUG_PROFILE) console.warn(...args)
	}

	function generateShortUuid() {
		return Math.random().toString(36).slice(2, 10)
	}

	function resolveRootAtUriFromPost(post = {}) {
		const root = String(
			post?.reply?.root?.uri ||
				post?.record?.reply?.root?.uri ||
				post?.uri ||
				"",
		).trim()
		return /^at:\/\//i.test(root) ? root : ""
	}

	function extractRootAtUriFromBundle(bundle = null, expectedUuid = "") {
		const direct = String(bundle?.rootUri || bundle?.atUri || "").trim()
		if (/^at:\/\//i.test(direct)) return direct

		const targetUuid = String(expectedUuid || "").trim()
		const posts = Array.isArray(bundle?.posts) ? bundle.posts : []
		let bestRoot = ""
		let bestMs = 0

		for (const post of posts) {
			const rootAtUri = resolveRootAtUriFromPost(post)
			if (!rootAtUri) continue

			let hasMatchingPayload = false
			const embed = post?.embed
			const media =
				embed?.$type === "app.bsky.embed.recordWithMedia#view"
					? embed.media
					: embed
			const images =
				media?.$type === "app.bsky.embed.images#view"
					? media.images || []
					: []

			for (const image of images) {
				let parsed = null
				try {
					parsed = JSON.parse(String(image?.alt || ""))
				} catch {
					parsed = null
				}
				if (!parsed || typeof parsed !== "object") continue
				const payloadUuid = String(
					parsed?.u || parsed?.uuid || "",
				).trim()
				if (targetUuid && payloadUuid !== targetUuid) continue
				hasMatchingPayload = true
				break
			}

			if (!hasMatchingPayload) continue

			const ms = resolvePostTimestampMs(post)
			if (!bestRoot || ms >= bestMs) {
				bestRoot = rootAtUri
				bestMs = ms
			}
		}

		return bestRoot
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
		const sourceUrl = await mediaTokenFromFile(file)
		if (!sourceUrl) {
			throw new Error(`Missing media origin for ${file.name}.`)
		}
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

	async function uploadExternalMediaUrl(
		url,
		preferredKind = "",
		originUrl = "",
	) {
		const resolvedUrl = String(url || "").trim()
		const sourceUrl = String(originUrl || resolvedUrl).trim()
		const resolvedSourceUrl =
			resolveUploadSourceUrl(resolvedUrl) || resolvedUrl
		if (!resolvedSourceUrl) return null
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
			const token = await mediaTokenFromOrigin(sourceUrl)
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
				sourceUrl,
				alt: uploaded.alt || sourceUrl,
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
			const token = await mediaTokenFromOrigin(sourceUrl)
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
				sourceUrl,
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
			const dataOrigin = String(
				node.getAttribute("data-origin") ||
					node.getAttribute("data-original") ||
					"",
			).trim()
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
			if (mediaType === "image" && !dataOrigin) continue
			candidates.push({node, url, mediaType, dataOrigin})
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
									entry.dataOrigin,
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
				if (
					entry.dataOrigin &&
					entry.node.getAttribute("data-origin") !== entry.dataOrigin
				) {
					entry.node.setAttribute("data-origin", entry.dataOrigin)
					changed = true
				}
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
			const dataOrigin = String(
				node.getAttribute("data-origin") ||
					node.getAttribute("data-original") ||
					"",
			).trim()
			extractedMedia.push({
				kind: mediaType,
				alt:
					node.getAttribute("alt") ||
					node.getAttribute("title") ||
					existing?.alt ||
					uploaded?.alt ||
					"Media",
				sourceUrl:
					(mediaType === "image" ? dataOrigin : "") ||
					uploaded?.sourceUrl ||
					existing?.sourceUrl ||
					url,
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

	const selectedBackgroundImage = $derived(
		backgroundUploadedMedia.find((entry) => entry?.kind === "image") ||
			null,
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
		String(
			selectedProfileImage?.bskyUrl || selectedProfileImage?.url || "",
		),
	)
	const storedBackgroundImageSrc = $derived(
		String(
			selectedBackgroundImage?.bskyUrl ||
				selectedBackgroundImage?.url ||
				"",
		),
	)

	const nameError = $derived(
		!profileName.trim()
			? isPostEditRoute
				? "Title is required."
				: "Name is required."
			: "",
	)

	const canonicalurl = $derived.by(() => {
		return buildCanonicalUrl(uuid, profileName)
	})

	const emailError = $derived(
		isPostEditRoute
			? ""
			: !email.trim()
				? "Email is required."
				: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
					? "Enter a valid email address."
					: "",
	)

	const pinError = $derived(
		isPostEditRoute
			? ""
			: !pin.trim()
				? "PIN is required."
				: !/^\d{6}$/.test(pin.trim())
					? "PIN must be exactly 6 digits."
					: "",
	)

	const profileImageError = $derived(
		isPostEditRoute
			? ""
			: !selectedProfileImage
				? "Profile picture is required."
				: "",
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
					if (isBskyHostedUrl(entry.bskyUrl)) return false
					const url = String(entry.url || "")
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
		isPostEditRoute
			? false
			: uploadingProfileImage || uploadingBackgroundImage,
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

	let mediaUploadTimeout = $state(false)
	let uploadTimeoutTimer = null

	$effect(() => {
		const isBlocked = imageUploadActive || mediaUploadActive || (unresolvedEditorMediaCount > 0);
		if (isBlocked) {
			if (!uploadTimeoutTimer) {
				uploadTimeoutTimer = setTimeout(() => {
					console.log("[profile] Media upload/resolution timed out. Enabling publish button.");
					mediaUploadTimeout = true;
				}, 10000);
			}
		} else {
			if (uploadTimeoutTimer) {
				clearTimeout(uploadTimeoutTimer);
				uploadTimeoutTimer = null;
			}
			mediaUploadTimeout = false;
		}

		return () => {
			if (uploadTimeoutTimer) {
				clearTimeout(uploadTimeoutTimer);
				uploadTimeoutTimer = null;
			}
		};
	});

	const publishBlockedByMedia = $derived(
		!mediaUploadTimeout && (
			imageUploadActive ||
			mediaUploadActive ||
			unresolvedEditorMediaCount > 0
		)
	)

	const isFormValid = $derived(
		isPostEditRoute
			? !nameError && locationConfirmed
			: !nameError && !emailError && !pinError && !profileImageError && locationConfirmed
	)

	function encryptEmailForPayload(value = "") {
		const normalized = normalizeContactInput(value)
		if (!normalized) return ""
		return CONTACT_LOCK_PREFIX + encryptContact(normalized)
	}

	function encryptPinForPayload(pinStr, stamp) {
		const cleanPin = String(pinStr || "").trim()
		if (!cleanPin || cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
			return null
		}
		const timestamp = parseTimestampMs(stamp, {allowBase36: true})
		if (!timestamp) return null
		return (timestamp - EPOCH_OFFSET + Number(cleanPin)).toString(36)
	}

	const primaryPostPayload = $derived({
		uuid,
		authorid: uuid,
		stamp: profileRecordStamp,
		email: encryptEmailForPayload(email),
		birthdate: encryptPinForPayload(pin, profileRecordStamp),
		profileImage: isPostEditRoute
			? null
			: selectedProfileImage?.bskyUrl || selectedProfileImage?.url || null,
		profilePic: isPostEditRoute
			? null
			: selectedProfileImage?.bskyUrl || selectedProfileImage?.url || null,
		backgroundPic: isPostEditRoute
			? null
			: selectedBackgroundImage?.bskyUrl ||
			  selectedBackgroundImage?.url ||
			  null,
		name: profileName,
		description: profileDescription,
		tags: isPostEditRoute ? $state.snapshot(postTags) : ["profile"],
		address: locationConfirmed ? confirmedAddress : "",
		city: locationConfirmed ? confirmedLocation?.city || "" : "",
		state: locationConfirmed ? confirmedLocation?.state || "" : "",
		zip: locationConfirmed ? confirmedLocation?.zip || "" : "",
		country: locationConfirmed ? confirmedLocation?.country || "" : "",
		location: locationConfirmed && confirmedLocation ? {
			lat: confirmedLocation.lat,
			lon: confirmedLocation.lon,
			approximate: confirmedLocation.approximate,
			exact: confirmedLocation.exact,
			hashPath: confirmedLocation.hashPath,
			formattedAddress: confirmedLocation.formattedAddress,
			city: confirmedLocation.city || "",
			state: confirmedLocation.state || "",
			country: confirmedLocation.country || "",
			zip: confirmedLocation.zip || "",
		} : null,
	})

	const subsequentPostsPayload = $derived(
		minifiedChunkEntries.map((entry, index) => ({
			uuid,
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
				const bskyUrl = String(entry?.bskyUrl || "").trim()
				const url = String(entry?.url || "").trim()
				return Boolean(
					(blob &&
						(typeof blob === "object" ||
							typeof blob === "string")) ||
						bskyUrl ||
						url,
				)
			})
	}

	function decodePayloadEmail(value = "") {
		const raw = String(value || "").trim()
		if (!raw) return ""
		if (!isContactEncrypted(raw)) return normalizeContactInput(raw)
		try {
			return decryptContact(raw.slice(CONTACT_LOCK_PREFIX.length))
		} catch {
			return ""
		}
	}

	function buildMediaFromUrl(url = "", alt = "") {
		const cleanedUrl = String(url || "").trim()
		if (!cleanedUrl) return null
		return {
			kind: "image",
			alt: String(alt || "Image"),
			blob: null,
			url: cleanedUrl,
			bskyUrl: cleanedUrl,
			sourceUrl: cleanedUrl,
			sourceName: "remote",
		}
	}

	function buildBundleCacheKey(uuid = "") {
		return `${SESSION_BUNDLE_CACHE_PREFIX}:${uuid}`
	}

	function readBundleSessionCache(uuid = "") {
		if (typeof sessionStorage === "undefined") return null
		const cacheKey = buildBundleCacheKey(uuid)
		const raw = sessionStorage.getItem(cacheKey)
		if (!raw) return null
		try {
			return JSON.parse(raw)
		} catch {
			return null
		}
	}

	function buildProfileViewCacheKey(uuid = "") {
		return `${PROFILE_VIEW_CACHE_PREFIX}:${uuid}`
	}

	function readProfileViewCache(uuid = "") {
		if (typeof localStorage === "undefined") return null
		const cacheKey = buildProfileViewCacheKey(uuid)
		const raw = localStorage.getItem(cacheKey)
		if (!raw) return null
		try {
			const parsed = JSON.parse(raw)
			const data = parsed?.data
			if (!data || typeof data !== "object") return null
			return data
		} catch {
			return null
		}
	}

	function applyBundleToEditor(bundle = null, fallbackUuid = "") {
		const combined =
			bundle && typeof bundle === "object" && bundle.combined
				? bundle.combined
				: bundle?.parsed && typeof bundle.parsed === "object"
					? bundle.parsed
					: null
		const primary = combined?.primary || {}
		const subsequent = Array.isArray(combined?.subsequent)
			? combined.subsequent
			: []

		uuid =
			String(primary?.uuid || fallbackUuid || "") || generateShortUuid()
		email = decodePayloadEmail(primary?.email)
		let decryptedPin = ""
		if (primary?.birthdate) {
			const birthdateVal = parseInt(primary.birthdate, 36)
			const stampVal = primary.stamp
			if (birthdateVal && stampVal) {
				const timestamp = parseTimestampMs(stampVal, {allowBase36: true})
				if (timestamp) {
					const diff = birthdateVal - (timestamp - EPOCH_OFFSET)
					if (diff >= 0) {
						decryptedPin = String(diff).padStart(6, '0')
					}
				}
			}
		}
		pin = decryptedPin
		isUnlocked = !pin
		profileName = String(primary?.name || primary?.title || "")
		profileDescription = String(
			primary?.description || primary?.summary || "",
		)
		postTags = Array.isArray(primary?.tags) ? primary.tags : []
		const combinedSubsequentHtml = subsequent
			.map((entry) => String(entry || ""))
			.join("")
		contentHtml = expandMinifiedHtmlTags(
			combinedSubsequentHtml || String(primary?.html || ""),
		)
		profileUploadedMedia = normalizeStoredMedia([
			buildMediaFromUrl(primary?.profilePic, "Profile image"),
		])
		backgroundUploadedMedia = normalizeStoredMedia([
			buildMediaFromUrl(primary?.backgroundPic, "Profile background"),
		])
		editorMediaList = []
		existingProfileAtUri = extractRootAtUriFromBundle(bundle, uuid)
	}

	function applyViewCacheToEditor(data = {}, fallbackUuid = "") {
		uuid = String(data?.uuid || fallbackUuid || "") || generateShortUuid()
		email = decodePayloadEmail(data?.email)
		let decryptedPin = String(data?.pin || "")
		if (!decryptedPin && data?.birthdate) {
			const birthdateVal = parseInt(data.birthdate, 36)
			const stampVal = data.stamp
			if (birthdateVal && stampVal) {
				const timestamp = parseTimestampMs(stampVal, {allowBase36: true})
				if (timestamp) {
					const diff = birthdateVal - (timestamp - EPOCH_OFFSET)
					if (diff >= 0) {
						decryptedPin = String(diff).padStart(6, '0')
					}
				}
			}
		}
		pin = decryptedPin
		isUnlocked = !pin
		profileName = String(data?.name || data?.title || "")
		profileDescription = String(data?.description || data?.summary || "")
		postTags = Array.isArray(data?.tags) ? data.tags : []
		contentHtml = expandMinifiedHtmlTags(String(data?.html || ""))
		profileUploadedMedia = normalizeStoredMedia([
			buildMediaFromUrl(data?.profilePic, "Profile image"),
		])
		backgroundUploadedMedia = normalizeStoredMedia([
			buildMediaFromUrl(data?.backgroundPic, "Profile background"),
		])
		editorMediaList = []
		existingProfileAtUri = String(data?.rootUri || data?.atUri || "").trim()
	}

	function cloneStoredProfile(value) {
		return JSON.parse(JSON.stringify(value))
	}

	function getProfileIdentity(profile = {}) {
		return String(profile?.uuid || "")
	}

	function setStoredSnapshotBaseline(
		profile = buildStoredProfileForStorage(),
	) {
		storedSnapshotBaseline = cloneStoredProfile(profile)
		hasChangedFromStoredSnapshot = false
	}

	function buildStoredProfile() {
		return {
			uuid,
			existingProfileAtUri,
			email,
			pin,
			profileName,
			profileDescription,
			contentHtml,
			profileUploadedMedia,
			backgroundUploadedMedia,
			editorMediaList,
			locationConfirmed,
			confirmedAddress,
			confirmedLocation,
			tags: $state.snapshot(postTags),
		}
	}



	function filterMediaForStorage(list) {
		if (!Array.isArray(list)) return []
		return list.filter((entry) => {
			if (!entry || typeof entry !== "object") return false
			const blob = entry?.blob
			const bskyUrl = String(entry?.bskyUrl || "").trim()
			const url = String(entry?.url || "").trim()
			return Boolean(
				(blob &&
					(typeof blob === "object" || typeof blob === "string") &&
					bskyUrl) ||
					bskyUrl ||
					url,
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

	function shouldRegisterCurrentProfile(profile = {}) {
		if (isPostEditRoute) return false
		if (!profile || typeof profile !== "object") return false
		if (String(profile.profileName || "").trim()) return true
		if (String(profile.profileDescription || "").trim()) return true
		if (String(profile.email || "").trim()) return true
		if (String(profile.contentHtml || "").trim()) return true
		if (
			Array.isArray(profile.profileUploadedMedia) &&
			profile.profileUploadedMedia.length > 0
		) {
			return true
		}
		return false
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
		existingProfileAtUri = String(profile.existingProfileAtUri || "").trim()
		email = String(profile.email || "")
		pin = String(profile.pin || "")
		isUnlocked = !pin
		profileName = String(profile.profileName || "")
		profileDescription = String(profile.profileDescription || "")
		postTags = Array.isArray(profile.tags) ? profile.tags : []
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
		locationConfirmed = Boolean(profile.locationConfirmed || false)
		confirmedAddress = String(profile.confirmedAddress || "")
		confirmedLocation = profile.confirmedLocation || null
		if (confirmedLocation) {
			modalLocation = { ...confirmedLocation }
			addressText = confirmedAddress
		}
	}

	function validateRequiredFields() {
		const hasProfileImage = Boolean(
			selectedProfileImage?.blob ||
				selectedProfileImage?.bskyUrl ||
				selectedProfileImage?.url,
		)
		const submitProfileImageError =
			isPostEditRoute || hasProfileImage
				? ""
				: "Profile picture is required."
		const submitPinError = isPostEditRoute ? "" : pinError
		debugProfile("[profile] validateRequiredFields", {
			hasName: Boolean(profileName.trim()),
			hasEmail: Boolean(email.trim()),
			hasProfileImage: Boolean(uploadedProfileImage),
			hasSelectedProfileImage: Boolean(selectedProfileImage),
			nameError,
			emailError,
			pinError,
			profileImageError,
			submitProfileImageError,
		})
		return (
			nameError ||
			emailError ||
			submitPinError ||
			submitProfileImageError ||
			null
		)
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
		if (field === "pin") touchedPin = true
	}

	function handleFormFocusOut(event) {
		debugProfile("[profile] handleFormFocusOut", event.target)
		activateValidation()
		const target = event.target
		if (target) {
			if (target.placeholder === "Name" || target.placeholder === "Title") {
				touchedName = true
			}
			if (target.classList.contains("contact-input") || target.placeholder === "you@email.com") {
				touchedEmail = true
			}
			if (target.placeholder === "123456" || target.id === "pin" || target === pinInputEl) {
				touchedPin = true
			}
		}
	}

	function focusFirstInvalidField() {
		debugProfile("[profile] focusFirstInvalidField", {
			profileImageError,
			nameError,
			emailError,
			pinError,
		})
		if (!isPostEditRoute && profileImageError) {
			debugProfile("[profile] focusing profile image section")
			profileImageWrapEl?.focus()
			slowScrollIntoView(profileImageWrapEl, 3000)
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
			return
		}
		if (pinError) {
			debugProfile("[profile] focusing pin input")
			pinInputEl?.focus()
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

	$effect(() => {
		locationConfirmed = locationConfirmed && addressOkay(addressText, confirmedLocation)
		if (locationConfirmed) locationError = ""
	})

	function handleModalCancel() {
		showLocationModal = false
		pinMovedInModal = false
		locationError = ""
	}

	async function publishToBluesky() {
		debugProfile("[profile] publishToBluesky:start", {
			uuid,
			chunkCount: minifiedChunkEntries.length,
			editorMediaCount: editorMediaList.length,
		})
		activateValidation()
		touchedName = true
		touchedEmail = true
		touchedPin = true
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
			await saveProfile(false)
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
			locationError = "Location is required. Please confirm your location before publishing."
			modalLocation = modalLocation // Use existing modal location if available
			pinMovedInModal = false
			showLocationModal = true
			await saveProfile(false)
			return
		}

		publishing = true

		try {
			const resolvePublishImageCarrier = async (
				entry,
				fallbackAlt = "Image",
			) => {
				if (!entry || entry.kind !== "image") return null
				const alt = String(entry.alt || fallbackAlt)
				if (entry.blob) {
					return {
						...entry,
						kind: "image",
						alt,
					}
				}

				if (entry.file) {
					if (typeof navigator !== "undefined" && navigator.onLine === false) {
						const offlineId = Math.random().toString(36).slice(2, 10) + '-' + Date.now()
						await setOfflineImage(offlineId, entry.file)
						const offlineUrl = `/offline-media/${offlineId}`
						return {
							...entry,
							kind: "image",
							alt,
							url: offlineUrl,
							bskyUrl: offlineUrl,
							blob: {
								ref: {
									$link: offlineId
								},
								mimeType: entry.file.type || "image/png",
								size: entry.file.size
							},
							isOfflineMedia: true,
							offlineId: offlineId
						}
					}
					debugProfile("[profile] resolvePublishImageCarrier: uploading pending local file", entry.file.name)
					const uploaded = await uploadMediaFile(entry.file)
					return {
						...entry,
						kind: "image",
						alt,
						blob: uploaded.blob,
						bskyUrl: uploaded.bskyUrl || uploaded.url,
						url: uploaded.url,
					}
				}

				const sourceUrl = String(
					entry.bskyUrl || entry.url || "",
				).trim()
				if (!sourceUrl) return null

				const offlineId = getOfflineId(sourceUrl)
				if (offlineId || entry.isOfflineMedia) {
					return {
						...entry,
						kind: "image",
						alt,
						url: sourceUrl,
						bskyUrl: sourceUrl,
						isOfflineMedia: true,
						offlineId: offlineId || entry.offlineId
					}
				}

				if (typeof navigator !== "undefined" && navigator.onLine === false) {
					return {
						...entry,
						kind: "image",
						alt,
						url: sourceUrl,
						bskyUrl: sourceUrl
					}
				}

				if (!isBskyHostedUrl(sourceUrl)) return null

				const formData = new FormData()
				formData.append("mode", "resolve-cdn-blob")
				formData.append("sourceUrl", sourceUrl)
				const response = await fetch("/api/post", {
					method: "POST",
					body: formData,
				})
				const json = await response.json().catch(() => ({}))
				if (!response.ok || !json?.ok || !json?.blob) {
					throw new Error(
						json?.error ||
							"Unable to resolve existing CDN image for publishing.",
					)
				}

				return {
					...entry,
					kind: "image",
					alt,
					blob: json.blob,
					bskyUrl: String(json.url || sourceUrl),
					sourceUrl,
				}
			}

			if (typeof navigator !== "undefined" && navigator.onLine === false) {
				try {
					const publishProfileImage = await resolvePublishImageCarrier(
						selectedProfileImage,
						"Profile image",
					)
					const publishBackgroundImage = await resolvePublishImageCarrier(
						selectedBackgroundImage,
						"Profile background",
					)

					if (publishProfileImage) {
						profileUploadedMedia = [publishProfileImage]
					}
					if (publishBackgroundImage) {
						backgroundUploadedMedia = [publishBackgroundImage]
					}

					await saveProfile(false)

					const primaryPayloadForBundle = {
						type: isPostEditRoute ? "post" : "profile",
						uuid,
						authorid: uuid,
						stamp: profileRecordStamp,
						email: encryptEmailForPayload(email),
						birthdate: encryptPinForPayload(pin, profileRecordStamp),
						profileImage: isPostEditRoute
							? null
							: publishProfileImage?.bskyUrl ||
							  selectedProfileImage?.bskyUrl ||
							  selectedProfileImage?.url ||
							  null,
						profilePic: isPostEditRoute
							? null
							: publishProfileImage?.bskyUrl ||
							  selectedProfileImage?.bskyUrl ||
							  selectedProfileImage?.url ||
							  null,
						backgroundPic: isPostEditRoute
							? null
							: publishBackgroundImage?.bskyUrl ||
							  selectedBackgroundImage?.bskyUrl ||
							  selectedBackgroundImage?.url ||
							  null,
						name: profileName,
						description: profileDescription,
						tags: isPostEditRoute ? $state.snapshot(postTags) : ["profile"],
						address: locationConfirmed ? confirmedAddress : "",
						city: locationConfirmed ? confirmedLocation?.city || "" : "",
						state: locationConfirmed ? confirmedLocation?.state || "" : "",
						zip: locationConfirmed ? confirmedLocation?.zip || "" : "",
						country: locationConfirmed ? confirmedLocation?.country || "" : "",
						location: locationConfirmed && confirmedLocation ? {
							lat: confirmedLocation.lat,
							lon: confirmedLocation.lon,
							approximate: confirmedLocation.approximate,
							exact: confirmedLocation.exact,
							hashPath: confirmedLocation.hashPath,
							formattedAddress: confirmedLocation.formattedAddress,
							city: confirmedLocation.city || "",
							state: confirmedLocation.state || "",
							country: confirmedLocation.country || "",
							zip: confirmedLocation.zip || "",
						} : null,
					}
					const subsequentPayloadForBundle = mapSubsequentPayloadForBundle(
						subsequentPostsPayload,
					)
					const combinedBundle = buildBskyCombinedPayloadBundle(
						primaryPayloadForBundle,
						subsequentPayloadForBundle,
						{
							uuid: String(primaryPayloadForBundle?.uuid || uuid || ""),
							maxPayloadChars: CHUNK_ALT_PAYLOAD_TARGET_CHARS,
						},
					)
					const chunks = buildChunkEntriesFromBundle(combinedBundle)

					const postText = clampPostTextForApi(
						[
							profileName.trim(),
							profileDescription.trim(),
							locationConfirmed && confirmedLocation ? buildLocationBlock(confirmedLocation).trim() : ""
						]
							.filter(Boolean)
							.join("\n\n"),
					)

					const primaryMedia = []
					if (publishProfileImage) {
						primaryMedia.push({
							...publishProfileImage,
							kind: "image",
							alt: String(publishProfileImage.alt || "Profile image"),
						})
					}
					if (publishBackgroundImage) {
						primaryMedia.push({
							...publishBackgroundImage,
							kind: "image",
							alt: String(
								publishBackgroundImage.alt || "Profile background",
							),
						})
					}

					const imageAttachments = editorMediaList
						.filter((entry) => entry?.kind === "image")
						.map((entry) => ({
							kind: "image",
							alt: String(entry.alt || "Image"),
							blob: entry.blob,
							url: entry.url || entry.bskyUrl,
							bskyUrl: entry.bskyUrl || entry.url,
							isOfflineMedia: entry.isOfflineMedia,
							offlineId: entry.offlineId || getOfflineId(entry.url || entry.bskyUrl)
						}))
					const videoAttachments = editorMediaList
						.filter((entry) => entry?.kind === "video")
						.slice(0, 1)
						.map((entry) => ({
							kind: "video",
							alt: String(entry.alt || "Video"),
							blob: entry.blob,
							url: entry.url || entry.bskyUrl,
							bskyUrl: entry.bskyUrl || entry.url,
							isOfflineMedia: entry.isOfflineMedia,
							offlineId: entry.offlineId || getOfflineId(entry.url || entry.bskyUrl)
						}))
					const fallbackImage = publishProfileImage
						? [
								{
									kind: "image",
									alt: String(
										publishProfileImage.alt || "Profile image",
									),
									blob: publishProfileImage.blob,
									url: publishProfileImage.url || publishProfileImage.bskyUrl,
									bskyUrl: publishProfileImage.bskyUrl || publishProfileImage.url,
									isOfflineMedia: publishProfileImage.isOfflineMedia,
									offlineId: publishProfileImage.offlineId
								},
							]
						: []
					const attachmentPool =
						imageAttachments.length > 0
							? imageAttachments
							: primaryMedia.length > 0
								? primaryMedia
								: fallbackImage

					await enqueueSync({
						uuid,
						type: isPostEditRoute ? "post" : "profile",
						postText,
						chunks,
						primaryPayload: primaryPayloadForBundle,
						primaryMedia,
						replyAttachmentPool: attachmentPool,
						videoAttachments
					})

					publishMessage = ""
					publishError = "Offline. Your updates have been queued and will sync automatically when your internet connection is restored."
				} catch (err) {
					console.error("[profile] publishToBluesky:offline-queue-failed", err)
					publishError = err?.message || "Failed to queue publication offline."
				} finally {
					publishing = false
				}
				return
			}

			let previousAtUri = String(existingProfileAtUri || "").trim()
			if (!previousAtUri && uuid) {
				try {
					const existingBundleRes = await fetch(
						`/api/profile-bundle?uuid=${encodeURIComponent(uuid)}`,
					)
					const existingBundle = await existingBundleRes
						.json()
						.catch(() => ({}))
					if (existingBundleRes.ok) {
						previousAtUri = extractRootAtUriFromBundle(
							existingBundle,
							uuid,
						)
					}
				} catch {
					// Best effort only; if no prior URI is known we skip deletion.
				}
			}

			const publishProfileImage = await resolvePublishImageCarrier(
				selectedProfileImage,
				"Profile image",
			)
			const publishBackgroundImage = await resolvePublishImageCarrier(
				selectedBackgroundImage,
				"Profile background",
			)

			if (publishProfileImage) {
				profileUploadedMedia = [publishProfileImage]
			}
			if (publishBackgroundImage) {
				backgroundUploadedMedia = [publishBackgroundImage]
			}

			debugProfile("[profile] saving draft before publish")
			await saveProfile(false)

			const publishedSlugPath = cleanCanonicalName(profileName)
				.split("/")
				.map((segment) => segment.trim())
				.filter(Boolean)
				.map((segment) => encodeURIComponent(segment))
				.join("/")
			const publishedViewUrl = `/profile/view/${encodeURIComponent(uuid)}/${publishedSlugPath || "profile"}`
			profileRecordStamp = buildCompressedTimestamp()

			const subsequentPayloadForBundle = mapSubsequentPayloadForBundle(
				subsequentPostsPayload,
			)
			const primaryPayloadForBundle = {
				type: isPostEditRoute ? "post" : "profile",
				uuid,
				authorid: uuid,
				stamp: profileRecordStamp,
				email: encryptEmailForPayload(email),
				birthdate: encryptPinForPayload(pin, profileRecordStamp),
				profileImage:
					publishProfileImage?.bskyUrl ||
					selectedProfileImage?.bskyUrl ||
					selectedProfileImage?.url ||
					null,
				profilePic:
					publishProfileImage?.bskyUrl ||
					selectedProfileImage?.bskyUrl ||
					selectedProfileImage?.url ||
					null,
				backgroundPic:
					publishBackgroundImage?.bskyUrl ||
					selectedBackgroundImage?.bskyUrl ||
					selectedBackgroundImage?.url ||
					null,
				name: profileName,
				description: profileDescription,
				tags: isPostEditRoute ? $state.snapshot(postTags) : ["profile"],
				address: locationConfirmed ? confirmedAddress : "",
				city: locationConfirmed ? confirmedLocation?.city || "" : "",
				state: locationConfirmed ? confirmedLocation?.state || "" : "",
				zip: locationConfirmed ? confirmedLocation?.zip || "" : "",
				country: locationConfirmed ? confirmedLocation?.country || "" : "",
				location: locationConfirmed && confirmedLocation ? {
					lat: confirmedLocation.lat,
					lon: confirmedLocation.lon,
					approximate: confirmedLocation.approximate,
					exact: confirmedLocation.exact,
					hashPath: confirmedLocation.hashPath,
					formattedAddress: confirmedLocation.formattedAddress,
					city: confirmedLocation.city || "",
					state: confirmedLocation.state || "",
					country: confirmedLocation.country || "",
					zip: confirmedLocation.zip || "",
				} : null,
			}
			const combinedBundle = buildBskyCombinedPayloadBundle(
				primaryPayloadForBundle,
				subsequentPayloadForBundle,
				{
					uuid: String(primaryPayloadForBundle?.uuid || uuid || ""),
					maxPayloadChars: CHUNK_ALT_PAYLOAD_TARGET_CHARS,
				},
			)
			const chunks = buildChunkEntriesFromBundle(combinedBundle)

			// Build post text: name + description (≤300 chars enforced by the form)
			const postText = clampPostTextForApi(
				[
					profileName.trim(),
					profileDescription.trim(),
					locationConfirmed && confirmedLocation ? buildLocationBlock(confirmedLocation).trim() : ""
				]
					.filter(Boolean)
					.join("\n\n"),
			)
			debugProfile("[profile] primary post text prepared", {
				textLength: [...postText].length,
				textPreview: postText.slice(0, 80),
			})

			const primaryMedia = []
			if (publishProfileImage?.blob) {
				primaryMedia.push({
					...publishProfileImage,
					kind: "image",
					alt: String(publishProfileImage.alt || "Profile image"),
				})
			}
			if (publishBackgroundImage?.blob) {
				primaryMedia.push({
					...publishBackgroundImage,
					kind: "image",
					alt: String(
						publishBackgroundImage.alt || "Profile background",
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
			const fallbackImage = publishProfileImage
				? [
						{
							kind: "image",
							alt: String(
								publishProfileImage.alt || "Profile image",
							),
							blob: publishProfileImage.blob,
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
				postType: isPostEditRoute ? "post" : "profile",
				postText,
				chunks,
				primaryMedia,
				replyAttachmentPool: attachmentPool,
				videoAttachments,
				tags: isPostEditRoute ? $state.snapshot(postTags) : ["profile"],
				primaryPayload: primaryPayloadForBundle,
			})

			const newPublishedAtUri = String(
				publishResult?.primaryResult?.uri || "",
			).trim()
			existingProfileAtUri = newPublishedAtUri || previousAtUri

			if (
				previousAtUri &&
				newPublishedAtUri &&
				previousAtUri !== newPublishedAtUri
			) {
				await replacePostUriViaApi({
					fetchImpl: fetch,
					endpoint: "/api/post",
					previousUri: previousAtUri,
					nextUri: newPublishedAtUri,
				})
			}

			publishMessage = `Published profile + ${publishResult.totalChunkPosts} chunk${publishResult.totalChunkPosts === 1 ? "" : "s"} at ${formatLocalTime(Date.now())}`
			debugProfile("[profile] publishToBluesky:success", {
				message: publishMessage,
				viewUrl: publishedViewUrl,
			})
			await saveProfile(false)

			// Construct mock bundle for immediate loading / server cache
			const mockBundle = {
				uuid,
				posts: [
					// primary post
					{
						uri: newPublishedAtUri || `at://did:plc:local/app.bsky.feed.post/${uuid}`,
						cid: publishResult?.primaryResult?.cid || "local-pending",
						record: {
							text: postText,
							createdAt: new Date().toISOString(),
						},
						embed: {
							$type: "app.bsky.embed.images#view",
							images: primaryMedia.map(m => ({
								fullsize: m.bskyUrl || m.url || "",
								alt: m.alt || "",
							})),
						},
					},
					// chunks posts
					...(Array.isArray(publishResult?.chunkResults) ? publishResult.chunkResults.map((chunk, idx) => ({
						uri: chunk?.uri || "",
						cid: chunk?.cid || "",
						record: {
							text: postText,
							createdAt: new Date().toISOString(),
						},
						embed: {
							$type: "app.bsky.embed.images#view",
							images: [
								{
									fullsize: "",
									alt: JSON.stringify({
										u: uuid,
										i: idx + 1,
										t: chunks.length,
										h: chunks[idx]?.bundleFragment || "",
									}),
								}
							]
						}
					})) : []),
				],
				payloads: chunks.map((chunk, idx) => ({
					u: uuid,
					i: idx + 1,
					t: chunks.length,
					h: chunk?.bundleFragment || "",
				})),
				originPayload: {
					u: uuid,
					primary: primaryPayloadForBundle,
					chunks: Array.isArray(publishResult?.chunkResults) ? publishResult.chunkResults.map(c => c?.uri || "") : [],
				},
				chunkUris: Array.isArray(publishResult?.chunkResults) ? publishResult.chunkResults.map(c => c?.uri || "") : [],
				combinedJson: combinedBundle.combinedJson,
				combined: {
					primary: primaryPayloadForBundle,
					subsequent: mapSubsequentPayloadForBundle(subsequentPostsPayload),
				},
				fragments: combinedBundle.fragments,
			};

			// POST mock bundle to SvelteKit server API to cache it on the server
			try {
				await fetch("/api/profile-bundle", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ uuid, bundle: mockBundle }),
				});
			} catch (e) {
				console.warn("Failed to POST profile-bundle cache to server:", e);
			}

			// Local caches
			if (isPostEditRoute) {
				const postImages = editorMediaList
					.filter((entry) => entry?.kind === "image")
					.map((entry) => {
						const src = entry.bskyUrl || entry.url || "";
						return { src, alt: entry.alt || "Image" };
					});
				const postVideos = editorMediaList
					.filter((entry) => entry?.kind === "video")
					.map((entry) => {
						const src = entry.bskyUrl || entry.url || "";
						return { src, poster: entry.poster || "", alt: entry.alt || "Video" };
					});

				const postViewData = {
					uuid,
					uri: newPublishedAtUri || uuid,
					name: profileName,
					description: profileDescription,
					html: contentHtml,
					images: postImages,
					videos: postVideos,
					tags: $state.snapshot(postTags),
					likeCount: 0,
					repostCount: 0,
					replyCount: 0,
					createdAt: new Date().toISOString(),
					authorName: "My Profile",
					authorAvatar: "",
				};

				await setPost(uuid, postViewData);
				if (newPublishedAtUri) {
					await setPost(newPublishedAtUri, postViewData);
				}
			} else {
				const profileViewData = {
					uuid,
					name: profileName,
					description: profileDescription,
					html: contentHtml,
					profilePic:
						publishProfileImage?.bskyUrl ||
						selectedProfileImage?.bskyUrl ||
						selectedProfileImage?.url ||
						"",
					backgroundPic:
						publishBackgroundImage?.bskyUrl ||
						selectedBackgroundImage?.bskyUrl ||
						selectedBackgroundImage?.url ||
						"",
					likeCount: 0,
					repostCount: 0,
					replyCount: 0,
					createdAt: new Date().toISOString(),
					stamp: String(Date.now()),
				};

				await setProfile(uuid, { cachedAt: Date.now(), data: profileViewData });

				if (typeof sessionStorage !== "undefined") {
					try {
						sessionStorage.setItem(`love4dogs.bundle-session:${uuid}`, JSON.stringify(mockBundle));
					} catch {}
				}
			}

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

	async function saveProfile(showMessage = true) {
		debugProfile("[profile] saveProfile", {showMessage})
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
		const payload = buildStoredProfileForStorage()
		const snapshot = JSON.stringify(payload)
		lastAutosaveSnapshot = snapshot
		await writeStoredProfileByUuid(uuid, payload)
		if (shouldRegisterCurrentProfile(payload)) {
			await setCurrentProfileUuid(uuid)
			await upsertStoredProfile({
				uuid,
				name: profileName,
				avatarUrl: String(
					selectedProfileImage?.bskyUrl ||
						selectedProfileImage?.url ||
						"",
				),
			})
		}
		if (locationConfirmed && confirmedLocation) {
			await upsertApproxPostInCache({
				uri: existingProfileAtUri || `local-draft://${uuid}`,
				uuid,
				text: [profileName, profileDescription].filter(Boolean).join("\n"),
				lat: confirmedLocation.lat,
				lon: confirmedLocation.lon,
				images: selectedProfileImage?.url ? [selectedProfileImage.url] : [],
				isUserPost: true
			}).catch(e => console.error("[profile] failed to upsert approx post in cache", e))
		}
		if (showMessage) {
			saveMessage = `Saved at ${formatLocalTime(Date.now())}`
		}
	}

	async function clearProfileDraft() {
		debugProfile("[profile] clearProfileDraft:start")

		clearSnapshot = buildStoredProfileForStorage()

		suppressAutosave = true
		uuid = generateShortUuid()
		email = ""
		profileName = ""
		profileDescription = ""
		postTags = []
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
		await saveProfile(false)
		setStoredSnapshotBaseline(buildStoredProfileForStorage())

		if (clearUndoTimer) clearTimeout(clearUndoTimer)
		showUndo = true
		clearUndoTimer = setTimeout(() => {
			showUndo = false
			clearSnapshot = null
		}, 10000)

		debugProfile("[profile] clearProfileDraft:done")
	}

	async function undoProfileChanges() {
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
		const payload = buildStoredProfileForStorage()
		await writeStoredProfileByUuid(uuid, payload)
		if (shouldRegisterCurrentProfile(payload)) {
			await setCurrentProfileUuid(uuid)
			await upsertStoredProfile({
				uuid,
				name: profileName,
				avatarUrl: String(
					selectedProfileImage?.bskyUrl ||
						selectedProfileImage?.url ||
						"",
				),
			})
		}
	}

	async function handleClearOrUndo() {
		if (showUndo) {
			await undoProfileChanges()
			return
		}
		await clearProfileDraft()
	}

	async function cancelProfileEdit() {
		if (initialProfileSnapshot) {
			suppressAutosave = true
			applyStoredProfile(initialProfileSnapshot)
			await saveProfile(false)
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

	function handleUnlock() {
		if (enteredPin.trim() === pin.trim()) {
			isUnlocked = true;
			unlockError = "";
		} else {
			unlockError = "Incorrect PIN. Please try again.";
		}
	}

	function setView(view = "feed") {
		currentView = String(view || "feed")
	}

	onMount(() => {
		debugProfile("[profile] onMount:start")
		const directRouteUuid = String(page.params?.uuid || "").trim()
		const slugParam = page.params?.slug
		const slugPath = Array.isArray(slugParam)
			? slugParam.join("/")
			: String(slugParam || "")
		const slugFirstSegment = String(slugPath || "")
			.split("/")
			.map((segment) => segment.trim())
			.filter(Boolean)[0]
		const routeUuid = directRouteUuid || slugFirstSegment || ""
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
		let disposed = false

		async function init() {
			try {
				if (!routeUuid) {
					// Check for current/recent profile draft first
					const currentUuid = await getCurrentProfileUuid()
					if (currentUuid) {
						const storedByUuid = await readStoredProfileByUuid(currentUuid)
						if (storedByUuid) {
							debugProfile(
								"[profile] onMount:no uuid in URL; loaded stored profile by currentUuid",
								{ currentUuid },
							)
							applyStoredProfile(storedByUuid)
							uuid = currentUuid
							initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
							setStoredSnapshotBaseline(buildStoredProfileForStorage())
							storageReady = true
							goto(`/profile/edit/${encodeURIComponent(currentUuid)}`, { replaceState: true })
							return
						}
					}

					// Fall back to migrating legacy profile
					const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY) : null
					if (raw) {
						try {
							const parsed = JSON.parse(raw)
							if (parsed && typeof parsed === "object" && parsed.uuid) {
								debugProfile("[profile] onMount:migrating legacy profile", {
									uuid: parsed.uuid,
								})
								applyStoredProfile(parsed)
								uuid = parsed.uuid
								await writeStoredProfileByUuid(parsed.uuid, parsed)
								await setCurrentProfileUuid(parsed.uuid)
								await upsertStoredProfile({
									uuid: parsed.uuid,
									name: parsed.profileName,
									avatarUrl: String(
										parsed?.profileUploadedMedia?.[0]?.bskyUrl ||
											parsed?.profileUploadedMedia?.[0]?.url ||
											"",
									),
								})
								initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
								setStoredSnapshotBaseline(buildStoredProfileForStorage())
								storageReady = true
								goto(`/profile/edit/${encodeURIComponent(parsed.uuid)}`, { replaceState: true })
								return
							}
						} catch {
							warnProfile("[profile] onMount:failed to parse legacy profile")
						}
					}

					// Starting a new empty profile
					debugProfile("[profile] onMount:no uuid in URL; starting empty")
					uuid = generateShortUuid()
					existingProfileAtUri = ""
					email = ""
					profileName = ""
					profileDescription = ""
					contentHtml = ""
					profileUploadedMedia = []
					backgroundUploadedMedia = []
					editorMediaList = []
					locationConfirmed = false
					confirmedAddress = ""
					confirmedLocation = null
					initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
					storageReady = true
					setStoredSnapshotBaseline(buildStoredProfileForStorage())
					goto(`/profile/edit/${encodeURIComponent(uuid)}`, { replaceState: true })
					return
				}

				if (routeUuid) {
					if (isPostEditRoute) {
						try {
							const response = await fetch(
								`/api/profile-bundle?uuid=${encodeURIComponent(routeUuid)}`,
							)
							if (response.ok) {
								const bundle = await response.json().catch(() => null)
								if (!disposed && bundle && typeof bundle === "object") {
									debugProfile(
										"[profile] onMount:loaded post-edit bundle from api",
										{routeUuid},
									)
									applyBundleToEditor(bundle, routeUuid)
									initialProfileSnapshot =
										cloneStoredProfile(buildStoredProfile())
									setStoredSnapshotBaseline(
										buildStoredProfileForStorage(),
									)
									storageReady = true
									await saveProfile(false)
									return
								}
							}
						} catch (e) {
							debugProfile("[profile] fetch bundle error", e)
						}

						if (disposed) return
						debugProfile(
							"[profile] onMount:post-edit uuid not found or offline; starting empty",
							{routeUuid},
						)
						uuid = routeUuid
						existingProfileAtUri = ""
						email = ""
						profileName = ""
						profileDescription = ""
						contentHtml = ""
						profileUploadedMedia = []
						backgroundUploadedMedia = []
						editorMediaList = []
						initialProfileSnapshot =
							cloneStoredProfile(buildStoredProfile())
						setStoredSnapshotBaseline(
							buildStoredProfileForStorage(),
						)
						storageReady = true
						return
					}

					const sessionBundle = readBundleSessionCache(routeUuid)
					if (sessionBundle) {
						debugProfile("[profile] onMount:loaded session bundle", {
							routeUuid,
						})
						applyBundleToEditor(sessionBundle, routeUuid)
						initialProfileSnapshot =
							cloneStoredProfile(buildStoredProfile())
						setStoredSnapshotBaseline(buildStoredProfileForStorage())
						storageReady = true
						await saveProfile(false)
						return
					}

					const viewCacheData = readProfileViewCache(routeUuid)
					if (viewCacheData) {
						debugProfile("[profile] onMount:loaded profile view cache", {
							routeUuid,
						})
						applyViewCacheToEditor(viewCacheData, routeUuid)
						initialProfileSnapshot =
							cloneStoredProfile(buildStoredProfile())
						setStoredSnapshotBaseline(buildStoredProfileForStorage())
						storageReady = true
						await saveProfile(false)
						return
					}

					const storedByRouteUuid = await readStoredProfileByUuid(routeUuid)
					if (storedByRouteUuid) {
						debugProfile(
							"[profile] onMount:loaded stored profile by route uuid",
							{
								routeUuid,
							},
						)
						applyStoredProfile(storedByRouteUuid)
						await setCurrentProfileUuid(routeUuid)
						initialProfileSnapshot =
							cloneStoredProfile(buildStoredProfile())
						setStoredSnapshotBaseline(buildStoredProfileForStorage())
						storageReady = true
						return
					}

					try {
						console.log(`[profile] Fetching profile bundle from proxy API for uuid: ${routeUuid}`);
						const response = await fetch(`/api/profile-bundle?uuid=${encodeURIComponent(routeUuid)}`)
						let bundle = null
						if (response.ok) {
							bundle = await response.json().catch(() => null)
						}
						if (!bundle || typeof bundle !== "object" || !bundle.combined) {
							console.log(`[profile] Proxy API failed or empty, fetching directly from Bluesky for uuid: ${routeUuid}`);
							bundle = await loadMostRecentProfileBundleFromPublicBsky({
								fetchImpl: fetch,
								uuid: routeUuid,
								author: "love4dogs.club",
								debug: true,
							}).catch(() => null)
						}
						if (!disposed && bundle && typeof bundle === "object" && bundle.combined) {
							debugProfile(
								"[profile] onMount:loaded bundle",
								{
									routeUuid,
								},
							)
							applyBundleToEditor(bundle, routeUuid)
							initialProfileSnapshot =
								cloneStoredProfile(buildStoredProfile())
							setStoredSnapshotBaseline(
								buildStoredProfileForStorage(),
							)
							storageReady = true
							await saveProfile(false)
							return
						}
					} catch (e) {
						debugProfile("[profile] fetch profile-bundle error", e)
					}

					if (disposed) return
					debugProfile(
						"[profile] onMount:route uuid not found or offline; starting new profile",
						{routeUuid},
					)
					uuid = routeUuid
					existingProfileAtUri = ""
					email = ""
					profileName = ""
					profileDescription = ""
					contentHtml = ""
					profileUploadedMedia = []
					backgroundUploadedMedia = []
					editorMediaList = []
					initialProfileSnapshot =
						cloneStoredProfile(buildStoredProfile())
					setStoredSnapshotBaseline(buildStoredProfileForStorage())
					storageReady = true
					return
				}
			} catch (err) {
				console.error("[profile] onMount error", err)
				storageReady = true
			}
		}

		init()

		return () => {
			disposed = true
			if (intervalId) clearInterval(intervalId)
		}
	})

	$effect(() => {
		if (!storageReady || !storedSnapshotBaseline) return
		if (hasChangedFromStoredSnapshot) return

		const currentSnapshot = buildStoredProfileForStorage()
		if (
			getProfileIdentity(currentSnapshot) !==
			getProfileIdentity(storedSnapshotBaseline)
		) {
			return
		}

		if (
			JSON.stringify(currentSnapshot) !==
			JSON.stringify(storedSnapshotBaseline)
		) {
			hasChangedFromStoredSnapshot = true
		}
	})

	$effect(() => {
		if (!storageReady || suppressAutosave || !hasChangedFromStoredSnapshot) return
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
		const payload = buildStoredProfileForStorage()
		writeStoredProfileByUuid(uuid, payload)
		if (shouldRegisterCurrentProfile(payload)) {
			setCurrentProfileUuid(uuid)
			upsertStoredProfile({
				uuid,
				name: profileName,
				avatarUrl: String(
					selectedProfileImage?.bskyUrl ||
						selectedProfileImage?.url ||
						"",
				),
			})
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
			const minifiedSource = minifyHtml(source)
			const fragments = chunkHtmlByAltPayload(
				minifiedSource,
				CHUNK_ALT_PAYLOAD_TARGET_CHARS,
				{uuid, forceCompression},
			)
			const payloadLengths = fragments.map((htmlFragment, index) =>
				measureChunkAltPayloadLength(htmlFragment, {
					uuid,
					index: index + 1,
					total: fragments.length,
					forceCompression,
				}),
			)
			minifiedChunkEntries = fragments.map((htmlFragment) => {
				return {
					htmlFragment,
					forceCompression,
					postBody: extractChunkBodyText(
						htmlFragment,
						CHUNK_BODY_TEXT_SIZE,
					),
				}
			})
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
			const minifiedSource = minifyHtml(source)
			const fragments = chunkHtmlByAltPayload(
				minifiedSource,
				CHUNK_ALT_PAYLOAD_TARGET_CHARS,
				{uuid, forceCompression},
			)
			const payloadLengths = fragments.map((htmlFragment, index) =>
				measureChunkAltPayloadLength(htmlFragment, {
					uuid,
					index: index + 1,
					total: fragments.length,
					forceCompression,
				}),
			)
			minifiedChunkEntries = fragments.map((htmlFragment) => {
				return {
					htmlFragment,
					forceCompression,
					postBody: extractChunkBodyText(
						htmlFragment,
						CHUNK_BODY_TEXT_SIZE,
					),
				}
			})
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
	<title>{isPostEditRoute ? "Post" : "Profile"} | Love4Dogs</title>
</svelte:head>

<main class="page">
	{#if !storageReady}
		<div class="progress-bar-container" aria-label="Loading profile data">
			<div class="progress-bar-shimmer"></div>
		</div>
	{/if}

	<NavBar {currentView} onSetView={setView} />

	<ShowAdmin {currentView}>
		<section class="panel ids">
			<div>
				<p class="label">Short UUID</p>
				<p class="mono">{uuid}</p>
			</div>
		</section>
	</ShowAdmin>

	<section class="panel" onfocusout={handleFormFocusOut}>
		{#if !isPostEditRoute && pin && !isUnlocked}
			<div class="lock-screen">
				<h3>Profile Locked</h3>
				<p class="lock-desc">This profile is protected by a PIN. Please enter the 6-digit PIN to enable editing.</p>
				<div class="unlock-row">
					<input
						type="password"
						pattern="[0-9]*"
						inputmode="numeric"
						maxlength="6"
						placeholder="••••••"
						bind:value={enteredPin}
						onkeydown={(e) => {
							if (e.key === "Enter") handleUnlock();
						}}
						class="unlock-pin-input"
					/>
					<button type="button" class="primary" onclick={handleUnlock}>
						Unlock
					</button>
					<button type="button" onclick={cancelProfileEdit}>
						Cancel
					</button>
				</div>
				{#if unlockError}
					<p class="field-error" style="margin-top: 0.8rem;">{unlockError}</p>
				{/if}
			</div>
		{:else}
			{#if !isPostEditRoute}
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
				<p class="field-error profile-image-error">
					{profileImageError}
				</p>
			{/if}
		{/if}

		<label>
			<input
				bind:this={profileNameInputEl}
				type="text"
				bind:value={profileName}
				onfocus={activateValidation}
				onblur={() => handleFieldBlur("name")}
				class:invalid-field={touchedName && !!nameError}
				placeholder={isPostEditRoute ? "Title" : "Name"}
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
				placeholder={isPostEditRoute
					? "Short post description"
					: "Short profile description"}
				maxlength={descMaxLength}
				style="min-height: 100px; resize: vertical;"
			></textarea>
		</label>
		<p class="char-count">{remainingProfileChars}/{descMaxLength}</p>
		{#if isPostEditRoute}
			<div class="post-tags-container">
				<HashTagCloud activeTags={postTags} onToggle={togglePostTag} />
			</div>
		{/if}
		<div class="editor-wrap">
			<Editor
				bind:value={contentHtml}
				bind:uploadedMedia={editorMediaList}
				placeholder={isPostEditRoute
					? "Write formatted post content..."
					: "Write formatted profile content..."}
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
		<ContactInput
			bind:value={email}
			error={emailError}
			disabled={publishing}
			placeholder="you@email.com"
			showNotice={false}
		/>
		{#if !isPostEditRoute}
			<label class="pin-label">
				<span class="label">6-Digit PIN (used to authorize future edits)</span>
				<input
					bind:this={pinInputEl}
					type="text"
					pattern="[0-9]*"
					inputmode="numeric"
					maxlength="6"
					bind:value={pin}
					onfocus={activateValidation}
					onblur={() => handleFieldBlur("pin")}
					class:invalid-field={touchedPin && !!pinError}
					disabled={publishing}
					placeholder="123456"
				/>
			</label>
			{#if touchedPin && pinError}
				<p class="field-error">{pinError}</p>
			{/if}
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
			<button
				type="button"
				class="verify-location-btn"
				onclick={() => {
					modalLocation = modalLocation
					pinMovedInModal = false
					showLocationModal = true
				}}
				title="Verify Location on Map"
			>
				<MapPin size={16} aria-hidden="true" />
				<span>Verify</span>
			</button>
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
				class:disabled-btn={!isFormValid}
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
		{/if}
	</section>

	<LocationModal
		showModal={showLocationModal}
		{modalLocation}
		{addressText}
		{confirmedLocation}
		{pinMovedInModal}
		onConfirm={async (result) => {
			if (result.error) {
				locationError = result.error
				locationConfirmed = result.locationConfirmed
				return
			}
			addressText = result.addressText
			confirmedAddress = result.confirmedAddress
			locationConfirmed = result.locationConfirmed
			if (result.confirmedLocation) {
				confirmedLocation = result.confirmedLocation
			}
			if (result.modalLocation) {
				modalLocation = result.modalLocation
			}
			locationError = ""
			showLocationModal = false
			await saveProfile(false)
		}}
		onCancel={() => {
			showLocationModal = false
			pinMovedInModal = false
			locationError = ""
		}}
		disabled={publishing}
	/>

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
	button:disabled,
	button.disabled-btn {
		cursor: not-allowed;
		opacity: 0.58;
	}
	button.disabled-btn:hover {
		background: #3b6e4f;
		border-color: #305741;
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
	.post-tags-container {
		margin-top: 0.6rem;
		margin-bottom: 0.8rem;
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
	.verify-location-btn {
		background: #fff;
		border: 1px solid #3b6e4f;
		color: #3b6e4f;
		font-weight: 500;
		transition: all 0.2s ease;
	}
	.verify-location-btn:hover {
		background: #f4fcf7;
		border-color: #305741;
		color: #305741;
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

	/*
Source - https://stackoverflow.com/a/79793317
Posted by Debtanu Coder
Retrieved 2026-05-08, License - CC BY-SA 4.0
*/
	.lock-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2.5rem 1.5rem;
		text-align: center;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 16px;
	}
	.lock-screen h3 {
		font-size: 1.5rem;
		color: #3b5b41;
		margin: 0 0 0.8rem;
	}
	.lock-desc {
		color: #51655a;
		max-width: 420px;
		margin: 0 auto 1.5rem;
		font-size: 0.95rem;
		line-height: 1.5;
	}
	.unlock-row {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		justify-content: center;
		width: 100%;
		max-width: 320px;
	}
	.unlock-pin-input {
		flex: 1;
		font-size: 1.25rem;
		text-align: center;
		letter-spacing: 0.25rem;
		padding: 0.55rem;
	}
	.pin-label {
		margin-top: 0.8rem;
	}

	/* ── progress bar ─────────────────────────────────────────────────────── */
	.progress-bar-container {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 4px;
		background: rgba(59, 110, 79, 0.1);
		z-index: 2000;
		overflow: hidden;
	}

	.progress-bar-shimmer {
		width: 50%;
		height: 100%;
		background: linear-gradient(90deg, transparent, #3b6e4f, transparent);
		animation: progress-slide 1.5s infinite ease-in-out;
	}

	@keyframes progress-slide {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(200%);
		}
	}
</style>
