<script>
	import {onMount} from "svelte"
	import {
		buildLocationBlock,
		CONTACT_LOCK_PREFIX,
		decryptContact,
		encryptContact,
		isContactEncrypted,
		lookupLocationDetails,
		lookupLocationWithCache,
		normalizeContactInput,
	} from "$lib/utils"
	import {
		ChevronDown,
		ChevronRight,
		CircleAlert,
		ClipboardCopy,
		Eye,
		EyeOff,
		ImagePlus,
		Send,
		ShieldCheck,
	} from "lucide-svelte"
	import {goto} from "$app/navigation"
	import HashTagCloud from "$lib/HashTagCloud.svelte"
	import LocationPicker from "$lib/LocationPicker.svelte"
	import TopBar from "$lib/TopBar.svelte"

	const LOCAL_TAG_KEY = "love4dogs.tag-counts"
	const MAX_CHARS = 300
	const ps = "" //"❤️4🐶s"

	let draft = $state("")
	let title = $state("")
	let locationText = $state("")
	let selectedFiles = $state([])
	let previews = $state([])
	let selectedLocation = $state(null)
	let locationError = $state("")
	let locationLoading = $state(true)
	let posting = $state(false)
	let postError = $state("")
	let postSuccess = $state("")
	let copySuccess = $state(false)
	let isDraggingFiles = $state(false)
	let textareaEl = $state(null)
	let feedTags = $state([])
	let lastLocationUpdateId = 0
	let hideLocation = $state(false)
	let tagsDrawerOpen = $state(true)

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
	let contactinfo = $state(loadContactState())

	$effect(() => {
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

	function updatePreviews() {
		for (const old of previews) {
			URL.revokeObjectURL(old.url)
		}

		previews = selectedFiles.map((file) => ({
			name: file.name,
			url: URL.createObjectURL(file),
		}))
	}

	function addImages(files) {
		const nextFiles = files.filter(
			(file) => file instanceof File && file.type.startsWith("image/"),
		)
		if (!nextFiles.length) return

		const dedupe = new Map()
		for (const file of [...selectedFiles, ...nextFiles]) {
			const key = `${file.name}-${file.size}-${file.lastModified}`
			if (!dedupe.has(key)) dedupe.set(key, file)
		}

		const merged = [...dedupe.values()]
		if (merged.length > 4) postError = "Only 4 photos are allowed."

		selectedFiles = merged.slice(0, 4)
		updatePreviews()
	}

	function handleFiles(event) {
		postError = ""
		addImages([...(event.currentTarget.files || [])])
		event.currentTarget.value = ""
	}

	function onDragOver(event) {
		event.preventDefault()
		isDraggingFiles = true
	}

	function onDragLeave(event) {
		event.preventDefault()
		isDraggingFiles = false
	}

	function onDropFiles(event) {
		event.preventDefault()
		isDraggingFiles = false
		postError = ""
		addImages([...(event.dataTransfer?.files || [])])
	}

	function clearFiles() {
		for (const preview of previews) {
			URL.revokeObjectURL(preview.url)
		}
		selectedFiles = []
		previews = []
	}

	function removeFile(index) {
		URL.revokeObjectURL(previews[index].url)
		selectedFiles = selectedFiles.filter((_, i) => i !== index)
		previews = previews.filter((_, i) => i !== index)
		postError = ""
	}

	function syncLocationText(location) {
		const nextBlock = buildLocationBlock(location)
		locationText = nextBlock ? nextBlock.replace(/^\n+/, "") : ""
	}

	async function updateLocationFromPin(lat, lon) {
		const requestId = ++lastLocationUpdateId
		locationError = ""
		locationLoading = true

		const {location, error} = await lookupLocationDetails(lat, lon)
		if (requestId !== lastLocationUpdateId) return

		selectedLocation = location || {
			lat,
			lon,
			city: "",
			country: "",
			zip: "",
		}
		locationError = error
		syncLocationText(selectedLocation)
		locationLoading = false
	}

	async function lookupLocation() {
		locationError = ""
		locationLoading = true

		const {location, error} = await lookupLocationWithCache()
		selectedLocation = location
		locationError = error
		if (location) syncLocationText(location)
		locationLoading = false
	}

	function composeFinalText() {
		const trimmedTitle = title.trim()
		const body = draft.trim()
		const location = locationText.trim()
		const contact = contactinfo.trim()
		const parts = [trimmedTitle, body, location, contact].filter(Boolean)
		let text = parts.join("\n\n")

		if (!text.includes(ps)) {
			const withSignature = text ? `${text}\n${ps}` : ps
			if ([...withSignature].length <= MAX_CHARS) {
				text = withSignature
			}
		}

		return text
	}

	async function submitPost() {
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

		const finalText = composeFinalText()

		if ([...finalText].length > MAX_CHARS) {
			postError = `Post exceeds ${MAX_CHARS} characters with location included.`
			return
		}

		if (selectedFiles.length > 4) {
			postError = "Only 4 photos are allowed."
			return
		}

		posting = true
		try {
			const formData = new FormData()
			formData.append("text", finalText)
			for (const file of selectedFiles) formData.append("images", file)

			const res = await fetch("/api/post", {
				method: "POST",
				body: formData,
			})
			const json = await res.json()
			if (!res.ok)
				throw new Error(json.error || "Failed to publish post.")

			incrementLocalTags(extractHashtags(finalText))
			draft = ""
			locationText = ""
			selectedLocation = null
			clearFiles()
			postSuccess = "Post published successfully."
			goto("/")
		} catch (error) {
			postError = error.message || "Unable to post right now."
		} finally {
			posting = false
		}
	}

	async function copyAsHtml() {
		const trimmedTitle = title.trim()
		const bodyText = draft.trim()
		const locationInfo = locationText.trim()

		function escHtml(str) {
			return str
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
		}

		function linkify(str) {
			return escHtml(str).replace(
				/(https?:\/\/[^\s<]+)/g,
				'<a href="$1">$1</a>',
			)
		}

		const imgTags = await Promise.all(
			selectedFiles.map(
				(file) =>
					new Promise((resolve) => {
						const reader = new FileReader()
						reader.onload = (e) =>
							resolve(
								`<img src="${e.target.result}" alt="${escHtml(file.name)}" style="max-width:100%;max-height:400px;display:block;margin:4px 0;">`,
							)
						reader.readAsDataURL(file)
					}),
			),
		)

		const parts = []
		if (trimmedTitle)
			parts.push(
				`<h2 style="font-weight:700;font-size:1.2em;margin:0 0 10px 0;">${escHtml(trimmedTitle)}</h2>`,
			)
		if (bodyText)
			parts.push(
				`<p style="margin:0 0 10px 0;white-space:pre-wrap;">${linkify(bodyText).replace(/\n/g, "<br>")}</p>`,
			)
		if (locationInfo)
			parts.push(
				`<p style="margin:0 0 10px 0;white-space:pre-wrap;">${linkify(locationInfo).replace(/\n/g, "<br>")}</p>`,
			)
		if (imgTags.length)
			parts.push(
				`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">${imgTags.join("")}</div>`,
			)

		const html = `<div style="font-family:sans-serif;line-height:1.5;">${parts.join("")}</div>`

		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					"text/html": new Blob([html], {type: "text/html"}),
					"text/plain": new Blob([composeFinalText()], {
						type: "text/plain",
					}),
				}),
			])
		} catch {
			await navigator.clipboard.writeText(composeFinalText())
		}

		copySuccess = true
		setTimeout(() => (copySuccess = false), 2000)
	}

	function remainingChars() {
		return MAX_CHARS - [...composeFinalText()].length
	}

	onMount(() => {
		lookupLocation()
		fetch("/api/feed")
			.then((r) => r.json())
			.then((j) => {
				feedTags = (j.commonRecentTags || []).slice(0, 10)
			})
			.catch(() => {})
		return () => {
			for (const preview of previews) {
				URL.revokeObjectURL(preview.url)
			}
		}
	})
