<script>
	let { images = [], alt = "Attached image" } = $props();

	const imageList = $derived(Array.isArray(images) ? images.slice(0, 4) : []);
	const count = $derived(imageList.length);
</script>

{#if count > 0}
	<div class="image-grid grid-{count}">
		{#each imageList as src, index}
			<div class="image-wrapper item-{index}">
				<img {src} alt="{alt} {index + 1}" loading="lazy" />
			</div>
		{/each}
	</div>
{/if}

<style>
	.image-grid {
		display: grid;
		width: 100%;
		gap: 6px;
		background: rgba(0, 0, 0, 0.03);
		border-radius: 10px;
		overflow: hidden;
		box-sizing: border-box;
	}

	.image-wrapper {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 100%;
		background: #fdfaf6;
	}

	.image-wrapper img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition: transform 0.3s ease;
	}

	/* 1 Image Layout */
	.grid-1 {
		grid-template-columns: 1fr;
		grid-template-rows: auto;
	}
	.grid-1 .image-wrapper {
		aspect-ratio: 16 / 9;
	}

	/* 2 Images Layout */
	.grid-2 {
		grid-template-columns: 1fr 1fr;
		aspect-ratio: 16 / 9;
	}

	/* 3 Images Layout */
	.grid-3 {
		grid-template-columns: 2fr 1fr;
		grid-template-rows: 1fr 1fr;
		aspect-ratio: 16 / 9;
	}
	.grid-3 .item-0 {
		grid-row: span 2;
	}

	/* 4 Images Layout */
	.grid-4 {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		aspect-ratio: 16 / 9;
	}
</style>
