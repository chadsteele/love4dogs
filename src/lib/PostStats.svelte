<script>
	import Stars from "$lib/Stars.svelte";
	import Shares from "$lib/Shares.svelte";
	import Comments from "$lib/Comments.svelte";
	import DateTime from "$lib/DateTime.svelte";

	let {
		likeCount = 0,
		repostCount = 0,
		replyCount = 0,
		createdAt = "",
		context = "",
		cardViewHref = "",
		title = "",
		imageUrl = "",
		authorId = ""
	} = $props();
</script>

<div class="post-stats" onclick={(e) => e.stopPropagation()} role="presentation">
	<Stars count={likeCount} {context} {cardViewHref} {authorId} />
	<Shares count={repostCount} {cardViewHref} {title} {imageUrl} {context} />
	<Comments count={replyCount} {cardViewHref} />
	{#if createdAt}
		<span class="stat-date"><DateTime tag="span" value={createdAt} /></span>
	{/if}
</div>

<style>
	.post-stats {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		flex-wrap: wrap;
		padding: 0.4rem 0;
	}

	.stat-date {
		font-size: 0.78rem;
		color: #9ca3af;
		margin-left: auto;
	}

	.post-stats:hover :global(.stat) {
		color: #1a4a7a;
	}
</style>