</script>

<svelte:head>
	<title>Create Post | Love4Dogs</title>
</svelte:head>

<main class="page">
	<nav class="topline">
		<a class="back" href="/">＜ Back home</a>
		<h1>Create a post</h1>
	</nav>

	<article class="panel compose">
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

		<textarea
			bind:value={draft}
			bind:this={textareaEl}
			placeholder={"Share your ❤️ for dogs..."}
			rows="7"
			class:is-dragging={isDraggingFiles}
			ondragover={onDragOver}
			ondragleave={onDragLeave}
			ondrop={onDropFiles}
		></textarea>
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

		<div class="location-panel">
			<label class="hide-location-label">
				<button
					type="button"
					class="location-check-btn"
					class:is-active={hideLocation}
					onclick={() => (hideLocation = !hideLocation)}
					aria-label={hideLocation ? "Show map" : "Hide map"}
					><span class="location-check-dot"
						>{hideLocation ? "✓" : ""}</span
					></button
				>
				<h2>
					{hideLocation ? "Location Confirmed" : "Confirm Location"}
				</h2>
			</label>
			{#if !hideLocation}
				<div>
					Please ensure the location is accurate before sharing!
				</div>
				<LocationPicker
					location={selectedLocation}
					onChange={({lat, lon}) => updateLocationFromPin(lat, lon)}
				/>

				{#if selectedLocation}
					<p class="location-coords">
						{selectedLocation.lat.toFixed(5)}, {selectedLocation.lon.toFixed(
							5,
						)}
						{#if selectedLocation.city || selectedLocation.country}
							· {selectedLocation.city || "Unknown city"}, {selectedLocation.country ||
								"Unknown country"}
						{/if}
					</p>
				{/if}
				<textarea
					class="location-input"
					bind:value={locationText}
					placeholder="Location details (auto-updates when map pin moves)"
					rows="3"
				></textarea>
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

		{#if locationLoading}
			<p class="location-status muted">Detecting location…</p>
		{:else if locationError}
			<p class="warning"><CircleAlert size={15} /> {locationError}</p>
		{/if}
		{#if postError}
			<p class="warning"><CircleAlert size={15} /> {postError}</p>
		{/if}
		{#if postSuccess}
			<p class="success">{postSuccess}</p>
		{/if}

		{#if previews.length}
			<div class="preview-grid">
				{#each previews as item, i}
					<div class="preview-item">
						<img src={item.url} alt={item.name} />
						<button
							class="remove-photo"
							type="button"
							onclick={() => removeFile(i)}
							aria-label="Remove photo">✕</button
						>
					</div>
				{/each}
			</div>
		{/if}

		<div class="toolbar">
			<div class="toolbar-left">
				<label class="icon-btn file-btn" for="images">
					<ImagePlus size={17} />
					<span>Add photos</span>
				</label>
				<input
					id="images"
					type="file"
					accept="image/*"
					multiple
					onchange={handleFiles}
				/>
				<p class="drop-hint">
					Or drag'n drop up to 4 photos onto the text box.
				</p>
			</div>
			<div class="toolbar-right">
				<button
					class="icon-btn copy-btn"
					type="button"
					onclick={copyAsHtml}
					title="Copy as rich HTML for email"
				>
					<ClipboardCopy size={16} />
					<span>{copySuccess ? "Copied!" : "Share"}</span>
				</button>
				<button
					class="post-btn"
					type="button"
					onclick={submitPost}
					disabled={posting}
				>
					<Send size={16} />
					<span>{posting ? "Sending..." : "Submit"}</span>
				</button>
			</div>
		</div>
	</article>
</main>

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
	.location-status {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: #3b6e4f;
	}
	.location-status.muted {
		color: #8a8a8a;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
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
	.location-input {
		min-height: 88px;
		margin-top: 0.45rem;
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
	.drop-hint {
		font-size: 0.85rem;
		color: #5f665f;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.55rem;
		margin-top: 0.75rem;
	}
	.toolbar-left {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.55rem;
	}
	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-left: auto;
	}
	.icon-btn,
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
		margin-left: auto;
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}
	input[type="file"] {
		display: none;
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
	.location-panel {
		margin-top: 1rem;
	}
	.hide-location-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		margin-bottom: 0.5rem;
	}
	.hide-location-label h2 {
		margin: 0;
		font-size: 1rem;
	}
	.location-check-btn {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid rgba(60, 60, 60, 0.35);
		background: rgba(255, 255, 255, 0.92);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		flex-shrink: 0;
	}
	.location-check-btn.is-active {
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}
	.location-check-dot {
		font-size: 0.85rem;
		line-height: 1;
		font-weight: 700;
	}
	.location-coords {
		margin: 0.55rem 0 0;
		font-size: 0.9rem;
		color: #506157;
	}
	.preview-grid {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.4rem;
		margin-top: 0.75rem;
	}
	.preview-item {
		position: relative;
		width: fit-content;
		flex: 0 0 auto;
	}
	.preview-item img {
		width: auto;
		height: 100px;
		object-fit: cover;
		border-radius: 10px;
		display: block;
	}
	.remove-photo {
		position: absolute;
		top: 3px;
		right: 3px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: none;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		font-size: 10px;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
</style>
