<script>
	import {onMount} from "svelte"
	import {
		buildLocationBlock,
		CONTACT_LOCK_PREFIX,
		decryptContact,
		encryptContact,
		gpsToHash,
		hashToGps,
		isContactEncrypted,
		lookupLocationDetails,
		normalizeContactInput,
		removeApproxPostFromCache,
		isLocalHost,
		upsertApproxPostInCache,
	} from "$lib/utils"
	import {
		ChevronDown,
		ChevronRight,
		CircleAlert,
		Eye,
		EyeOff,
		Send,
		ShieldCheck,
		Trash2,
	} from "lucide-svelte"
	import {goto} from "$app/navigation"
	import HashTagCloud from "$lib/HashTagCloud.svelte"
	import MediaUploadManager from "$lib/MediaUploadManager.svelte"
	import LocationPicker from "$lib/LocationPicker.svelte"
	import PostCard from "$lib/PostCard.svelte"
	import Editor from "$lib/Editor.svelte"
	import NavBar from "$lib/NavBar.svelte"
	import {isKnownPostType, postTypes} from "$lib/config"
	import {hasStoredProfiles} from "$lib/profileRegistry"

	const LOCAL_TAG_KEY = "love4dogs.tag-counts"
	const LOCAL_OLD_POSTS_KEY = "love4dogs.my-post-uris"
	const TRASH_KEY = "love4dogs.trash"
	const MISSING_PROFILE_ERROR =
		"Create at least one profile before publishing a post."
	const MAX_OLD_POSTS = 100
	const MAX_CHARS = 300
	const MAX_ATTACHMENTS = 4
	const altMaxChar = 300
	const ps = "" //"❤️4🐶s"

	let draft = $state("")
	let imageAltHtml = $state("")
	let title = $state("")
	let postType = $state("")
	let addressText = $state("")
	let locationConfirmed = $state(false)
	let confirmedAddress = $state("")
	let showLocationModal = $state(false)
	let pinMovedInModal = $state(false)
	let modalLocation = $state(null)
	let selectedFiles = $state([])
	let uploadedMedia = $state([])
	let posting = $state(false)
	let postError = $state("")
	let postSuccess = $state("")
	let isDraggingFiles = $state(false)
	let mediaUploadManager = $state(null)
	let textareaEl = $state(null)
	let feedTags = $state([])
	let oldPostUris = $state([])
	let oldPostDetailsByUri = $state({})
	let showAllOldPosts = $state(false)
	let editingPostUri = $state("")
	let loadingEditPost = $state(false)
	let tagsDrawerOpen = $state(true)
	let submitAttempted = $state(false)
	const typeError = $derived(
		isKnownPostType(postType) ? "" : "Post type is required.",
	)
	const imageCount = $derived(
		selectedFiles.filter((file) => file.type.startsWith("image/")).length,
	)

	const LOCAL_CONTACT_KEY = "love4dogs.contact"
	function loadContactState() {
		if (typeof localStorage === "undefined") return ""
		try {
			const raw = localStorage.getItem(LOCAL_CONTACT_KEY)
			if (!raw) return ""
			const parsed = JSON.parse(raw)
			if (typeof parsed === "string") return parsed
			if (parsed && typeof parsed.contactinfo === "string")
				return parsed.contactinfo
			return ""
		} catch {
			return localStorage.getItem(LOCAL_CONTACT_KEY) || ""
		}
	}
	let contactinfo = $state("")
	let hasLoadedContact = $state(false)

	$effect(() => {
		if (!hasLoadedContact) return
		if (typeof localStorage === "undefined") return
		localStorage.setItem(LOCAL_CONTACT_KEY, contactinfo)
	})

	function extractHashtags(text = "") {
		const matches = text.match(/(^|\s)#([\p{L}\p{N}_-]+)/gu) || []
		return matches.map((tag) => tag.replace(/^[\s#]+/, "").toLowerCase())
	}

	function incrementLocalTags(tags) {
		if (typeof window === "undefined" || !tags.length) return

		const counts = JSON.parse(localStorage.getItem(LOCAL_TAG_KEY) || "{}")
		for (const tag of tags) {
			counts[tag] = (counts[tag] || 0) + 1
		}

		localStorage.setItem(LOCAL_TAG_KEY, JSON.stringify(counts))
	}

	function isValidAtUri(value = "") {
		return /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/?#]+$/i.test(
			String(value || "").trim(),
		)
	}

	function loadOldPostUris() {
		if (typeof localStorage === "undefined") return []
		try {
			const parsed = JSON.parse(
				localStorage.getItem(LOCAL_OLD_POSTS_KEY) || "[]",
			)
			if (!Array.isArray(parsed)) return []
			return [
				...new Set(parsed.map((uri) => String(uri || "").trim())),
			].filter((uri) => isValidAtUri(uri))
		} catch {
			return []
		}
	}

	function saveOldPostUris(nextUris = []) {
		const cleaned = [
			...new Set(nextUris.map((uri) => String(uri || "").trim())),
		]
			.filter((uri) => isValidAtUri(uri))
			.slice(0, MAX_OLD_POSTS)
		oldPostUris = cleaned
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(LOCAL_OLD_POSTS_KEY, JSON.stringify(cleaned))
		}
	}

	function addOldPostUri(uri = "") {
		if (!isValidAtUri(uri)) return
		saveOldPostUris([uri, ...oldPostUris.filter((item) => item !== uri)])
	}

	function removeOldPostUri(uri = "") {
		saveOldPostUris(oldPostUris.filter((item) => item !== uri))
	}

	function addToTrash(uri = "") {
		if (!uri || typeof window === "undefined") return
		try {
			const existing = JSON.parse(localStorage.getItem(TRASH_KEY) || "[]")
			const next = [uri, ...existing.filter((u) => u !== uri)].slice(
				0,
				100,
			)
			localStorage.setItem(TRASH_KEY, JSON.stringify(next))
		} catch {
			// ignore
		}
	}

	async function deletePost() {
		if (!editingPostUri) return
		const confirmed = window.confirm(
			"Permanently delete this post? This cannot be undone.",
		)
		if (!confirmed) return

		posting = true
		postError = ""
		try {
			const res = await fetch("/api/post", {
				method: "DELETE",
				headers: {"content-type": "application/json"},
				body: JSON.stringify({uris: [editingPostUri]}),
			})
			const json = await res.json().catch(() => ({}))
			if (!res.ok) throw new Error(json.error || "Delete failed.")
			addToTrash(editingPostUri)
			removeApproxPostFromCache(editingPostUri)
			removeOldPostUri(editingPostUri)
			goto("/")
		} catch (error) {
			postError = error.message || "Unable to delete post."
		} finally {
			posting = false
		}
	}

	async function cancelCompose() {
		if (posting) return
		if (typeof window !== "undefined" && window.history.length > 1) {
			window.history.back()
			return
		}
		await goto("/")
	}

	function oldPostPreviewTitle(uri = "") {
		const post = oldPostDetailsByUri[uri]
		if (post?.text) {
			const firstLine = String(post.text).split("\n")[0].trim()
			if (firstLine) return firstLine
		}
		return uri.split("/").pop() || uri
	}

	function oldPostPreviewDate(uri = "") {
		const post = oldPostDetailsByUri[uri]
		if (!post?.createdAt) return ""
		try {
			return new Date(post.createdAt).toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
				year: "numeric",
			})
		} catch {
			return ""
		}
	}

	async function fetchPostByUri(uri = "") {
		const response = await fetch(`/api/post?uri=${encodeURIComponent(uri)}`)
		const json = await response.json().catch(() => ({}))
		if (!response.ok) {
			throw new Error(json.error || "Unable to load post.")
		}
		return json.post
	}

	async function hydrateOldPostDetails(uris = []) {
		const missing = uris.filter((uri) => uri && !oldPostDetailsByUri[uri])
		if (!missing.length) return

		const updates = {}
		for (const uri of missing) {
			try {
				updates[uri] = await fetchPostByUri(uri)
			} catch {
				// Keep rendering even if a saved post is unavailable.
			}
		}

		if (Object.keys(updates).length) {
			oldPostDetailsByUri = {...oldPostDetailsByUri, ...updates}
		}
	}

	function extractLocationFromText(text = "") {
		const match = text.match(/\n\n📍\s+([^\n]+)\n([^\n]+)/)
		if (!match) {
			return {textWithoutLocation: text, address: "", location: null}
		}

		const fullMatch = match[0]
		const mapUrl = String(match[1] || "").trim()
		const detailsLine = String(match[2] || "").trim()
		const textWithoutLocation = text.replace(fullMatch, "")

		const [city = "", country = "", zip = ""] = detailsLine
			.split(",")
			.map((part) => part.trim())

		let location = null
		try {
			const parsed = new URL(mapUrl)
			const parts = parsed.pathname.split("/").filter(Boolean)
			const hashPath = parts.slice(-2).join("/")
			const gps = hashToGps(hashPath)
			if (gps) {
				location = {
					lat: gps.lat,
					lon: gps.lon,
					city,
					country,
					zip,
				}
			}
		} catch {
			location = null
		}

		return {
			textWithoutLocation,
			address: detailsLine,
			location,
		}
	}

	function splitPostTextForEditor(text = "") {
		const normalized = String(text || "").replace(/\r\n/g, "\n")
		const {textWithoutLocation, address, location} =
			extractLocationFromText(normalized)
		const blocks = textWithoutLocation
			.split(/\n{2,}/)
			.map((block) => block.trim())
			.filter(Boolean)

		const nextTitle = blocks.shift() || ""
		let nextContact = ""
		if (blocks.length) {
			const candidate = blocks[blocks.length - 1]
			if (
				isContactEncrypted(candidate) ||
				/(^@)|(@)|(^\+?[\d\s().-]{7,}$)|(\.[a-z]{2,}$)/i.test(candidate)
			) {
				nextContact = candidate
				blocks.pop()
			}
		}

		return {
			title: nextTitle,
			body: blocks.join("\n\n"),
			address,
			location,
			contact: nextContact,
		}
	}

	async function loadPostIntoEditor(post) {
		const next = splitPostTextForEditor(post?.text || "")
		title = next.title
		draft = next.body
		addressText = next.address
		confirmedAddress = next.address
		locationConfirmed = Boolean(next.address)
		modalLocation = next.location
		pinMovedInModal = false
		if (next.contact) {
			contactinfo = next.contact
		}
		await mediaUploadManager?.loadImagesForEdit(post?.images || [])
	}

	$effect(() => {
		if (locationConfirmed && addressText.trim() !== confirmedAddress) {
			locationConfirmed = false
		}
	})

	async function handleModalConfirm() {
		if (typeError) {
			postError = typeError
			return
		}

		if (!hasStoredProfiles()) {
			postError = MISSING_PROFILE_ERROR
			return
		}
		if (pinMovedInModal && modalLocation) {
			const {location} = await lookupLocationDetails(
				modalLocation.lat,
				modalLocation.lon,
			)
			if (location) {
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
		confirmedAddress = addressText.trim()
		locationConfirmed = true
		showLocationModal = false
	}

	function handleModalCancel() {
		showLocationModal = false
		pinMovedInModal = false
	}

	function composeFinalText() {
		const trimmedTitle = title.trim()
		const body = draft.trim()
		let location = ""
		if (locationConfirmed && modalLocation) {
			location = buildLocationBlock(modalLocation).replace(/^\n+/, "")
		}
		const contact = contactinfo.trim()
		const parts = [trimmedTitle, body, location, contact].filter(Boolean)
		if (postType) parts.unshift(postType)
		let text = parts.join("\n\n")

		if (!text.includes(ps)) {
			const withSignature = text ? `${text}\n${ps}` : ps
			if ([...withSignature].length <= MAX_CHARS) {
				text = withSignature
			}
		}

		return text
	}

	function splitHtmlIntoImageAltChunks(
		html = "",
		imageTotal = 0,
		perImageLimit = altMaxChar,
	) {
		const source = String(html || "")
		if (!source || imageTotal <= 0) return []
		const chunks = []
		for (let i = 0; i < imageTotal; i += 1) {
			const start = i * perImageLimit
			if (start >= source.length) break
			const chunk = source.slice(start, start + perImageLimit)
			if (chunk) chunks.push(chunk)
		}
		return chunks
	}

	async function submitPost() {
		submitAttempted = true
		postError = ""
		postSuccess = ""

		const trimmedTitle = title.trim()
		if (!trimmedTitle) {
			postError = "A title is required."
			return
		}

		if ([...trimmedTitle].length <= 5) {
			postError = "Title must be more than 5 characters."
			return
		}

		if ([...trimmedTitle].length > 50) {
			postError = "Title must be 50 characters or fewer."
			return
		}

		const body = draft.trim()
		if (!body) {
			postError = "Write something before posting."
			return
		}

		if (typeError) {
			postError = typeError
			return
		}

		const trimmedAddress = addressText.trim()
		if (!trimmedAddress) {
			postError = "An address is required."
			return
		}

		if (!locationConfirmed || trimmedAddress !== confirmedAddress) {
			pinMovedInModal = false
			showLocationModal = true
			return
		}

		const finalText = composeFinalText()

		if ([...finalText].length > MAX_CHARS) {
			postError = `Post exceeds ${MAX_CHARS} characters with location included.`
			return
		}

		const imageFiles = selectedFiles.filter((file) =>
			file.type.startsWith("image/"),
		)
		const videoFiles = selectedFiles.filter((file) =>
			file.type.startsWith("video/"),
		)

		if (imageFiles.length > 0 && videoFiles.length > 0) {
			postError = "Choose either photos or one video per post."
			return
		}

		if (imageFiles.length > MAX_ATTACHMENTS) {
			postError = "Only 4 photos are allowed."
			return
		}

		if (videoFiles.length > 1) {
			postError = "Only one video is allowed per post."
			return
		}

		const trimmedImageAltHtml = String(imageAltHtml || "")
		const maxImageAltChars = imageCount * altMaxChar
		if (
			imageCount > 0 &&
			maxImageAltChars > 0 &&
			trimmedImageAltHtml.length > maxImageAltChars
		) {
			postError = `Image description HTML exceeds ${maxImageAltChars} characters.`
			return
		}

		if (
			selectedFiles.length > 0 &&
			uploadedMedia.length < selectedFiles.length
		) {
			postError =
				"Media is still uploading or failed to upload. Please wait or remove failed media."
			return
		}

		posting = true
		try {
			const formData = new FormData()
			formData.append("text", finalText)
			if (uploadedMedia.length > 0) {
				const htmlChunks = splitHtmlIntoImageAltChunks(
					trimmedImageAltHtml,
					imageCount,
					altMaxChar,
				)
				let nextImageIndex = 0
				const payloadMedia = uploadedMedia.map((entry) => {
					if (entry?.kind !== "image") return entry
					const htmlAlt = htmlChunks[nextImageIndex] || ""
					nextImageIndex += 1
					if (!htmlAlt) return entry
					return {...entry, alt: htmlAlt}
				})
				formData.append("uploadedMedia", JSON.stringify(payloadMedia))
			}

			const res = await fetch("/api/post", {
				method: "POST",
				body: formData,
			})
			const json = await res.json()
			if (!res.ok)
				throw new Error(json.error || "Failed to publish post.")

			const createdUri = String(json?.result?.uri || "")
			if (isValidAtUri(createdUri)) {
				addOldPostUri(createdUri)
				const hash = modalLocation
					? gpsToHash(
							Number(modalLocation.lat),
							Number(modalLocation.lon),
						)
					: null
				if (hash?.approx && hash?.exact && modalLocation) {
					upsertApproxPostInCache({
						uri: createdUri,
						cid: String(json?.result?.cid || ""),
						text: finalText,
						facets: [],
						createdAt: new Date().toISOString(),
						images: [],
						video: null,
						replyCount: 0,
						repostCount: 0,
						likeCount: 0,
						comments: [],
						approximate: hash.approx,
						exact: hash.exact,
						lat: Number(modalLocation.lat),
						lon: Number(modalLocation.lon),
					})
				}
			}

			const replacingUri =
				editingPostUri && oldPostUris.includes(editingPostUri)
					? editingPostUri
					: ""

			if (replacingUri) {
				const deleteRes = await fetch("/api/post", {
					method: "DELETE",
					headers: {"content-type": "application/json"},
					body: JSON.stringify({uris: [replacingUri]}),
				})
				if (deleteRes.ok) {
					addToTrash(replacingUri)
					removeApproxPostFromCache(replacingUri)
					removeOldPostUri(replacingUri)
					const nextDetails = {...oldPostDetailsByUri}
					delete nextDetails[replacingUri]
					oldPostDetailsByUri = nextDetails
				} else {
					const deleteJson = await deleteRes.json().catch(() => ({}))
					postError =
						deleteJson.error ||
						"New post saved, but deleting the old post failed."
				}
			}

			incrementLocalTags(extractHashtags(finalText))
			draft = ""
			imageAltHtml = ""
			postType = ""
			addressText = ""
			locationConfirmed = false
			confirmedAddress = ""
			modalLocation = null
			mediaUploadManager?.clearFiles()
			editingPostUri = ""
			if (typeof window !== "undefined") {
				window.history.replaceState({}, "", "/post")
			}
			postSuccess = "Post published successfully."
			goto("/")
		} catch (error) {
			postError = error.message || "Unable to post right now."
		} finally {
			posting = false
		}
	}

	$effect(() => {
		if (imageCount > 0) return
		if (!imageAltHtml) return
		imageAltHtml = ""
	})

	function remainingChars() {
		return MAX_CHARS - [...composeFinalText()].length
	}

	function currentEditUriFromQuery() {
		if (typeof window === "undefined") return ""
		const params = new URLSearchParams(window.location.search)
		const uri = String(params.get("id") || params.get("uri") || "").trim()
		return isValidAtUri(uri) ? uri : ""
	}

	async function beginEditFromUri(uri = "") {
		if (!uri) return
		if (!isLocalHost() && !oldPostUris.includes(uri)) return
		loadingEditPost = true
		postError = ""
		try {
			const post = await fetchPostByUri(uri)
			oldPostDetailsByUri = {...oldPostDetailsByUri, [uri]: post}
			await loadPostIntoEditor(post)
			editingPostUri = uri
		} catch (error) {
			postError = error.message || "Unable to load post for editing."
		} finally {
			loadingEditPost = false
		}
	}

	const oldPostUrisForDisplay = $derived(
		oldPostUris.filter((uri) => uri !== editingPostUri),
	)

	const visibleOldPostUris = $derived(
		showAllOldPosts
			? oldPostUrisForDisplay
			: oldPostUrisForDisplay.slice(0, 4),
	)

	const visibleOldPosts = $derived(
		visibleOldPostUris
			.map((uri) => {
				const post = oldPostDetailsByUri[uri]
				if (!post) return null
				return {
					...post,
					uri,
					likeCount: Number(post.likeCount) || 0,
					repostCount: Number(post.repostCount) || 0,
					replyCount: Number(post.replyCount) || 0,
					comments: Array.isArray(post.comments) ? post.comments : [],
				}
			})
			.filter(Boolean),
	)

	onMount(() => {
		contactinfo = loadContactState()
		hasLoadedContact = true

		oldPostUris = loadOldPostUris()
		hydrateOldPostDetails(oldPostUris)
		const editUri = currentEditUriFromQuery()
		if (editUri && (isLocalHost() || oldPostUris.includes(editUri))) {
			beginEditFromUri(editUri)
		}

		fetch("/api/feed")
			.then((r) => r.json())
			.then((j) => {
				feedTags = (j.commonRecentTags || []).slice(0, 10)
			})
			.catch(() => {})
	})
</script>

<svelte:head>
	<title>Create Post | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar />
	<nav class="topline">
		<a class="back" href="/">＜ Back home</a>
		<h1>Create a post</h1>
	</nav>

	<article
		class="panel compose"
		class:drag-active={isDraggingFiles}
		ondragenter={(event) => mediaUploadManager?.handleDragEnter(event)}
		ondragover={(event) => mediaUploadManager?.handleDragOver(event)}
		ondragleave={(event) => mediaUploadManager?.handleDragLeave(event)}
		ondrop={(event) => mediaUploadManager?.handleDropFiles(event)}
	>
		{#if loadingEditPost}
			<p class="edit-loading">Loading selected post...</p>
		{:else if editingPostUri}
			<p class="edit-loading">
				Editing a previous post. Saving will replace it.
			</p>
		{/if}

		<div class="title-row">
			<input
				class="title-input"
				type="text"
				bind:value={title}
				placeholder="Title (required)"
				maxlength="50"
				required
			/>
			<span
				class="title-counter"
				class:title-danger={[...title].length > 45}
			>
				{50 - [...title].length}
			</span>
		</div>

		<fieldset class="type-fieldset">
			<legend>
				Type <span class="required">*</span>
			</legend>
			<div
				class="type-options"
				class:invalid-field={submitAttempted && !!typeError}
			>
				{#each postTypes as option (option.value)}
					<label class="type-option">
						<input
							type="radio"
							bind:group={postType}
							value={option.value}
						/>
						<span>{option.label}</span>
					</label>
				{/each}
			</div>
		</fieldset>
		{#if submitAttempted && typeError}
			<p class="warning field-warning">
				<CircleAlert size={15} />
				{typeError}
			</p>
		{/if}

		<textarea
			bind:value={draft}
			bind:this={textareaEl}
			placeholder={"Share your ❤️ for dogs..."}
			rows="7"
			class:is-dragging={isDraggingFiles}
			ondragover={(event) => mediaUploadManager?.handleDragOver(event)}
			ondragleave={(event) => mediaUploadManager?.handleDragLeave(event)}
			ondrop={(event) => mediaUploadManager?.handleDropFiles(event)}
		></textarea>
		{#if isDraggingFiles}
			<p class="drop-target-hint">Drop photos anywhere in this panel.</p>
		{/if}
		<div class="tags-drawer">
			<div>
				<label>
					<button
						type="button"
						class="tags-drawer-toggle"
						onclick={() => (tagsDrawerOpen = !tagsDrawerOpen)}
						aria-expanded={tagsDrawerOpen}
					>
						{#if tagsDrawerOpen}
							<ChevronDown size={16} />
						{:else}
							<ChevronRight size={16} />
						{/if}
					</button>
					Be sure and add tags so that people will easily find your post!
				</label>
			</div>
			{#if tagsDrawerOpen}
				<div class="tags-drawer-content">
					<HashTagCloud bind:draft {feedTags} {textareaEl} />
				</div>
			{/if}
		</div>

		<div class="address-row">
			<input
				class="address-input"
				type="text"
				bind:value={addressText}
				placeholder="Address (required)"
				required
			/>
			{#if locationConfirmed}
				<span class="address-confirmed-badge">✓ Confirmed</span>
			{/if}
		</div>

		<div class="contact-row">
			<input
				class="contact-input"
				type="text"
				bind:value={contactinfo}
				placeholder="Optional: you@email.com, +phone, @username.bsky.social, or other contact info"
				maxlength="200"
				readonly={isContactEncrypted(contactinfo)}
				oninput={() => {
					if (isContactEncrypted(contactinfo)) return
					contactinfo = normalizeContactInput(contactinfo)
				}}
			/>

			<button
				class="lock-btn"
				type="button"
				disabled={!contactinfo.trim()}
				title={isContactEncrypted(contactinfo)
					? "Decrypt contact info"
					: "Encrypt contact info"}
				onclick={() => {
					if (!isContactEncrypted(contactinfo)) {
						const normalized = normalizeContactInput(
							contactinfo.trim(),
						)
						contactinfo =
							CONTACT_LOCK_PREFIX + encryptContact(normalized)
					} else {
						contactinfo = decryptContact(
							contactinfo.slice(CONTACT_LOCK_PREFIX.length),
						)
					}
				}}
			>
				{#if isContactEncrypted(contactinfo)}
					<EyeOff size={16} />
				{:else}
					<Eye size={16} />
				{/if}
			</button>
		</div>
		{#if contactinfo.trim().length > 0}
			<div
				class="contact-notice"
				class:contact-notice--encrypted={isContactEncrypted(
					contactinfo,
				)}
			>
				{#if isContactEncrypted(contactinfo)}
					<ShieldCheck size={14} />
					<span
						>Contact info is encrypted/compressed and only visible
						on our platform, but security is not guaranteed. <br
						/>We do not spam, but we can't guarantee complete
						privacy.</span
					>
				{:else}
					<CircleAlert size={14} />
					<span
						>Contact info will be <strong>public</strong> on all
						platforms.
						<br />We do not spam, but we can't guarantee complete
						privacy.</span
					>
				{/if}
			</div>
		{/if}

		<p class="counter" class:danger={remainingChars() < 0}>
			{remainingChars()} chars left
		</p>

		{#if postError}
			<p class="warning"><CircleAlert size={15} /> {postError}</p>
		{/if}
		{#if postSuccess}
			<p class="success">{postSuccess}</p>
		{/if}

		<MediaUploadManager
			bind:this={mediaUploadManager}
			bind:selectedFiles
			bind:uploadedMedia
			bind:errorMessage={postError}
			bind:isDragging={isDraggingFiles}
			disabled={posting}
		>
			{#snippet actions()}
				<div class="toolbar-right">
					<button
						class="cancel-btn"
						type="button"
						onclick={cancelCompose}
						disabled={posting}
					>
						<span>Cancel</span>
					</button>
					{#if editingPostUri}
						<button
							class="delete-btn"
							type="button"
							onclick={deletePost}
							disabled={posting}
						>
							<Trash2 size={16} />
							<span>Delete</span>
						</button>
					{/if}
					<button
						class="post-btn"
						type="button"
						onclick={submitPost}
						disabled={posting}
					>
						<Send size={16} />
						<span
							>{posting
								? "Sending..."
								: editingPostUri
									? "Save"
									: "Submit"}</span
						>
					</button>
				</div>
			{/snippet}
		</MediaUploadManager>
	</article>

	{#if oldPostUrisForDisplay.length > 0}
		<section class="panel old-posts">
			<div class="old-posts-head">
				<h2>My old posts</h2>

				{#if oldPostUrisForDisplay.length > 4}
					<button
						type="button"
						class="old-posts-more"
						onclick={() => (showAllOldPosts = !showAllOldPosts)}
					>
						{showAllOldPosts ? "Show less" : "More"}
					</button>
				{/if}
			</div>
			<p class="old-posts-note">
				You may only edit/delete posts that were created on this device
				and browser. The original post will be replaced and any
				comments, likes, and reposts will be lost, so we recommend
				leaving the old and creating new posts instead, if your old post
				has already received engagement.
			</p>

			<div class="old-posts-list">
				{#each visibleOldPosts as oldPost (oldPost.uri)}
					<PostCard post={oldPost} selectable={false} />
				{/each}
			</div>
		</section>
	{/if}
</main>

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
				Search for your address or move the pin to the exact spot, then
				confirm.
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

<style>
	.page {
		max-width: 920px;
		margin: 0 auto;
		padding: 1rem;
	}
	.topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.back {
		text-decoration: none;
		color: #1f5135;
		font-weight: 600;
	}
	h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	.panel {
		background: rgba(255, 250, 241, 0.9);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 1rem;
		box-shadow: 0 10px 26px rgba(65, 42, 20, 0.12);
	}
	.compose {
		position: relative;
		transition:
			border-color 0.15s ease,
			background 0.15s ease,
			box-shadow 0.15s ease;
	}
	.edit-loading {
		margin: 0 0 0.55rem;
		font-size: 0.88rem;
		font-weight: 600;
		color: #2f5f3f;
	}
	.compose.drag-active {
		border-color: #55724d;
		background: #ece8d7;
		box-shadow: 0 0 0 2px rgba(85, 114, 77, 0.22);
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.type-fieldset {
		margin: 0 0 0.55rem;
		padding: 0;
		border: 0;
	}
	.type-fieldset legend {
		font-size: 0.84rem;
		font-weight: 600;
		color: #2f5f3f;
		margin-bottom: 0.35rem;
	}
	.type-fieldset .required {
		color: #b94a4a;
	}
	.type-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0.2rem;
		border-radius: 10px;
	}
	.type-options.invalid-field {
		box-shadow: 0 0 0 2px rgba(185, 74, 74, 0.25);
	}
	.type-option {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid #d7c8b6;
		border-radius: 999px;
		padding: 0.28rem 0.55rem;
		background: #fffdf9;
		cursor: pointer;
		font-size: 0.86rem;
	}
	.type-option input {
		margin: 0;
	}
	.field-warning {
		margin-top: 0.2rem;
	}
	.title-input {
		flex: 1;
		font: inherit;
		font-weight: 700;
		font-size: 1.05rem;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		padding: 0.6rem 0.75rem;
		box-sizing: border-box;
	}
	.title-counter {
		font-size: 0.8rem;
		color: #8a8a8a;
		white-space: nowrap;
	}
	.title-danger {
		color: #b94a4a;
		font-weight: 600;
	}
	textarea {
		width: 100%;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		padding: 0.75rem;
		font: inherit;
		resize: vertical;
		box-sizing: border-box;
		min-height: 160px;
	}
	textarea.is-dragging {
		background: #ece8d7;
		border-color: #55724d;
	}
	.drop-target-hint {
		margin: 0.45rem 0 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: #3b6e4f;
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
	.contact-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.45rem;
		padding: 0.45rem 0.6rem 0.45rem 0.75rem;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		background: #fffdf8;
	}
	.contact-input {
		flex: 1;
		border: none;
		outline: none;
		background: transparent;
		font: inherit;
		font-size: 0.95rem;
		color: inherit;
	}
	.contact-input[readonly] {
		color: #5a4f42;
		font-family: monospace;
		font-size: 0.85rem;
	}
	.lock-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: 0px solid #d0c3b0;
		background: transparent;
		color: #7a6d5e;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.lock-btn:disabled {
		opacity: 0.3;
		cursor: default;
		pointer-events: none;
	}
	.lock-btn:hover {
		background: #f0e9df;
		border-color: #b09880;
		color: #4a3f34;
	}

	.contact-notice {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin-top: 0.35rem;
		padding: 0.45rem 0.65rem;
		border-radius: 8px;
		font-size: 0.82rem;
		line-height: 1.4;
		background: #fff4e5;
		color: #7a4a1a;
		border: 1px solid #f0d5a8;
	}
	.contact-notice--encrypted {
		background: #eaf4ee;
		color: #2a5c3a;
		border-color: #b5d9c0;
	}
	.contact-notice :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}
	.post-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.45rem 0.8rem;
		font: inherit;
		cursor: pointer;
	}
	.post-btn {
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}
	.cancel-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid #bdad9e;
		background: #fff;
		color: #5f665f;
		border-radius: 999px;
		padding: 0.45rem 0.8rem;
		font: inherit;
		cursor: pointer;
	}
	.cancel-btn:hover {
		background: #f4eee4;
	}
	.delete-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid #b04030;
		background: #fff;
		color: #b04030;
		border-radius: 999px;
		padding: 0.45rem 0.8rem;
		font: inherit;
		cursor: pointer;
	}
	.delete-btn:hover {
		background: #fdf0ee;
	}
	.warning,
	.success {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.9rem;
		margin: 0.7rem 0 0;
	}
	.warning {
		color: #8e2f21;
	}
	.success {
		color: #24633f;
	}
	.counter {
		font-size: 0.85rem;
		color: #506157;
		margin: 0.65rem 0 0;
		text-align: right;
	}
	.counter.danger {
		color: #8e2f21;
	}
	.tags-drawer {
		margin-top: 0.6rem;
	}
	.tags-drawer-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		color: #3b6e4f;
		cursor: pointer;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	.tags-drawer-toggle:hover {
		color: #305741;
	}
	.tags-drawer-content {
		margin-top: 0.45rem;
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
	.modal-confirm-btn:hover {
		background: #305741;
	}
	.old-posts {
		margin-top: 0.9rem;
	}
	.old-posts-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.old-posts-head h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.old-posts-more {
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.32rem 0.8rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.old-posts-list {
		margin: 0.75rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
</style>
