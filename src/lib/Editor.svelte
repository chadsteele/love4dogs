<script>
	import {onMount} from "svelte"

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
		isDragging = false,
		maxChar = Number.POSITIVE_INFINITY,
		placeholder = "Share your ❤️ for dogs...",
		actions = ["bold", "italic", "underline", "strikethrough", "link"],
		ondragover = () => {},
		ondragleave = () => {},
		ondrop = () => {},
	} = $props()

	let containerEl = $state(null)
	let pellEditor = null
	let suppressEffect = false
	let htmlLength = $state(0)
	let lastValidHtml = ""

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

	/**
	 * Insert plain text at the current caret position inside the contenteditable.
	 * Used by the proxy's implicit write path (HashTagCloud mutates draft directly,
	 * so we also need to react to value changes — handled by the $effect below).
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

	onMount(async () => {
		const {default: pell} = await import("pell")

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
			actions,
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

		return () => {
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

<div
	class="pell-wrapper"
	class:is-dragging={isDragging}
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
	}

	.pell-wrapper.is-dragging {
		background: #ece8d7;
		border-color: #55724d;
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
		min-height: 160px;
		max-height: 400px;
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
