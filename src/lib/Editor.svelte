<script>
	import {onMount} from "svelte"

	const MAX_IMAGE_SIZE_BYTES = 2_000_000
	const THUMB_MAX_PX = 600

	/**
	 * A rich-text editor built on pell.
	 *
	 * @prop {string} value – bindable HTML content of the editor
	 * @prop {any} editorEl – bindable; exposes a textarea-like proxy so
	 *   HashTagCloud can read .value / .selectionStart and call
	 *   .focus() / .setSelectionRange() without changes to that component.
	 * @prop {boolean} isDragging – applies visual drag-over styling
	 * @prop {string[]} actions – pell toolbar actions
	 */
	let {
		value = $bindable(""),
		editorEl = $bindable(null),
		uploadedMedia = $bindable([]),
		isDragging = false,
		maxChar = Number.POSITIVE_INFINITY,
		placeholder = "Share your ❤️ for dogs...",
		actions = [
			"h1",
			"h2",
			"bold",
			"italic",
			"underline",
			"strikethrough",
			"link",
		],
		ondragover = () => {},
		ondragleave = () => {},
		ondrop = () => {},
	} = $props()

	let containerEl = $state(null)
	let pellEditor = null
	let suppressEffect = false
	let htmlLength = $state(0)
	let lastValidHtml = ""
	let imageFileInputEl = $state(null)
	let videoFileInputEl = $state(null)
	let contentDragging = $state(false)

	function normalizedMaxChar() {
		const next = Number(maxChar)
		if (!Number.isFinite(next) || next <= 0) return Number.POSITIVE_INFINITY
		return Math.floor(next)
	}

	function enforceMaxChars(contentEl) {
		const limit = normalizedMaxChar()
		const html = String(contentEl?.innerHTML || "")
		if (!Number.isFinite(limit)) {
			htmlLength = html.length
			lastValidHtml = html
			return false
		}
		if (html.length <= limit) {
			htmlLength = html.length
			lastValidHtml = html
			return false
		}
		if (typeof lastValidHtml === "string") {
			contentEl.innerHTML = lastValidHtml
			htmlLength = lastValidHtml.length
		} else {
			htmlLength = html.length
		}
		return true
	}

	/**
	 * Build a textarea-like proxy over the pell contenteditable div so that
	 * HashTagCloud works without modification.
	 */
	function buildProxy(contentEl) {
		return {
			get value() {
				return contentEl.innerText
			},
			get selectionStart() {
				const sel = window.getSelection()
				if (!sel || sel.rangeCount === 0)
					return contentEl.innerText.length
				const range = sel.getRangeAt(0).cloneRange()
				range.selectNodeContents(contentEl)
				range.setEnd(
					sel.getRangeAt(0).startContainer,
					sel.getRangeAt(0).startOffset,
				)
				return range.toString().length
			},
			focus() {
				contentEl.focus()
			},
			setSelectionRange(start) {
				// Place the caret at `start` characters from the beginning
				const walker = document.createTreeWalker(
					contentEl,
					NodeFilter.SHOW_TEXT,
				)
				let remaining = start
				let node = null
				let offset = 0
				while ((node = walker.nextNode())) {
					if (remaining <= node.textContent.length) {
						offset = remaining
						break
					}
					remaining -= node.textContent.length
				}
				if (!node) {
					node = contentEl
					offset = contentEl.childNodes.length
				}
				const range = document.createRange()
				range.setStart(node, offset)
				range.collapse(true)
				const sel = window.getSelection()
				sel?.removeAllRanges()
				sel?.addRange(range)
			},
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
				reject(new Error(`Cannot read image: ${file.name}`))
			}
			image.src = objectUrl
		})
	}

	function canvasToPngBlob(canvas) {
		return new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
	}

	async function createThumbnailDataUrl(file) {
		const img = await loadImageFile(file)
		const scale = Math.min(
			1,
			THUMB_MAX_PX / Math.max(1, img.naturalWidth, img.naturalHeight),
		)
		const w = Math.max(1, Math.round(img.naturalWidth * scale))
		const h = Math.max(1, Math.round(img.naturalHeight * scale))
		const canvas = document.createElement("canvas")
		canvas.width = w
		canvas.height = h
		canvas.getContext("2d").drawImage(img, 0, 0, w, h)
		return canvas.toDataURL("image/jpeg", 0.82)
	}

	async function normalizeImageForUpload(file) {
		const img = await loadImageFile(file)
		const scale = Math.min(
			1,
			2000 / Math.max(1, img.naturalWidth, img.naturalHeight),
		)
		let w = Math.max(1, Math.round(img.naturalWidth * scale))
		let h = Math.max(1, Math.round(img.naturalHeight * scale))
		const canvas = document.createElement("canvas")
		const ctx = canvas.getContext("2d")
		while (true) {
			canvas.width = w
			canvas.height = h
			ctx.clearRect(0, 0, w, h)
			ctx.drawImage(img, 0, 0, w, h)
			const blob = await canvasToPngBlob(canvas)
			if (!blob) throw new Error(`Cannot convert: ${file.name}`)
			if (blob.size <= MAX_IMAGE_SIZE_BYTES) {
				const base = file.name.replace(/\.[^/.]+$/, "")
				return new File([blob], `${base}.png`, {
					type: "image/png",
					lastModified: Date.now(),
				})
			}
			const nw = Math.max(1, Math.floor(w * 0.9))
			const nh = Math.max(1, Math.floor(h * 0.9))
			if (nw === w && nh === h)
				throw new Error("Image is too large to upload.")
			w = nw
			h = nh
		}
	}

	async function uploadFile(file) {
		const fd = new FormData()
		fd.append("mode", "upload-media")
		fd.append("file", file)
		const res = await fetch("/api/post", {method: "POST", body: fd})
		const json = await res.json().catch(() => ({}))
		if (!res.ok || !json?.ok || !json?.blob)
			throw new Error(json?.error || "Upload failed.")
		return json
	}

	function insertHtmlAtCaret(contentEl, html) {
		contentEl.focus()
		const sel = window.getSelection()
		if (sel && sel.rangeCount > 0) {
			const range = sel.getRangeAt(0)
			range.deleteContents()
			const frag = range.createContextualFragment(html)
			const last = frag.lastChild
			range.insertNode(frag)
			if (last) {
				const r2 = document.createRange()
				r2.setStartAfter(last)
				r2.collapse(true)
				sel.removeAllRanges()
				sel.addRange(r2)
			}
		} else {
			contentEl.innerHTML += html
		}
		contentEl.dispatchEvent(new Event("input", {bubbles: true}))
	}

	async function handleImageFile(file) {
		if (!pellEditor) return
		const contentEl = pellEditor.content
		try {
			const thumb = await createThumbnailDataUrl(file)
			const alt = file.name || "Image"
			insertHtmlAtCaret(
				contentEl,
				`<img src="${thumb}" alt="${alt.replace(/"/g, "&quot;")}" style="max-width:100%;height:auto;" />`,
			)
			const normalized = await normalizeImageForUpload(file)
			const uploaded = await uploadFile(normalized)
			uploadedMedia = [
				...uploadedMedia,
				{
					kind: "image",
					alt,
					blob: uploaded.blob,
					sourceName: file.name,
				},
			]
		} catch (err) {
			console.error("[Editor] Image insert failed:", err)
		}
	}

	async function handleVideoFile(file) {
		if (!pellEditor) return
		const contentEl = pellEditor.content
		const objUrl = URL.createObjectURL(file)
		const name = file.name || "Video"
		insertHtmlAtCaret(
			contentEl,
			`<video src="${objUrl}" controls style="max-width:100%;border-radius:8px;"></video>`,
		)
		try {
			const uploaded = await uploadFile(file)
			uploadedMedia = [
				...uploadedMedia,
				{
					kind: "video",
					alt: name,
					blob: uploaded.blob,
					sourceName: file.name,
				},
			]
		} catch (err) {
			console.error("[Editor] Video upload failed:", err)
		}
	}

	async function handleFiles(files) {
		for (const file of files) {
			if (file.type.startsWith("image/")) await handleImageFile(file)
			else if (file.type.startsWith("video/")) await handleVideoFile(file)
		}
	}

	/**
	 * Insert plain text at the current caret position inside the contenteditable.
	 */
	function insertAtCaret(contentEl, text) {
		contentEl.focus()
		const sel = window.getSelection()
		if (sel && sel.rangeCount > 0) {
			const range = sel.getRangeAt(0)
			range.deleteContents()
			range.insertNode(document.createTextNode(text))
			range.collapse(false)
			sel.removeAllRanges()
			sel.addRange(range)
		} else {
			contentEl.innerText += text
		}
	}

	function getSelectionRange(contentEl) {
		const sel = window.getSelection()
		if (!sel || sel.rangeCount === 0) return null
		const range = sel.getRangeAt(0)
		if (!contentEl.contains(range.commonAncestorContainer)) return null
		return range
	}

	function closestByTagNames(node, tagNames, stopEl) {
		let current = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node
		while (current && current !== stopEl) {
			if (tagNames.includes(current?.tagName)) return current
			current = current.parentNode
		}
		return null
	}

	function dispatchEditorInput(contentEl) {
		contentEl.dispatchEvent(new Event("input", {bubbles: true}))
	}

	function replaceElementTag(element, nextTagName) {
		const replacement = document.createElement(nextTagName)
		replacement.innerHTML = element.innerHTML
		for (const attr of element.getAttributeNames()) {
			replacement.setAttribute(attr, element.getAttribute(attr) || "")
		}
		element.replaceWith(replacement)
		return replacement
	}

	function toggleBlockTag(contentEl, targetTagName) {
		const range = getSelectionRange(contentEl)
		if (!range) return

		const blockTags = ["H1", "H2", "P", "DIV", "LI", "BLOCKQUOTE"]
		const block =
			closestByTagNames(range.startContainer, blockTags, contentEl) ||
			contentEl

		if (block === contentEl) return

		const currentTag = block.tagName
		if (currentTag === targetTagName) {
			replaceElementTag(block, "p")
		} else {
			replaceElementTag(block, targetTagName.toLowerCase())
		}

		dispatchEditorInput(contentEl)
	}

	function unwrapElement(element) {
		const parent = element.parentNode
		if (!parent) return
		while (element.firstChild) {
			parent.insertBefore(element.firstChild, element)
		}
		parent.removeChild(element)
	}

	function toggleInlineTag(contentEl, tagName) {
		const range = getSelectionRange(contentEl)
		if (!range || range.collapsed) return

		const active = closestByTagNames(
			range.startContainer,
			[tagName],
			contentEl,
		)
		if (active && active.contains(range.endContainer)) {
			unwrapElement(active)
			dispatchEditorInput(contentEl)
			return
		}

		const wrapper = document.createElement(tagName.toLowerCase())
		try {
			range.surroundContents(wrapper)
		} catch {
			const fragment = range.extractContents()
			wrapper.appendChild(fragment)
			range.insertNode(wrapper)
		}

		const sel = window.getSelection()
		const nextRange = document.createRange()
		nextRange.selectNodeContents(wrapper)
		sel?.removeAllRanges()
		sel?.addRange(nextRange)
		dispatchEditorInput(contentEl)
	}

	function toggleLink(contentEl) {
		const range = getSelectionRange(contentEl)
		if (!range) return

		const activeAnchor = closestByTagNames(
			range.startContainer,
			["A"],
			contentEl,
		)
		if (activeAnchor && activeAnchor.contains(range.endContainer)) {
			unwrapElement(activeAnchor)
			dispatchEditorInput(contentEl)
			return
		}

		const url = window.prompt("Enter link URL")
		if (!url) return

		const anchor = document.createElement("a")
		anchor.href = url
		anchor.target = "_blank"
		anchor.rel = "noopener noreferrer"

		if (range.collapsed) {
			anchor.textContent = url
			range.insertNode(anchor)
		} else {
			try {
				range.surroundContents(anchor)
			} catch {
				const fragment = range.extractContents()
				anchor.appendChild(fragment)
				range.insertNode(anchor)
			}
		}

		dispatchEditorInput(contentEl)
	}

	onMount(async () => {
		const {default: pell} = await import("pell")

		const lucideSvgAttrs =
			'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
		const svg = (inner) => `<svg ${lucideSvgAttrs}>${inner}</svg>`

		const defaultActionDefs = {
			h1: {
				icon: svg(
					'<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>',
				),
				title: "Heading 1",
				result: () => toggleBlockTag(pellEditor?.content, "H1"),
			},
			h2: {
				icon: svg(
					'<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>',
				),
				title: "Heading 2",
				result: () => toggleBlockTag(pellEditor?.content, "H2"),
			},
			bold: {
				icon: svg(
					'<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
				),
				title: "Bold",
				result: () => toggleInlineTag(pellEditor?.content, "STRONG"),
			},
			italic: {
				icon: svg(
					'<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
				),
				title: "Italic",
				result: () => toggleInlineTag(pellEditor?.content, "EM"),
			},
			underline: {
				icon: svg(
					'<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
				),
				title: "Underline",
				result: () => toggleInlineTag(pellEditor?.content, "U"),
			},
			strikethrough: {
				icon: svg(
					'<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
				),
				title: "Strikethrough",
				result: () => toggleInlineTag(pellEditor?.content, "S"),
			},
			link: {
				icon: svg(
					'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
				),
				title: "Link",
				result: () => toggleLink(pellEditor?.content),
			},
		}

		const resolvedActions = actions.map((a) =>
			typeof a === "string" && defaultActionDefs[a]
				? {name: a, ...defaultActionDefs[a]}
				: a,
		)

		const imageIcon = svg(
			'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
		)
		const videoIcon = svg(
			'<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
		)

		const allActions = [
			...resolvedActions,
			{
				name: "insertImage",
				icon: imageIcon,
				title: "Insert image",
				result: () => imageFileInputEl?.click(),
			},
			{
				name: "insertVideo",
				icon: videoIcon,
				title: "Insert video",
				result: () => videoFileInputEl?.click(),
			},
		]

		pellEditor = pell.init({
			element: containerEl,
			onChange() {
				if (suppressEffect) return
				suppressEffect = true
				enforceMaxChars(pellEditor.content)
				value = pellEditor.content.innerHTML
				suppressEffect = false
			},
			defaultParagraphSeparator: "br",
			styleWithCSS: false,
			actions: allActions,
		})

		// Set initial value
		if (value) {
			pellEditor.content.innerHTML = value
		}
		lastValidHtml = String(pellEditor.content.innerHTML || "")
		enforceMaxChars(pellEditor.content)

		// Add placeholder behaviour
		const content = pellEditor.content
		content.setAttribute("data-placeholder", placeholder)

		// Expose proxy so HashTagCloud can use it
		editorEl = buildProxy(content)

		// Internal drag-and-drop for media files onto the content area
		function onContentDragover(e) {
			if ([...(e.dataTransfer?.types || [])].includes("Files")) {
				e.preventDefault()
				e.stopPropagation()
				contentDragging = true
			}
		}
		function onContentDragleave(e) {
			if (!content.contains(e.relatedTarget)) contentDragging = false
		}
		function onContentDrop(e) {
			const files = [...(e.dataTransfer?.files || [])].filter(
				(f) =>
					f.type.startsWith("image/") || f.type.startsWith("video/"),
			)
			if (!files.length) return
			e.preventDefault()
			e.stopPropagation()
			contentDragging = false
			handleFiles(files)
		}
		content.addEventListener("dragover", onContentDragover)
		content.addEventListener("dragleave", onContentDragleave)
		content.addEventListener("drop", onContentDrop)

		return () => {
			content.removeEventListener("dragover", onContentDragover)
			content.removeEventListener("dragleave", onContentDragleave)
			content.removeEventListener("drop", onContentDrop)
			editorEl = null
			pellEditor = null
		}
	})

	// Sync external value changes (e.g. loadPostIntoEditor sets draft = "...")
	$effect(() => {
		if (!pellEditor || suppressEffect) return
		const incoming = value ?? ""
		if (pellEditor.content.innerHTML !== incoming) {
			suppressEffect = true
			pellEditor.content.innerHTML = incoming
			enforceMaxChars(pellEditor.content)
			suppressEffect = false
		}
	})

	$effect(() => {
		if (!pellEditor || suppressEffect) return
		suppressEffect = true
		enforceMaxChars(pellEditor.content)
		value = pellEditor.content.innerHTML
		suppressEffect = false
	})
