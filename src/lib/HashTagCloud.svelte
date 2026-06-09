<script>
	import {defaultHashtags} from "$lib/config"
	import {tagCountsStore} from "$lib/tagCountsStore.svelte"

	/** @type {{ activeTags: string[] | Set<string>, onToggle: (tag: string) => void }} */
	let {
		activeTags = [],
		onToggle = () => {},
	} = $props()

	function handleToggle(tag) {
		const willBeActive = !isActive(tag)
		if (willBeActive) {
			tagCountsStore.increment(tag)
		}
		onToggle(tag)
	}

	function isActive(tag) {
		const normalizedTag = tag.toLowerCase()
		if (activeTags instanceof Set) {
			return activeTags.has(normalizedTag)
		}
		if (Array.isArray(activeTags)) {
			return activeTags.some(t => String(t || "").toLowerCase() === normalizedTag)
		}
		return false
	}

	const sortedHashtags = $derived.by(() => {
		const list = [...defaultHashtags]
		list.sort((a, b) => {
			const countA = Number(tagCountsStore.counts[a.toLowerCase()] || 0)
			const countB = Number(tagCountsStore.counts[b.toLowerCase()] || 0)
			if (countB !== countA) {
				return countB - countA
			}
			return defaultHashtags.indexOf(a) - defaultHashtags.indexOf(b)
		})
		return list
	})
</script>

<div class="tag-cloud">
	<div class="tag-cloud-inner">
		{#each sortedHashtags as tag}
			<button
				type="button"
				class="pill"
				class:active={isActive(tag)}
				onclick={() => handleToggle(tag)}
			>
				{tag}
			</button>
		{/each}
	</div>
</div>

<style>
	.tag-cloud {
		display: block;
		width: 100%;
		padding-bottom: 0.35rem;
	}

	.tag-cloud-inner {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		padding: 0.1rem 0.2rem;
	}

	.pill {
		font-size: 0.78rem;
		padding: 0.28rem 0.62rem;
		border-radius: 999px;
		border: 1px solid #c4b89e;
		background: linear-gradient(180deg, #fffdf9 0%, #f8f1e6 100%);
		color: #3b5e47;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
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
