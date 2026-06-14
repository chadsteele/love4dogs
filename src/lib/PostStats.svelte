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

	let currentLikeCount = $state(likeCount);
	let currentRepostCount = $state(repostCount);
	let currentReplyCount = $state(replyCount);

	$effect(() => {
		currentLikeCount = likeCount;
		currentRepostCount = repostCount;
		currentReplyCount = replyCount;
	});

	$effect(() => {
		if (!context) return;

		async function fetchStatsAndRecalculate() {
			// 1. Search bsky for the most recent post with the current {context} (uuid)
			try {
				const res = await fetch(`/api/feed?query=${encodeURIComponent(context)}&limit=1`);
				if (res.ok) {
					const data = await res.json();
					const posts = data?.posts || [];
					if (posts.length > 0) {
						const originPost = posts[0];
						currentLikeCount = originPost.likeCount ?? 0;
						currentRepostCount = originPost.repostCount ?? 0;
						currentReplyCount = originPost.replyCount ?? 0;
					}
				}
			} catch (err) {
				console.warn("Failed to fetch recent post stats from search:", err);
			}

			// 2. Query for comments and recalculate those values in the background
			try {
				const chatRes = await fetch(`/api/feed?query=${encodeURIComponent(context)}&chat=1`);
				if (chatRes.ok) {
					const chatData = await chatRes.json();
					const comments = chatData?.posts || [];

					let totalStars = 0;
					let totalShares = 0;
					let totalReplies = 0;
					let ratingCommentsCount = 0;

					for (const comment of comments) {
						let commentContext = null;
						if (comment.imageAlts && comment.imageAlts.length > 0) {
							try {
								const payload = JSON.parse(comment.imageAlts[0]);
								if (payload && payload.context) {
									commentContext = payload.context;
								}
							} catch {}
						}

						if (commentContext !== context) {
							continue;
						}

						totalReplies += 1;

						const text = String(comment.text || "").trim();

						// likeCount calculation:
						// limit to 5 ⭐️s per comment, and -1 for a ☹️
						const isFrown = text.startsWith("☹️");
						const isStar = text.startsWith("⭐️") || text.startsWith("⭐");

						if (isFrown || isStar) {
							ratingCommentsCount += 1;

							if (isStar) {
								// Count how many star characters are at the beginning of the text
								let starCount = 0;
								let i = 0;
								while (i < text.length) {
									if (text.substring(i).startsWith("⭐️")) {
										starCount++;
										i += 2;
									} else if (text.substring(i).startsWith("⭐")) {
										starCount++;
										i += 1;
									} else {
										break;
									}
								}
								totalStars += Math.min(starCount, 5);
							} else if (isFrown) {
								totalStars -= 1;
							}
						}

						// repostCount calculation:
						// total number of comments that start with "❤️ Shared:"
						if (text.startsWith("❤️ Shared:")) {
							totalShares += 1;
						}
					}

					// likeCount is the average star count (total stars / comments with stars)
					const recalculatedLike = ratingCommentsCount > 0
						? Math.max(0, totalStars / ratingCommentsCount)
						: 0;
					
					// Format to 1 decimal place if it has a fractional part, otherwise keep as number
					const formattedLike = Number(recalculatedLike.toFixed(1));

					currentLikeCount = formattedLike;
					currentRepostCount = totalShares;
					currentReplyCount = totalReplies;
				}
			} catch (err) {
				console.warn("Failed to recalculate stats from comments:", err);
			}
		}

		fetchStatsAndRecalculate();
	});
</script>

<div class="post-stats" onclick={(e) => e.stopPropagation()} role="presentation">
	<Stars count={currentLikeCount} {context} {cardViewHref} {authorId} />
	<Shares count={currentRepostCount} {cardViewHref} {title} {imageUrl} {context} />
	<Comments count={currentReplyCount} {cardViewHref} />
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
