<script>
	let {tags = [], onTagClick = () => {}} = $props()

	function normalizeTagToken(value = "") {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/^#/, "")
			.replace(/\s+/g, " ")
	}

	const displayTags = $derived.by(() => {
		const raw = Array.isArray(tags) ? tags : []
		const seen = new Set()
		const result = []
		for (const entry of raw) {
			const token = normalizeTagToken(entry)
			if (!token || seen.has(token)) continue
			seen.add(token)
			result.push(token)
			if (result.length >= 20) break
		}
		return result
	})

	function handleTagClick(tag) {
		onTagClick(tag)
	}
</script>

{#if displayTags.length > 0}
	<div class="tag-pills" aria-label="Tag filters">
		{#each displayTags as tag}
			<button
				type="button"
				class="tag-pill"
				onclick={() => handleTagClick(tag)}
			>
				#{tag}
			</button>
		{/each}
	</div>
{/if}

<style>
	.tag-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		padding: 0.75rem 1rem;
		background: #faf7f3;
		border-bottom: 1px solid #ede5d8;
	}

	.tag-pill {
		border: 1px solid rgba(59, 110, 79, 0.3);
		background: rgba(59, 110, 79, 0.1);
		color: #305741;
		border-radius: 999px;
		padding: 0.22rem 0.65rem;
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.2;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}

	.tag-pill:hover,
	.tag-pill:focus-visible {
		border-color: #305741;
		background: rgba(59, 110, 79, 0.18);
		outline: none;
	}
</style>
