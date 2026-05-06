<script>
	import {onMount} from "svelte"
	import Editor from "$lib/Editor.svelte"
	import MediaUploadManager from "$lib/MediaUploadManager.svelte"
	import ProfileImages from "$lib/ProfileImages.svelte"

	const PROFILE_STORAGE_KEY = "love4dogs.profile-v2"
	const CONTENT_CHUNK_SIZE = 1800
	const CHUNK_BODY_TEXT_SIZE = 300

	let uuid = $state("")
	let primaryVersion = $state("")
	let priorVersion = $state("")

	let email = $state("")
	let profileName = $state("")
	let profileDescription = $state("")

	let publicContact = $state("")
	let urlsText = $state("")
	let contentHtml = $state("")

	let profileUploadedMedia = $state([])
	let backgroundUploadedMedia = $state([])
	let galleryImageSelectedFiles = $state([])
	let galleryImageUploadedMedia = $state([])

	let uploadError = $state("")
	let saveMessage = $state("")
	let storageReady = $state(false)
	let initialProfileSnapshot = null
	let suppressAutosave = false

	let videoGalleryUploadedMedia = $state([])
	let uploadingVideos = $state(false)
	let videoUploadError = $state("")
	let minifiedChunkEntries = $state([])
	let chunkBuildVersion = 0

	function generateShortUuid() {
		return Math.random().toString(36).slice(2, 10)
	}

	function makeVersion() {
		return Date.now().toString(36)
	}

	function parseLines(text = "") {
		return String(text || "")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
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

	function extractChunkBodyText(html = "", maxChars = CHUNK_BODY_TEXT_SIZE) {
		const source = String(html || "")
		let text = ""
		if (typeof document !== "undefined") {
			const root = document.createElement("div")
			root.innerHTML = source
			text = root.textContent || ""
		} else {
			text = source.replace(/<[^>]+>/g, " ")
		}
		const normalized = text.replace(/\s+/g, " ").trim()
		return normalized.slice(0, Math.max(0, maxChars))
	}

	async function uploadVideoFile(file) {
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
		return {
			kind: "video",
			alt: file.name || "Video",
			blob: json.blob,
			sourceName: file.name || "video",
		}
	}

	async function handleVideoFiles(event) {
		const input = event.currentTarget
		const files = [...(input?.files || [])].filter((file) =>
			String(file.type || "").startsWith("video/"),
		)
		if (!files.length) return

		videoUploadError = ""
		uploadingVideos = true
		const settled = await Promise.allSettled(
			files.map((file) => uploadVideoFile(file)),
		)
		const nextUploaded = settled
			.filter((result) => result.status === "fulfilled")
			.map((result) => result.value)
		const firstFailure = settled.find(
			(result) => result.status === "rejected",
		)
		if (firstFailure?.status === "rejected") {
			videoUploadError =
				firstFailure.reason?.message || "A video failed to upload."
		}
		videoGalleryUploadedMedia = [
			...videoGalleryUploadedMedia,
			...nextUploaded,
		]
		uploadingVideos = false
		if (input) input.value = ""
	}

	function removeVideoAt(index) {
		videoGalleryUploadedMedia = videoGalleryUploadedMedia.filter(
			(_, i) => i !== index,
		)
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

	const uploadedGalleryImages = $derived(
		galleryImageUploadedMedia.filter((entry) => entry?.kind === "image"),
	)

	const primaryPostPayload = $derived({
		uuid,
		version: primaryVersion,
		email,
		profilePic: uploadedProfileImage?.blob || null,
		backgroundPic: uploadedBackgroundImage?.blob || null,
		name: profileName,
		description: profileDescription,
	})

	const subsequentPostsPayload = $derived(
		minifiedChunkEntries.map((entry, index) => {
			const htmlFragment = entry.htmlFragment
			const attachments =
				uploadedGalleryImages.length > 0
					? uploadedGalleryImages
					: uploadedProfileImage
						? [uploadedProfileImage]
						: []
			const attachment =
				attachments.length > 0
					? attachments[index % attachments.length]
					: null
			return {
				uuid,
				version: priorVersion,
				index: index + 1,
				total: minifiedChunkEntries.length,
				htmlFragment,
				postBody: entry.postBody,
				attachedImage: attachment?.blob || null,
				publicContact,
				urls: parseLines(urlsText),
				photoGallery: uploadedGalleryImages.map((entry) => entry.blob),
				videoGallery: videoGalleryUploadedMedia.map(
					(entry) => entry.blob,
				),
			}
		}),
	)

	function normalizeStoredMedia(value) {
		if (!Array.isArray(value)) return []
		return value.filter(
			(entry) =>
				entry &&
				typeof entry === "object" &&
				typeof entry.blob === "string",
		)
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
			publicContact,
			urlsText,
			contentHtml,
			profileUploadedMedia,
			backgroundUploadedMedia,
			galleryImageUploadedMedia,
			videoGalleryUploadedMedia,
		}
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
		publicContact = String(profile.publicContact || "")
		urlsText = String(profile.urlsText || "")
		contentHtml = String(profile.contentHtml || "")
		profileUploadedMedia = normalizeStoredMedia(
			profile.profileUploadedMedia,
		)
		backgroundUploadedMedia = normalizeStoredMedia(
			profile.backgroundUploadedMedia,
		)
		galleryImageUploadedMedia = normalizeStoredMedia(
			profile.galleryImageUploadedMedia,
		)
		videoGalleryUploadedMedia = normalizeStoredMedia(
			profile.videoGalleryUploadedMedia,
		)
		galleryImageSelectedFiles = []
	}

	function saveProfile(showMessage = true) {
		if (typeof localStorage === "undefined") return
		localStorage.setItem(
			PROFILE_STORAGE_KEY,
			JSON.stringify(buildStoredProfile()),
		)
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
		if (
			typeof window !== "undefined" &&
			!window.confirm("Clear all profile draft fields?")
		) {
			return
		}

		suppressAutosave = true
		uuid = generateShortUuid()
		primaryVersion = makeVersion()
		priorVersion = primaryVersion
		email = ""
		profileName = ""
		profileDescription = ""
		publicContact = ""
		urlsText = ""
		contentHtml = ""
		profileUploadedMedia = []
		backgroundUploadedMedia = []
		galleryImageSelectedFiles = []
		galleryImageUploadedMedia = []
		videoGalleryUploadedMedia = []
		minifiedChunkEntries = []
		uploadError = ""
		videoUploadError = ""
		saveMessage = ""
		suppressAutosave = false
		saveProfile(false)
	}

	function cancelProfileEdit() {
		if (initialProfileSnapshot) {
			suppressAutosave = true
			applyStoredProfile(initialProfileSnapshot)
			saveProfile(false)
			suppressAutosave = false
		}
		saveMessage = ""
		uploadError = ""
		videoUploadError = ""
		if (typeof window !== "undefined") {
			if (window.history.length > 1) {
				window.history.back()
				return
			}
			window.location.href = "/"
		}
	}

	onMount(() => {
		if (typeof localStorage === "undefined") {
			uuid = generateShortUuid()
			primaryVersion = makeVersion()
			priorVersion = primaryVersion
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
			storageReady = true
			return
		}

		const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
		if (!raw) {
			uuid = generateShortUuid()
			primaryVersion = makeVersion()
			priorVersion = primaryVersion
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
			storageReady = true
			saveProfile(false)
			return
		}

		try {
			const parsed = JSON.parse(raw)
			applyStoredProfile(parsed)
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
		} catch {
			uuid = generateShortUuid()
			primaryVersion = makeVersion()
			priorVersion = primaryVersion
			initialProfileSnapshot = cloneStoredProfile(buildStoredProfile())
		}

		storageReady = true
	})

	$effect(() => {
		if (!storageReady || suppressAutosave) return
		saveProfile(false)
	})

	$effect(() => {
		const source = String(contentHtml || "")
		const currentBuild = ++chunkBuildVersion
		;(async () => {
			const minifiedHtml = await minifyHtmlForChunking(source)
			if (currentBuild !== chunkBuildVersion) return
			const fragments = chunkHtmlByNodes(minifiedHtml, CONTENT_CHUNK_SIZE)
			minifiedChunkEntries = fragments.map((htmlFragment) => ({
				htmlFragment,
				postBody: extractChunkBodyText(
					htmlFragment,
					CHUNK_BODY_TEXT_SIZE,
				),
			}))
		})().catch(() => {
			if (currentBuild !== chunkBuildVersion) return
			const fragments = chunkHtmlByNodes(source, CONTENT_CHUNK_SIZE)
			minifiedChunkEntries = fragments.map((htmlFragment) => ({
				htmlFragment,
				postBody: extractChunkBodyText(
					htmlFragment,
					CHUNK_BODY_TEXT_SIZE,
				),
			}))
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
		<div class="profile-image-wrap">
			<ProfileImages
				bind:profileUploadedMedia
				bind:backgroundUploadedMedia
				bind:errorMessage={uploadError}
				disabled={uploadingVideos}
			/>
		</div>

		<label>
			<input
				type="text"
				bind:value={profileName}
				placeholder="Name"
				maxlength={100}
				style="font-size: 1.25rem; font-weight: 600;"
			/>
		</label>
		<label>
			<textarea
				rows="4"
				bind:value={profileDescription}
				placeholder="Short profile description"
				maxlength={descMaxLength}
			></textarea>
		</label>
		<p class="char-count">{300 - combinedCharCount}/{descMaxLength}</p>
		<div class="editor-wrap">
			<Editor
				bind:value={contentHtml}
				maxChar={100000}
				placeholder="Write formatted profile content..."
			/>
		</div>
		<label>
			<span>Private</span>
			<input
				type="email"
				bind:value={email}
				placeholder="you@email.com"
				required
			/>
		</label>
	</section>

	<section class="panel actions">
		<button type="button" onclick={clearProfileDraft}>Clear</button>
		<button type="button" onclick={cancelProfileEdit}>Cancel</button>
		<button type="button" class="primary" onclick={saveProfile}
			>Save
		</button>
		{#if saveMessage}
			<p class="success">{saveMessage}</p>
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
	</section>
</main>

<style>
	.page {
		max-width: 1080px;
		margin: 0 auto;
		padding: 1rem;
		display: grid;
		gap: 0.8rem;
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
	button {
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.45rem 0.8rem;
		font: inherit;
		cursor: pointer;
	}
	button.primary {
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}
	.profile-image-wrap {
		margin-top: 0.65rem;
	}
	.editor-wrap {
		margin-top: 0.55rem;
	}
	.char-count {
		margin: 0;
		text-align: right;
		font-size: 0.78rem;
		color: #56695f;
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
	}
</style>
