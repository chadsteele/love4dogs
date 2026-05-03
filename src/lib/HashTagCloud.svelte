<script>
	import {defaultHashtags} from "$lib/config"

	const LOCAL_TAG_KEY = "love4dogs.tag-counts"

	/** @type {{ draft: string, feedTags?: {tag:string}[], textareaEl?: HTMLTextAreaElement|null }} */
	let {
		draft = $bindable(""),
		feedTags = [],
		textareaEl = null,
		onTagToggle = () => {},
	} = $props()

	let myTags = $state([])

	$effect(() => {
		if (typeof window === "undefined") return
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
	})

	const tags = $derived(() => {
		const seen = new Set()
		const result = []
		for (const tag of [
			...defaultHashtags,
			...myTags,
			...feedTags.map((t) => t.tag),
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
		const token = Boolean(textareaEl)
			? `#${escape(tag)}`
			: `#?${escape(tag)}`
		return new RegExp(`(^|\\s)${token}(?![\\p{L}\\p{N}_-])`, "ui").test(
			draft,
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
	{#each tags() as tag (tag)}
		<button
			type="button"
			class="pill"
			class:active={isActive(tag)}
			onmousedown={(event) => event.preventDefault()}
			onclick={() => toggle(tag)}>{tag}</button
		>
	{/each}
</div>

<style>
	.tag-cloud {
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
</style>