</script>

<input
	bind:this={imageFileInputEl}
	type="file"
	accept="image/*"
	multiple
	hidden
	onchange={(e) => {
		handleFiles([...(e.currentTarget?.files || [])])
		if (e.currentTarget) e.currentTarget.value = ""
	}}
/>
<input
	bind:this={videoFileInputEl}
	type="file"
	accept="video/*"
	multiple
	hidden
	onchange={(e) => {
		handleFiles([...(e.currentTarget?.files || [])])
		if (e.currentTarget) e.currentTarget.value = ""
	}}
/>

<div
	class="pell-wrapper"
	class:is-dragging={isDragging}
	class:content-dragging={contentDragging}
	role="region"
	aria-label="Rich text editor"
	bind:this={containerEl}
	{ondragover}
	{ondragleave}
	{ondrop}
></div>

{#if Number.isFinite(normalizedMaxChar())}
	<p class="editor-counter" class:is-over={htmlLength > normalizedMaxChar()}>
		{htmlLength}/{normalizedMaxChar()}
	</p>
{/if}

<style>
	@import "pell/dist/pell.css";

	.pell-wrapper {
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		overflow: hidden;
		box-sizing: border-box;
		width: 100%;
		background: #fff;
		display: flex;
		flex-direction: column;
		height: 280px;
		min-height: 200px;
		resize: vertical;
	}

	.pell-wrapper.is-dragging {
		background: #ece8d7;
		border-color: #55724d;
	}

	.pell-wrapper.content-dragging :global(.pell-content) {
		background: #ece8d7;
		outline: 2px dashed #55724d;
		outline-offset: -4px;
	}

	.pell-wrapper :global(.pell-actionbar) {
		background: #f7f3ec;
		border-bottom: 1px solid #e3d8c8;
		padding: 0.3rem 0.4rem;
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}

	.pell-wrapper :global(.pell-button) {
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		min-width: 28px;
		height: 28px;
		line-height: 1;
		color: #3b4a38;
		padding: 0 6px;
	}

	.pell-wrapper :global(.pell-button:hover),
	.pell-wrapper :global(.pell-button-selected) {
		background: #e0dace;
		border-color: #c9bfb0;
	}

	.pell-wrapper :global(.pell-content) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.75rem;
		outline: none;
		font: inherit;
		color: #1a1a1a;
		line-height: 1.55;
		box-sizing: border-box;
		width: 100%;
	}

	/* Placeholder */
	.pell-wrapper :global(.pell-content:empty::before) {
		content: attr(data-placeholder);
		color: #a09080;
		pointer-events: none;
	}

	.editor-counter {
		margin: 0.45rem 0 0;
		text-align: right;
		font-size: 0.8rem;
		color: #506157;
	}

	.editor-counter.is-over {
		color: #8e2f21;
	}
</style>
