<script>
	import {defaultHashtags} from "$lib/config"

	const LOCAL_TAG_KEY = "love4dogs.tag-counts"

	/** @type {{ draft: string, feedTags?: {tag:string}[], textareaEl?: HTMLTextAreaElement|null }} */
	let {draft = $bindable(""), feedTags = [], textareaEl = null} = $props()

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
		return new RegExp(
			`(^|\\s)#${escape(tag)}(?![\\p{L}\\p{N}_-])`,
			"ui",
		).test(draft)
	}

	function toggle(tag) {
		if (isActive(tag)) {
			// Remove all occurrences of #tag (not followed by more word chars)
			draft = draft
				.replace(
					new RegExp(
						`\\s*#${escape(tag)}(?![\\p{L}\\p{N}_-])`,
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
			draft = `${before}${pre}#${tag}${post}${after}`
			const newPos = pos + pre.length + 1 + tag.length
			setTimeout(() => {
				textareaEl?.focus()
				textareaEl?.setSelectionRange(newPos, newPos)
			}, 0)
		}
	}
</script>

<div class="tag-cloud">
	{#each tags() as tag (tag)}
		<button
			type="button"
			class="pill"
			class:active={isActive(tag)}
			onclick={() => toggle(tag)}>#{tag}</button
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
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		border: 1px solid #c4b89e;
		background: #faf6ee;
		color: #3b5e47;
		cursor: pointer;
		transition:
			background 0.12s,
			color 0.12s,
			border-color 0.12s;
		line-height: 1.4;
	}
	.pill:hover {
		border-color: #3b6e4f;
		background: #e8f3eb;
	}
	.pill.active {
		background: #3b6e4f;
		border-color: #305741;
		color: #fff;
	}
</style>
