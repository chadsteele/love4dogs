<script>
	const MAX_IMAGE_SIZE_BYTES = 2_000_000
	const NORMALIZED_IMAGE_MAX_DIM = 1800
	import {User, Pencil, Trash2 as Trash} from "lucide-svelte"
	import {mediaTokenFromFile} from "$lib/utils"
	import {setOfflineImage} from "$lib/db.js"


	let {
		profileUploadedMedia = $bindable([]),
		backgroundUploadedMedia = $bindable([]),
		errorMessage = $bindable(""),
		uploadingProfile = $bindable(false),
		uploadingBackground = $bindable(false),
		disabled = false,
		defaultBackgroundSrc = "/background.jpg",
		currentProfileSrc = "",
		currentBackgroundSrc = "",
	} = $props()

	let profileFileInput
	let backgroundFileInput

	let profilePreviewUrl = $state("")
	let backgroundPreviewUrl = $state("")

	const profileImageSrc = $derived(
		profilePreviewUrl || currentProfileSrc || "",
	)
	const backgroundImageSrc = $derived(
		backgroundPreviewUrl || currentBackgroundSrc || defaultBackgroundSrc,
	)
	const hasRenderableProfileImage = $derived(Boolean(profileImageSrc))
	const hasRenderableBackgroundImage = $derived(
		Boolean(backgroundPreviewUrl || currentBackgroundSrc),
	)

	function revokeObjectUrl(url) {
		if (url) URL.revokeObjectURL(url)
	}

	function setProfilePreview(file) {
		revokeObjectUrl(profilePreviewUrl)
		profilePreviewUrl = file ? URL.createObjectURL(file) : ""
	}

	function setBackgroundPreview(file) {
		revokeObjectUrl(backgroundPreviewUrl)
		backgroundPreviewUrl = file ? URL.createObjectURL(file) : ""
	}

	function triggerProfilePicker() {
		if (disabled || uploadingProfile || uploadingBackground) return
		profileFileInput?.click()
	}

	function triggerBackgroundPicker() {
		if (disabled || uploadingProfile || uploadingBackground) return
		backgroundFileInput?.click()
	}

	function clearProfileImage(event) {
		event?.stopPropagation?.()
		revokeObjectUrl(profilePreviewUrl)
		profilePreviewUrl = ""
		profileUploadedMedia = []
	}

	function clearBackgroundImage(event) {
		event?.stopPropagation?.()
		revokeObjectUrl(backgroundPreviewUrl)
		backgroundPreviewUrl = ""
		backgroundUploadedMedia = []
	}

	function seedProfileSelection(file) {
		profileUploadedMedia = [
			{
				kind: "image",
				alt: file?.name || "Profile photo",
				blob: null,
				sourceName: file?.name || "profile",
			},
		]
	}

	function seedBackgroundSelection(file) {
		backgroundUploadedMedia = [
			{
				kind: "image",
				alt: file?.name || "Profile background",
				blob: null,
				sourceName: file?.name || "background",
			},
		]
	}

	function handleBannerClick(event) {
		if (event.target.closest(".profile-button")) return
		triggerBackgroundPicker()
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

			if (blob.size <= MAX_IMAGE_SIZE_BYTES) {
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

	async function uploadImage(file, isAlreadyNormalized = false) {
		if (typeof navigator !== "undefined" && navigator.onLine === false) {
			const offlineId = Math.random().toString(36).slice(2, 10) + '-' + Date.now();
			await setOfflineImage(offlineId, file);
			return {
				ok: true,
				url: `/offline-media/${offlineId}`,
				blob: {
					ref: {
						$link: offlineId
					},
					mimeType: file.type || "image/png",
					size: file.size
				},
				isOfflineMedia: true,
				offlineId: offlineId
			};
		}
		const normalized = isAlreadyNormalized
			? file
			: await normalizeImageForSlot(
				file,
				NORMALIZED_IMAGE_MAX_DIM,
				NORMALIZED_IMAGE_MAX_DIM,
			)
		const sourceUrl = await mediaTokenFromFile(file)
		if (!sourceUrl) {
			throw new Error("Media origin is required for upload.")
		}
		const formData = new FormData()
		formData.append("mode", "cache-media-url")
		formData.append("sourceUrl", sourceUrl)
		formData.append("file", normalized)

		const response = await fetch("/api/post", {
			method: "POST",
			body: formData,
		})
		const json = await response.json().catch(() => ({}))
		if (!response.ok || !json?.ok || !json?.blob) {
			throw new Error(json?.error || "Media upload failed.")
		}
		return {
			...json,
			sourceName: file.name || "uploaded",
		}
	}

	async function onProfileFileChange(event) {
		const file = event.currentTarget?.files?.[0]
		if (!file) return
		errorMessage = ""
		uploadingProfile = true
		setProfilePreview(file)
		seedProfileSelection(file)

		try {
			const normalized = await normalizeImageForSlot(
				file,
				NORMALIZED_IMAGE_MAX_DIM,
				NORMALIZED_IMAGE_MAX_DIM,
			)
			// Seed the local normalized file info first so it's not lost if upload fails
			profileUploadedMedia = [
				{
					kind: "image",
					alt: file.name || "Profile photo",
					blob: null,
					file: normalized,
					sourceName: file.name || "profile",
					url: profilePreviewUrl,
					bskyUrl: "",
				},
			]

			const uploaded = await uploadImage(normalized, true)
			const cid = uploaded.blob?.ref?.$link || uploaded.blob?.cid || ""
			const did = String(uploaded.did || "")
			const bskyUrl =
				uploaded.url ||
				(cid && did
					? `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`
					: "")
			profileUploadedMedia = [
				{
					kind: "image",
					alt: uploaded.alt || file.name || "Profile photo",
					blob: uploaded.blob,
					sourceName: file.name || "profile",
					bskyUrl,
				},
			]
		} catch (error) {
			errorMessage =
				error?.message || "Failed to upload the profile image."
		} finally {
			uploadingProfile = false
			if (event.currentTarget) event.currentTarget.value = ""
		}
	}

	async function onBackgroundFileChange(event) {
		const file = event.currentTarget?.files?.[0]
		if (!file) return
		errorMessage = ""
		uploadingBackground = true
		setBackgroundPreview(file)
		seedBackgroundSelection(file)

		try {
			const normalized = await normalizeImageForSlot(
				file,
				NORMALIZED_IMAGE_MAX_DIM,
				NORMALIZED_IMAGE_MAX_DIM,
			)
			// Seed the local normalized file info first so it's not lost if upload fails
			backgroundUploadedMedia = [
				{
					kind: "image",
					alt: file.name || "Profile background",
					blob: null,
					file: normalized,
					sourceName: file.name || "background",
					url: backgroundPreviewUrl,
					bskyUrl: "",
				},
			]

			const uploaded = await uploadImage(normalized, true)
			const cid = uploaded.blob?.ref?.$link || uploaded.blob?.cid || ""
			const did = String(uploaded.did || "")
			const bskyUrl =
				uploaded.url ||
				(cid && did
					? `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`
					: "")
			backgroundUploadedMedia = [
				{
					kind: "image",
					alt: uploaded.alt || file.name || "Profile background",
					blob: uploaded.blob,
					sourceName: file.name || "background",
					bskyUrl,
				},
			]
		} catch (error) {
			errorMessage =
				error?.message || "Failed to upload the background image."
		} finally {
			uploadingBackground = false
			if (event.currentTarget) event.currentTarget.value = ""
		}
	}

	$effect(() => {
		return () => {
			revokeObjectUrl(profilePreviewUrl)
			revokeObjectUrl(backgroundPreviewUrl)
		}
	})
</script>

<section class="profile-images">
	<input
		bind:this={backgroundFileInput}
		type="file"
		accept="image/*"
		onchange={onBackgroundFileChange}
		hidden
	/>
	<input
		bind:this={profileFileInput}
		type="file"
		accept="image/*"
		onchange={onProfileFileChange}
		hidden
	/>

	<div
		class="banner {disabled ? 'disabled' : ''}"
		onclick={handleBannerClick}
		onkeydown={(event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault()
				handleBannerClick(event)
			}
		}}
		role="button"
		tabindex={disabled ? -1 : 0}
		aria-label="Upload background image"
	>
		<img src={backgroundImageSrc} alt="Profile background preview" />
		{#if hasRenderableBackgroundImage}
			<button
				type="button"
				class="pencil-bg"
				onclick={clearBackgroundImage}
				aria-label="Remove background image"
				disabled={disabled || uploadingProfile || uploadingBackground}
			>
				<Trash size={18} />
			</button>
		{:else}
			<button
				type="button"
				class="pencil-bg"
				onclick={(event) => {
					event.stopPropagation()
					triggerBackgroundPicker()
				}}
				aria-label="Upload background image"
				disabled={disabled || uploadingProfile || uploadingBackground}
			>
				<Pencil size={18} />
			</button>
		{/if}
		{#if hasRenderableProfileImage}
			<button
				type="button"
				class="clear-button clear-profile"
				onclick={clearProfileImage}
				aria-label="Remove profile image"
				disabled={disabled || uploadingProfile || uploadingBackground}
			>
				<Trash size={18} />
			</button>
		{/if}
		<button
			type="button"
			class="profile-button"
			onclick={(event) => {
				event.stopPropagation()
				triggerProfilePicker()
			}}
			aria-label="Upload profile image"
			disabled={disabled || uploadingProfile || uploadingBackground}
		>
			{#if profileImageSrc}
				<img src={profileImageSrc} alt="Profile preview" />
			{:else}
				<div class="empty-state">
					<User size={48} />
					<span class="empty-label">Required</span>
				</div>
			{/if}
		</button>
	</div>

	<div class="status-row">
		{#if uploadingProfile || uploadingBackground}
			<p class="hint">
				Uploading {uploadingProfile ? "profile" : "background"} image...
			</p>
		{/if}
		{#if errorMessage}
			<p class="hint error-hint">
				{errorMessage}
			</p>
		{/if}
	</div>
</section>

<style>
	.profile-images {
		display: grid;
		gap: 0.5rem;
	}

	.banner {
		position: relative;
		height: 220px;
		border: 1px solid #d8d3c7;
		border-radius: 16px;
		overflow: visible;
		cursor: pointer;
		background: #f5f5f4;
	}

	.banner.disabled {
		opacity: 0.6;
		pointer-events: none;
	}

	.banner > img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 16px;
	}

	.profile-button {
		position: absolute;
		left: 1.2rem;
		bottom: -54px;
		width: 148px;
		height: 148px;
		border: 4px solid #fff;
		border-radius: 999px;
		padding: 0;
		overflow: hidden;
		background: #e3e1dc;
		display: grid;
		place-items: center;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
	}

	.clear-button {
		position: absolute;
		width: 26px;
		height: 26px;
		border-radius: 999px;
		padding: 0;
		border: 0px solid #b6b1a6;
		background: rgba(255, 255, 255, 0.95);
		color: #2d2a24;
		font-size: 0.95rem;
		line-height: 1;
		display: grid;
		place-items: center;
		z-index: 3;
	}

	.pencil-bg {
		position: absolute;
		top: 10px;
		right: 10px;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.9);
		display: grid;
		place-items: center;
		z-index: 2;
		color: #2d2a24;
		border: 0px solid #b6b1a6;
	}

	.clear-profile {
		left: calc(1.2rem + 112px);
		bottom: 78px;
	}

	.profile-button > img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
	}

	.empty-state :global(svg) {
		color: #64748b;
	}

	.empty-label {
		font-size: 0.82rem;
		font-weight: 600;
		color: #475569;
		text-align: center;
	}

	.status-row {
		padding: 0 0.2rem 0 0.2rem;
		margin-top: 3.6rem;
		display: grid;
		gap: 0.15rem;
	}

	.hint {
		margin: 0;
		font-size: 0.82rem;
		color: #56695f;
	}

	.error-hint {
		color: #b91c1c;
		font-weight: 500;
	}

	@media (max-width: 700px) {
		.banner {
			height: 180px;
		}

		.profile-button {
			width: 120px;
			height: 120px;
			bottom: -44px;
		}

		.clear-profile {
			left: calc(1.2rem + 92px);
			bottom: 64px;
		}

		.status-row {
			margin-top: 2.8rem;
		}
	}
</style>
