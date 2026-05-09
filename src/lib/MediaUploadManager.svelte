<script>
	import {onDestroy} from "svelte"
	import {ImagePlus} from "lucide-svelte"
	import {mediaTokenFromBuffer} from "$lib/utils"

	const MAX_ATTACHMENTS = 4
	const MAX_IMAGE_SIZE_BYTES = 2_000_000 // Bluesky's hard limit is 2,000,000 bytes (not 2 MiB)
	const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024
	const MAX_MEDIA_DIMENSION = 4000
	const inputId = "media-upload-input"

	let {
		selectedFiles = $bindable([]),
		uploadedMedia = $bindable([]),
		errorMessage = $bindable(""),
		isDragging = $bindable(false),
		disabled = false,
		actions,
	} = $props()

	let previews = $state([])
	let dragDepth = 0
	let draggedThumbnailIndex = $state(null)
	let dragOverThumbnailIndex = $state(null)
	let uploadedByKey = $state({})
	let uploadInFlightByKey = $state({})

	function fileKey(file) {
		return `${file.name}-${file.size}-${file.lastModified}`
	}

	function syncUploadedMediaOrder() {
		uploadedMedia = selectedFiles
			.map((file) => uploadedByKey[fileKey(file)])
			.filter(Boolean)
	}

	function keepOnlyActiveUploads() {
		const activeKeys = new Set(selectedFiles.map((file) => fileKey(file)))
		uploadedByKey = Object.fromEntries(
			Object.entries(uploadedByKey).filter(([key]) =>
				activeKeys.has(key),
			),
		)
		syncUploadedMediaOrder()
	}

	function revokePreviews() {
		for (const preview of previews) {
			URL.revokeObjectURL(preview.url)
		}
	}

	function updatePreviews() {
		revokePreviews()
		previews = selectedFiles.map((file) => ({
			name: file.name,
			kind: file.type.startsWith("video/") ? "video" : "image",
			url: URL.createObjectURL(file),
		}))
	}

	function replaceFileExt(fileName = "", nextExt = ".png") {
		if (!fileName) return `upload${nextExt}`
		const withoutExt = fileName.replace(/\.[^/.]+$/, "")
		return `${withoutExt}${nextExt}`
	}

	function fileNameFromUrl(url, fallback = "image.jpg") {
		try {
			const parsed = new URL(url)
			const name = parsed.pathname.split("/").pop() || fallback
			return name.split("?")[0] || fallback
		} catch {
			return fallback
		}
	}

	function canvasToPngBlob(canvas) {
		return new Promise((resolve) => {
			canvas.toBlob((blob) => resolve(blob), "image/png")
		})
	}

	async function scaleImageByFactor(file, factor = 0.9) {
		const image = await loadImageFile(file)
		const nextWidth = Math.max(1, Math.floor(image.naturalWidth * factor))
		const nextHeight = Math.max(1, Math.floor(image.naturalHeight * factor))

		if (
			nextWidth === image.naturalWidth &&
			nextHeight === image.naturalHeight
		) {
			return null
		}

		const canvas = document.createElement("canvas")
		canvas.width = nextWidth
		canvas.height = nextHeight
		const context = canvas.getContext("2d")
		if (!context) {
			throw new Error("Unable to process image on this browser.")
		}

		context.clearRect(0, 0, nextWidth, nextHeight)
		context.drawImage(image, 0, 0, nextWidth, nextHeight)

		const blob = await canvasToPngBlob(canvas)
		if (!blob) return null

		return new File([blob], replaceFileExt(file.name, ".png"), {
			type: "image/png",
			lastModified: Date.now(),
		})
	}

	async function uploadFileToBluesky(file) {
		const buffer = await file.arrayBuffer()
		const sourceUrl = await mediaTokenFromBuffer(buffer)
		const formData = new FormData()
		formData.append("mode", "cache-media-url")
		formData.append("sourceUrl", sourceUrl)
		formData.append("file", file)

		const response = await fetch("/api/post", {
			method: "POST",
			body: formData,
		})
		const json = await response.json().catch(() => ({}))
		if (!response.ok || !json?.ok || !json?.blob) {
			throw new Error(json?.error || "Media upload failed.")
		}
		return json
	}

	async function uploadImageWithRetry(file, key) {
		let current = file
		let attempt = 0
		while (true) {
			attempt++
			console.log(
				`[upload] Image attempt ${attempt}: "${current.name}" (${(current.size / 1024).toFixed(1)} KB)`,
			)
			try {
				const uploaded = await uploadFileToBluesky(current)
				console.log(
					`[upload] Image success (attempt ${attempt}): "${current.name}"`,
					uploaded.blob,
				)
				uploadedByKey = {
					...uploadedByKey,
					[key]: {
						kind: "image",
						alt: uploaded.alt || current.name || "Photo",
						blob: uploaded.blob,
					},
				}
				syncUploadedMediaOrder()
				return
			} catch (error) {
				console.warn(
					`[upload] Image attempt ${attempt} failed: "${current.name}"`,
					error?.message,
				)
				const smaller = await scaleImageByFactor(current, 0.9)
				if (!smaller) {
					console.error(
						`[upload] Image cannot shrink further, giving up: "${current.name}"`,
					)
					throw error
				}
				console.log(
					`[upload] Retrying with smaller image: "${smaller.name}" (${(smaller.size / 1024).toFixed(1)} KB)`,
				)
				current = smaller
			}
		}
	}

	async function uploadVideoNoRetry(file, key) {
		console.log(
			`[upload] Video starting: "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
		)
		const uploaded = await uploadFileToBluesky(file)
		console.log(`[upload] Video success: "${file.name}"`, uploaded.blob)
		uploadedByKey = {
			...uploadedByKey,
			[key]: {
				kind: "video",
				alt: uploaded.alt || file.name || "Video",
				blob: uploaded.blob,
			},
		}
		syncUploadedMediaOrder()
	}

	async function startUploadForFile(file) {
		const key = fileKey(file)
		if (uploadedByKey[key]) {
			console.log(`[upload] Already uploaded, skipping: "${file.name}"`)
			return
		}
		if (uploadInFlightByKey[key]) {
			console.log(
				`[upload] Upload already in flight, skipping: "${file.name}"`,
			)
			return
		}
		uploadInFlightByKey = {...uploadInFlightByKey, [key]: true}

		try {
			if (file.type.startsWith("image/")) {
				await uploadImageWithRetry(file, key)
			} else if (file.type.startsWith("video/")) {
				await uploadVideoNoRetry(file, key)
			}
		} catch (error) {
			console.error(
				`[upload] Upload failed for "${file.name}": ${error?.message}`,
			)
			errorMessage =
				error?.message || `Failed to upload ${file.name || "media"}.`
		} finally {
			const nextInFlight = {...uploadInFlightByKey}
			delete nextInFlight[key]
			uploadInFlightByKey = nextInFlight
		}
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

	function loadVideoMetadata(file) {
		return new Promise((resolve, reject) => {
			const objectUrl = URL.createObjectURL(file)
			const video = document.createElement("video")
			video.preload = "metadata"
			video.onloadedmetadata = () => {
				const width = video.videoWidth || 0
				const height = video.videoHeight || 0
				URL.revokeObjectURL(objectUrl)
				resolve({width, height})
			}
			video.onerror = () => {
				URL.revokeObjectURL(objectUrl)
				reject(new Error(`Unable to read video metadata: ${file.name}`))
			}
			video.src = objectUrl
		})
	}

	async function normalizeImageFile(file) {
		const image = await loadImageFile(file)
		const scaleToBounds = Math.min(
			1,
			MAX_MEDIA_DIMENSION /
				Math.max(image.naturalWidth, image.naturalHeight),
		)
		const baseWidth = Math.max(
			1,
			Math.round(image.naturalWidth * scaleToBounds),
		)
		const baseHeight = Math.max(
			1,
			Math.round(image.naturalHeight * scaleToBounds),
		)

		const canvas = document.createElement("canvas")
		const context = canvas.getContext("2d")
		if (!context) {
			throw new Error("Unable to process image on this browser.")
		}

		let width = baseWidth
		let height = baseHeight

		const originalDimensions = `${image.naturalWidth}x${image.naturalHeight}`
		console.log(
			`[normalize] Image: "${file.name}" original=${originalDimensions} scaled-to=${width}x${height} file-size=${(file.size / 1024).toFixed(1)} KB`,
		)
		while (true) {
			canvas.width = width
			canvas.height = height
			context.clearRect(0, 0, width, height)
			context.drawImage(image, 0, 0, width, height)

			const blob = await canvasToPngBlob(canvas)
			if (!blob) throw new Error(`Unable to convert image: ${file.name}`)

			console.log(
				`[normalize] Rendered at ${width}x${height}: ${(blob.size / 1024).toFixed(1)} KB (limit: ${MAX_IMAGE_SIZE_BYTES / 1024} KB)`,
			)
			if (blob.size <= MAX_IMAGE_SIZE_BYTES) {
				return new File([blob], replaceFileExt(file.name, ".png"), {
					type: "image/png",
					lastModified: Date.now(),
				})
			}

			if (width === 1 && height === 1) {
				throw new Error(
					`Image ${file.name} could not be reduced under 2 MB.`,
				)
			}

			const sizeRatio = MAX_IMAGE_SIZE_BYTES / blob.size
			const proportionalScale = Math.sqrt(Math.max(0.0001, sizeRatio))
			const safeScale = Math.min(0.98, proportionalScale)

			const nextWidth =
				width > 1
					? Math.max(
							1,
							Math.min(width - 1, Math.floor(width * safeScale)),
						)
					: 1
			const nextHeight =
				height > 1
					? Math.max(
							1,
							Math.min(
								height - 1,
								Math.floor(height * safeScale),
							),
						)
					: 1

			width = nextWidth
			height = nextHeight
		}
	}

	async function validateVideoFile(file) {
		if (file.size > MAX_VIDEO_SIZE_BYTES) {
			throw new Error(`Video ${file.name} exceeds 100 MB.`)
		}
		const {width, height} = await loadVideoMetadata(file)
		if (width > MAX_MEDIA_DIMENSION || height > MAX_MEDIA_DIMENSION) {
			throw new Error(`Video ${file.name} exceeds 4000x4000 dimensions.`)
		}
		return file
	}

	async function addMedia(files) {
		const pickedFiles = files.filter(
			(file) => file instanceof File && file.size > 0,
		)
		if (!pickedFiles.length) return

		const normalized = []
		for (const file of pickedFiles) {
			if (file.type.startsWith("image/")) {
				normalized.push(await normalizeImageFile(file))
				continue
			}
			if (file.type.startsWith("video/")) {
				normalized.push(await validateVideoFile(file))
				continue
			}
		}

		if (!normalized.length) {
			errorMessage = "Only images and videos are supported."
			return
		}
		console.log(
			`[addMedia] Normalized ${normalized.length} file(s):`,
			normalized.map(
				(f) => `${f.name} (${(f.size / 1024).toFixed(1)} KB)`,
			),
		)

		const dedupe = new Map()
		for (const file of [...selectedFiles, ...normalized]) {
			const key = `${file.name}-${file.size}-${file.lastModified}`
			if (!dedupe.has(key)) dedupe.set(key, file)
		}

		let merged = [...dedupe.values()]
		const imageCount = merged.filter((file) =>
			file.type.startsWith("image/"),
		).length
		const videoCount = merged.filter((file) =>
			file.type.startsWith("video/"),
		).length

		if (imageCount > 0 && videoCount > 0) {
			errorMessage = "Choose either photos or one video per post."
			return
		}

		if (videoCount > 1) {
			errorMessage = "Only one video is allowed per post."
			return
		}

		if (imageCount > MAX_ATTACHMENTS) {
			errorMessage = "Only 4 photos are allowed."
			merged = merged
				.filter((file) => file.type.startsWith("image/"))
				.slice(0, MAX_ATTACHMENTS)
		}

		if (merged.length > MAX_ATTACHMENTS) {
			merged = merged.slice(0, MAX_ATTACHMENTS)
		}

		selectedFiles = merged
		updatePreviews()
		keepOnlyActiveUploads()

		for (const file of selectedFiles) {
			void startUploadForFile(file)
		}
	}

	async function handleFiles(event) {
		const input = event.currentTarget
		if (disabled) {
			if (input) input.value = ""
			return
		}
		errorMessage = ""
		try {
			await addMedia([...(input?.files || [])])
		} catch (error) {
			errorMessage = error.message || "Unable to add selected files."
		}
		if (input) input.value = ""
	}

	function isFileDrag(event) {
		const types = event.dataTransfer?.types
		if (!types) return false
		return [...types].includes("Files")
	}

	export function handleDragEnter(event) {
		if (!isFileDrag(event)) return
		event.preventDefault()
		dragDepth += 1
		isDragging = true
	}

	export function handleDragOver(event) {
		if (!isFileDrag(event)) return
		event.preventDefault()
		isDragging = true
	}

	export function handleDragLeave(event) {
		if (!isFileDrag(event)) return
		event.preventDefault()
		dragDepth = Math.max(0, dragDepth - 1)
		isDragging = dragDepth > 0
	}

	export async function handleDropFiles(event) {
		if (!isFileDrag(event)) return
		event.preventDefault()
		dragDepth = 0
		isDragging = false
		errorMessage = ""
		try {
			await addMedia([...(event.dataTransfer?.files || [])])
		} catch (error) {
			errorMessage = error.message || "Unable to add dropped files."
		}
	}

	export function clearFiles() {
		revokePreviews()
		selectedFiles = []
		previews = []
		uploadedByKey = {}
		uploadInFlightByKey = {}
		uploadedMedia = []
		dragDepth = 0
		isDragging = false
	}

	function removeFile(index) {
		if (disabled) return
		URL.revokeObjectURL(previews[index].url)
		selectedFiles = selectedFiles.filter((_, i) => i !== index)
		previews = previews.filter((_, i) => i !== index)
		keepOnlyActiveUploads()
		errorMessage = ""
	}

	function moveListItem(list, fromIndex, toIndex) {
		if (!Array.isArray(list)) return []
		if (fromIndex === toIndex) return [...list]
		const next = [...list]
		const [moved] = next.splice(fromIndex, 1)
		next.splice(toIndex, 0, moved)
		return next
	}

	function reorderThumbnails(toIndex) {
		if (disabled || draggedThumbnailIndex === null) return
		if (toIndex < 0 || toIndex >= previews.length) return
		if (draggedThumbnailIndex === toIndex) return

		previews = moveListItem(previews, draggedThumbnailIndex, toIndex)
		selectedFiles = moveListItem(
			selectedFiles,
			draggedThumbnailIndex,
			toIndex,
		)
		syncUploadedMediaOrder()
		draggedThumbnailIndex = toIndex
	}

	function onThumbnailDragStart(event, index) {
		if (disabled || previews.length < 2) return
		draggedThumbnailIndex = index
		dragOverThumbnailIndex = index
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move"
			event.dataTransfer.setData("text/plain", String(index))
		}
	}

	function onThumbnailDragEnter(event, index) {
		if (disabled || draggedThumbnailIndex === null) return
		event.preventDefault()
		dragOverThumbnailIndex = index
	}

	function onThumbnailDragOver(event, index) {
		if (disabled || draggedThumbnailIndex === null) return
		event.preventDefault()
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
		if (dragOverThumbnailIndex !== index) {
			dragOverThumbnailIndex = index
		}
	}

	function onThumbnailDrop(event, index) {
		if (disabled || draggedThumbnailIndex === null) return
		event.preventDefault()
		reorderThumbnails(index)
		dragOverThumbnailIndex = null
	}

	function onThumbnailDragEnd() {
		draggedThumbnailIndex = null
		dragOverThumbnailIndex = null
	}

	export async function loadImagesForEdit(imageUrls = []) {
		if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
			clearFiles()
			return
		}

		clearFiles()
		const files = []
		for (let index = 0; index < imageUrls.length; index += 1) {
			const imageUrl = imageUrls[index]
			try {
				const response = await fetch(
					`/api/download-image?url=${encodeURIComponent(imageUrl)}`,
				)
				if (!response.ok) continue
				const blob = await response.blob()
				const name = fileNameFromUrl(imageUrl, `image-${index + 1}.jpg`)
				const file = new File([blob], name, {
					type: blob.type || "image/jpeg",
					lastModified: Date.now(),
				})
				files.push(file)
			} catch {
				// Keep loading remaining files.
			}
		}

		if (files.length) {
			await addMedia(files)
		}
	}

	onDestroy(() => {
		revokePreviews()
	})
</script>

{#if previews.length}
	<div class="preview-grid" role="list" aria-label="Media thumbnails">
		{#each previews as item, index}
			<div
				class="preview-item"
				role="listitem"
				class:is-dragging-thumbnail={draggedThumbnailIndex === index}
				class:is-drag-over={dragOverThumbnailIndex === index &&
					draggedThumbnailIndex !== index}
				draggable={!disabled && previews.length > 1}
				ondragstart={(event) => onThumbnailDragStart(event, index)}
				ondragenter={(event) => onThumbnailDragEnter(event, index)}
				ondragover={(event) => onThumbnailDragOver(event, index)}
				ondrop={(event) => onThumbnailDrop(event, index)}
				ondragend={onThumbnailDragEnd}
			>
				{#if item.kind === "video"}
					<!-- svelte-ignore a11y_media_has_caption (local upload preview) -->
					<video src={item.url} controls preload="metadata"></video>
				{:else}
					<img src={item.url} alt={item.name} />
				{/if}
				<button
					class="remove-photo"
					type="button"
					onclick={() => removeFile(index)}
					aria-label="Remove media"
					{disabled}
				>
					✕
				</button>
			</div>
		{/each}
	</div>
{/if}

<div class="toolbar">
	<div class="toolbar-left">
		<label
			class="icon-btn file-btn"
			class:is-disabled={disabled}
			for={inputId}
			aria-disabled={disabled}
		>
			<ImagePlus size={17} />
			<span>Add media</span>
		</label>
		<input
			id={inputId}
			type="file"
			accept="image/*,video/*"
			multiple
			{disabled}
			onchange={handleFiles}
		/>
		<p class="drop-hint">
			Drag and drop up to 4 photos or one video (images are converted to
			PNG). <br />If you have a logo, make sure it is the first image in
			the list.
		</p>
	</div>
	<div class="toolbar-right">
		{@render actions?.()}
	</div>
</div>

<style>
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
		cursor: grab;
		transition:
			opacity 0.14s ease,
			transform 0.14s ease,
			box-shadow 0.14s ease;
	}

	.preview-item.is-dragging-thumbnail {
		opacity: 0.65;
		transform: scale(0.98);
	}

	.preview-item.is-drag-over {
		box-shadow: 0 0 0 2px rgba(59, 110, 79, 0.45);
	}

	.preview-item:active {
		cursor: grabbing;
	}

	.preview-item img {
		width: auto;
		height: 100px;
		object-fit: cover;
		border-radius: 10px;
		display: block;
	}

	.preview-item video {
		width: auto;
		height: 100px;
		border-radius: 10px;
		display: block;
		background: #000;
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

	.remove-photo:disabled {
		opacity: 0.5;
		cursor: default;
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
		gap: 0.5rem;
		margin-left: auto;
	}

	.icon-btn {
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

	.file-btn.is-disabled {
		opacity: 0.55;
		pointer-events: none;
	}

	.drop-hint {
		font-size: 0.85rem;
		color: #5f665f;
	}

	input[type="file"] {
		display: none;
	}
</style>
