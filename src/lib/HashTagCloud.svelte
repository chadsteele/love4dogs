<script>
	import {defaultHashtags} from "$lib/config"

	const LOCAL_TAG_KEY = "love4dogs.tag-counts"
	const LOCATION_CACHE_KEY = "love4dogs.location-cache"
	const LOCATION_PILLS_CACHE_KEY = "love4dogs.location-pill-cache"

	/** @type {{ draft: string, feedTags?: {tag:string}[], textareaEl?: HTMLTextAreaElement|null }} */
	let {
		draft = $bindable(""),
		feedTags = [],
		textareaEl = null,
		onTagToggle = () => {},
	} = $props()

	let myTags = $state([])
	let locationTags = $state([])
	let cloudEl = $state(null)
	let dragState = $state(null)
	let suppressToggleTag = $state("")

	$effect(() => {
		const sourceValue = textareaEl?.value
		if (typeof sourceValue !== "string") return
		if (!sourceValue.trim()) return
		if (String(draft || "").trim()) return
		draft = sourceValue
	})

	function refreshMyTags() {
		if (typeof window === "undefined") {
			myTags = []
			return
		}

		try {
			const counts = JSON.parse(
				localStorage.getItem(LOCAL_TAG_KEY) || "{}",
			)
			myTags = Object.entries(counts)
				.filter(([, c]) => Number(c) > 0)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([tag]) => tag)
		} catch {
			myTags = []
		}
	}

	$effect(() => {
		draft
		refreshMyTags()
	})

	function isRemovableTag(tag) {
		return myTags.includes(tag)
	}

	function isPointOutsideCloud(clientX, clientY) {
		const rect = cloudEl?.getBoundingClientRect?.()
		if (!rect) return false
		return (
			clientX < rect.left ||
			clientX > rect.right ||
			clientY < rect.top ||
			clientY > rect.bottom
		)
	}

	function removeTagFromRecent(tag) {
		if (typeof window === "undefined") return
		const normalized = normalizeTagToken(tag)
		if (!normalized) return

		try {
			const counts = JSON.parse(
				localStorage.getItem(LOCAL_TAG_KEY) || "{}",
			)
			if (Object.prototype.hasOwnProperty.call(counts, normalized)) {
				delete counts[normalized]
				localStorage.setItem(LOCAL_TAG_KEY, JSON.stringify(counts))
				refreshMyTags()
			}
		} catch {
			// Ignore storage write failures.
		}
	}

	function addTagToDraft(tag) {
		const normalized = normalizeTagToken(tag)
		if (!normalized) return
		if (isActive(normalized)) return

		const token = Boolean(textareaEl) ? `#${normalized}` : normalized
		const pos = textareaEl
			? (textareaEl.selectionStart ?? draft.length)
			: draft.length
		const before = draft.slice(0, pos)
		const after = draft.slice(pos)
		const pre = before.length && !/[\s\n]$/.test(before) ? " " : ""
		const post = after.length && !/^[\s\n]/.test(after) ? " " : ""
		draft = `${before}${pre}${token}${post}${after}`

		const newPos = pos + pre.length + token.length
		setTimeout(() => {
			textareaEl?.focus()
			textareaEl?.setSelectionRange(newPos, newPos)
		}, 0)

		onTagToggle(normalized, draft)
	}

	function onPillPointerDown(event, tag) {
		if (!isRemovableTag(tag)) return
		event.preventDefault()
		dragState = {
			tag,
			startX: event.clientX,
			startY: event.clientY,
			dx: 0,
			dy: 0,
			outside: false,
			moved: false,
		}
	}

	$effect(() => {
		if (!dragState) return

		const handleMove = (event) => {
			if (!dragState) return
			const dx = event.clientX - dragState.startX
			const dy = event.clientY - dragState.startY
			const movedDistance = Math.abs(dx) + Math.abs(dy)
			dragState = {
				...dragState,
				dx,
				dy,
				moved: dragState.moved || movedDistance > 8,
				outside: isPointOutsideCloud(event.clientX, event.clientY),
			}
		}

		const handleUp = () => {
			if (dragState?.tag && dragState.moved) {
				suppressToggleTag = dragState.tag
				setTimeout(() => {
					suppressToggleTag = ""
				}, 0)
			}

			if (dragState?.tag && dragState.moved) {
				if (dragState.dy <= -12) {
					addTagToDraft(dragState.tag)
				} else if (
					dragState.dy >= 12 &&
					dragState.outside &&
					isRemovableTag(dragState.tag)
				) {
					removeTagFromRecent(dragState.tag)
				}
			}
			dragState = null
		}

		window.addEventListener("pointermove", handleMove)
		window.addEventListener("pointerup", handleUp, {once: true})
		window.addEventListener("pointercancel", handleUp, {once: true})

		return () => {
			window.removeEventListener("pointermove", handleMove)
			window.removeEventListener("pointerup", handleUp)
			window.removeEventListener("pointercancel", handleUp)
		}
	})

	function normalizeTagToken(value = "") {
		return String(value)
			.trim()
			.toLowerCase()
			.replace(/^#/, "")
			.replace(/[^\p{L}\p{N}_-]+/gu, " ")
			.replace(/\s+/g, " ")
	}

	function getPriorityLocationTags(location = {}) {
		const ordered = [location.country, location.city, location.zip]
		const seen = new Set()
		const tags = []
		for (const raw of ordered) {
			const token = normalizeTagToken(raw)
			if (!token || seen.has(token)) continue
			seen.add(token)
			tags.push(token)
		}
		return tags
	}

	$effect(() => {
		if (typeof window === "undefined") return

		let persisted = null
		try {
			persisted = JSON.parse(
				localStorage.getItem(LOCATION_PILLS_CACHE_KEY) || "null",
			)
		} catch {
			persisted = null
		}

		let cache = null
		try {
			cache = JSON.parse(
				localStorage.getItem(LOCATION_CACHE_KEY) || "null",
			)
		} catch {
			cache = null
		}

		const persistedTags = Array.isArray(persisted?.tags)
			? persisted.tags.map(normalizeTagToken).filter(Boolean)
			: []
		let nextTags = persistedTags

		const cacheSavedAt = Number(cache?.savedAt) || 0
		const persistedSavedAt = Number(persisted?.sourceSavedAt) || 0
		const canRefreshFromLocation =
			navigator.onLine && cacheSavedAt > 0 && cache?.location

		if (canRefreshFromLocation && cacheSavedAt >= persistedSavedAt) {
			nextTags = getPriorityLocationTags(cache.location)
			try {
				localStorage.setItem(
					LOCATION_PILLS_CACHE_KEY,
					JSON.stringify({
						sourceSavedAt: cacheSavedAt,
						tags: nextTags,
					}),
				)
			} catch {
				// Ignore storage write failures.
			}
		}

		locationTags = nextTags.slice(0, 3)
	})

	function extractDraftTerms(text = "") {
		const terms = []
		for (const match of String(text).matchAll(/#?[\p{L}\p{N}_-]+/gu)) {
			const token = (match[0] || "")
				.replace(/^#/, "")
				.trim()
				.toLowerCase()
			if (token) terms.push(token)
		}
		return terms
	}

	const tags = $derived(() => {
		const seen = new Set()
		const result = []
		const draftTerms = textareaEl
			? extractDraftTerms(
					typeof textareaEl?.value === "string" &&
						textareaEl.value.length
						? textareaEl.value
						: draft,
				)
			: []
		for (const tag of [
			...locationTags,
			...defaultHashtags,
			...myTags,
			...feedTags.map((t) => t.tag),
			...draftTerms,
		]) {
			if (tag && !seen.has(tag)) {
				seen.add(tag)
				result.push(tag)
			}
		}
		return result
	})

	function escape(tag) {
		return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	}

	function isActive(tag) {
		const sourceText =
			typeof textareaEl?.value === "string" && textareaEl.value.length
				? textareaEl.value
				: draft
		const token = Boolean(textareaEl)
			? `#${escape(tag)}`
			: `#?${escape(tag)}`
		return new RegExp(`(^|\\s)${token}(?![\\p{L}\\p{N}_-])`, "ui").test(
			sourceText,
		)
	}

	function toggle(tag) {
		const token = Boolean(textareaEl) ? `#${tag}` : tag
		const escapedToken = Boolean(textareaEl)
			? `#${escape(tag)}`
			: `#?${escape(tag)}`

		if (isActive(tag)) {
			// Remove all occurrences of this tag token.
			draft = draft
				.replace(
					new RegExp(
						`\\s*${escapedToken}(?![\\p{L}\\p{N}_-])`,
						"gui",
					),
					"",
				)
				.replace(/[ \t]{2,}/g, " ")
				.trim()
		} else {
			// Insert at cursor position, or append
			const pos = textareaEl
				? (textareaEl.selectionStart ?? draft.length)
				: draft.length
			const before = draft.slice(0, pos)
			const after = draft.slice(pos)
			const pre = before.length && !/[\s\n]$/.test(before) ? " " : ""
			const post = after.length && !/^[\s\n]/.test(after) ? " " : ""
			draft = `${before}${pre}${token}${post}${after}`
			const newPos = pos + pre.length + token.length
			setTimeout(() => {
				textareaEl?.focus()
				textareaEl?.setSelectionRange(newPos, newPos)
			}, 0)
		}

		onTagToggle(tag, draft)
	}
</script>

<div class="tag-cloud">
	Click to toggle the tags. Drag up to add to the text or drag outside and
	down to remove from recent tags.
	<div class="tag-cloud-inner" bind:this={cloudEl}>
		{#each tags() as tag (tag)}
			<button
				type="button"
				class="pill"
				class:removable={isRemovableTag(tag)}
				class:dragging={dragState?.tag === tag && dragState?.moved}
				class:drag-out={dragState?.tag === tag && dragState?.outside}
				class:active={isActive(tag)}
				style={dragState?.tag === tag && dragState?.moved
					? `transform: translate(${dragState.dx}px, ${dragState.dy}px);`
					: ""}
				onmousedown={(event) => event.preventDefault()}
				onpointerdown={(event) => onPillPointerDown(event, tag)}
				onclick={() => {
					if (suppressToggleTag === tag) {
						suppressToggleTag = ""
						return
					}
					toggle(tag)
				}}>{tag}</button
			>
		{/each}
	</div>
</div>

<style>
	.tag-cloud {
		display: block;
		max-height: 33dvh;
		overflow-y: auto;
	}

	.tag-cloud-inner {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.6rem;
	}
	.pill {
		font-size: 0.78rem;
		padding: 0.28rem 0.62rem;
		border-radius: 999px;
		border: 1px solid #c4b89e;
		background: linear-gradient(180deg, #fffdf9 0%, #f8f1e6 100%);
		color: #3b5e47;
		cursor: pointer;
		transition:
			background 0.12s,
			color 0.12s,
			border-color 0.12s,
			box-shadow 0.12s,
			transform 0.08s;
		line-height: 1.4;
	}
	.pill:hover {
		border-color: #3b6e4f;
		background: #e8f3eb;
		box-shadow: 0 1px 0 rgba(59, 110, 79, 0.2);
	}
	.pill:active {
		transform: translateY(1px);
	}
	.pill.active {
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
	}

	.pill.removable {
		position: relative;
	}

	.pill.dragging {
		z-index: 3;
		box-shadow: 0 7px 18px rgba(59, 110, 79, 0.24);
	}

	.pill.drag-out {
		opacity: 0.45;
		filter: saturate(0.6);
	}
</style>
