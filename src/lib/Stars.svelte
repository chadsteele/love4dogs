<script>
	import { Star } from "lucide-svelte";
	import { getSetting, getPost, setPost, enqueueSync, getSyncQueue, deleteSyncItem } from "$lib/db.js";
	import { getCurrentProfileUuid, listStoredProfiles } from "$lib/profileRegistry.js";
	import { generateUuid } from "$lib/uuid.js";
	import { buildCompressedTimestamp } from "$lib/dateTime.js";
	import { startQueueProcessor, getProfileDetails } from "$lib/syncProcessor.js";
	import { onMount } from "svelte";

	let { count = 0, context, cardViewHref, authorId } = $props();

	let showModal = $state(false);
	let selectedRating = $state(5);
	let commentText = $state("");
	let isAnonymous = $state(false);
	let isSubmitting = $state(false);
	let errorMsg = $state("");

	let currentProfileUuid = $state("");
	let ownedProfileUuids = $state([]);
	let showWarningToast = $state(false);
	let warningToastTimeout;

	const isOwnPost = $derived(
		Boolean(authorId && (ownedProfileUuids.includes(authorId) || currentProfileUuid === authorId))
	);

	onMount(async () => {
		currentProfileUuid = await getCurrentProfileUuid();
		try {
			const profiles = await listStoredProfiles();
			ownedProfileUuids = profiles.map(p => p.uuid);
		} catch (err) {
			console.warn("Failed to load local profiles:", err);
		}
	});

	async function handleOpenModal(e) {
		e.stopPropagation();
		e.preventDefault();

		// Check if user is rating their own post/profile
		if (isOwnPost) {
			showWarningToast = true;
			if (warningToastTimeout) clearTimeout(warningToastTimeout);
			warningToastTimeout = setTimeout(() => {
				showWarningToast = false;
			}, 3000);
			return;
		}

		// Reset state
		selectedRating = 5;
		commentText = "";
		isAnonymous = false;
		errorMsg = "";
		showModal = true;
	}

	function handleCloseModal(e) {
		if (e) {
			e.stopPropagation();
			e.preventDefault();
		}
		showModal = false;
	}

	async function handleSubmit(e) {
		e.stopPropagation();
		e.preventDefault();

		const normalizedComment = commentText.trim();

		// HTML validation
		const htmlRegex = /<\/?[a-z][a-z0-9]*\b[^>]*>/i;
		if (htmlRegex.test(normalizedComment)) {
			errorMsg = "HTML tags are not allowed in comments.";
			return;
		}

		// URL validation (allow only love4dogs.club domain URLs)
		const urlRegex = /(?:https?:\/\/|www\.)\S+|[a-zA-Z0-9-]+\.(?:com|org|net|edu|gov|io|co|me|tv|info|biz|club|app|dev|xyz|dog|cat|us|uk|ca|de|fr|jp|au|cn|in)\b/gi;
		let hasExternalUrl = false;
		let match;
		urlRegex.lastIndex = 0;
		while ((match = urlRegex.exec(normalizedComment)) !== null) {
			let urlStr = match[0];
			let testUrl = urlStr;
			if (!/^https?:\/\//i.test(testUrl)) {
				testUrl = 'http://' + testUrl;
			}
			try {
				const parsed = new URL(testUrl);
				const hostname = parsed.hostname.toLowerCase();
				if (hostname !== 'love4dogs.club' && !hostname.endsWith('.love4dogs.club')) {
					hasExternalUrl = true;
					break;
				}
			} catch {
				const domainRegex = /(?:^|[\/\.@])love4dogs\.club\b/i;
				if (!domainRegex.test(urlStr)) {
					hasExternalUrl = true;
					break;
				}
			}
		}
		if (hasExternalUrl) {
			errorMsg = "External links or URLs are not allowed in comments.";
			return;
		}

		isSubmitting = true;
		errorMsg = "";

		try {
			const chatUuid = generateUuid();
			const stamp = buildCompressedTimestamp(Date.now());
			const currentProfileUuid = await getCurrentProfileUuid();

			// Construct review comment text
			const commentPrefix = selectedRating === 0 ? "☹️" : '⭐️'.repeat(selectedRating);
			const finalCommentText = commentText.trim() 
				? `${commentPrefix} ${commentText.trim()}` 
				: commentPrefix;

			let oldPostUri = "";
			let oldPostDisplayKey = "";

			// 1. Check local IndexedDB cache first for an old rating
			try {
				const currentCacheKey = `bsky:feed:${context}:latest:20::`;
				const cachedData = await getPost(currentCacheKey);
				if (cachedData && Array.isArray(cachedData.posts)) {
					for (const post of cachedData.posts) {
						let payload = null;
						if (post.imageAlts && post.imageAlts.length > 0) {
							try {
								payload = JSON.parse(post.imageAlts[0]);
							} catch {}
						}
						const postAuthor = payload?.author || post.author?.did;
						const text = payload?.text || post.text || "";
						const isRatingText = text.startsWith("☹️") || text.startsWith("⭐️");

						if (postAuthor === currentProfileUuid && isRatingText) {
							oldPostUri = post.uri;
							oldPostDisplayKey = payload?.uuid || post.displayKey;
							break;
						}
					}
				}
			} catch (err) {
				console.warn("Failed to check cache for old rating:", err);
			}

			// 2. Check network feed if we didn't find it or just to verify
			try {
				const res = await fetch(`/api/feed?query=${encodeURIComponent(context)}&chat=1`);
				if (res.ok) {
					const data = await res.json();
					const posts = data?.posts || [];
					for (const post of posts) {
						let payload = null;
						if (post.imageAlts && post.imageAlts.length > 0) {
							try {
								payload = JSON.parse(post.imageAlts[0]);
							} catch {}
						}
						const postAuthor = payload?.author || post.author?.did;
						const text = payload?.text || post.text || "";
						const isRatingText = text.startsWith("☹️") || text.startsWith("⭐️");

						if (postAuthor === currentProfileUuid && isRatingText) {
							oldPostUri = post.uri;
							oldPostDisplayKey = payload?.uuid || post.displayKey;
							break;
						}
					}
				}
			} catch (err) {
				console.warn("Failed to check network for old rating:", err);
			}

			// 3. Delete old rating item from IndexedDB sync queue if any
			try {
				const queue = await getSyncQueue();
				for (const item of queue) {
					if (
						item.context === context &&
						item.author === currentProfileUuid &&
						(item.text.startsWith("☹️") || item.text.startsWith("⭐️"))
					) {
						await deleteSyncItem(item.id);
					}
				}
			} catch (queueErr) {
				console.warn("Failed to clean up sync queue for older ratings:", queueErr);
			}

			// 4. Trigger remote delete on Bluesky if we have a real URI
			if (oldPostUri && !oldPostUri.includes("local/")) {
				const deleteFd = new FormData();
				deleteFd.append("mode", "delete-post-uri");
				deleteFd.append("uri", oldPostUri);
				fetch("/api/post", {
					method: "POST",
					body: deleteFd
				}).catch(err => console.warn("Failed to delete older rating on Bluesky:", err));
			}

			const syncItem = {
				uuid: chatUuid,
				context: context,
				prior: "",
				stamp: stamp,
				author: isAnonymous ? null : currentProfileUuid,
				text: finalCommentText,
				retryCount: 0,
				status: 'pending'
			};

			// Enqueue sync queue
			await enqueueSync(syncItem);

			// Resolve author details for optimistic write
			let authorName = "Anonymous";
			let authorAvatar = "";
			if (!isAnonymous && currentProfileUuid) {
				const profileDetails = await getProfileDetails(currentProfileUuid);
				authorName = profileDetails.name || "Anonymous";
				authorAvatar = profileDetails.profilePic || "";
			}

			// Optimistic UI update in the post comments feed cache
			try {
				const currentCacheKey = `bsky:feed:${context}:latest:20::`;
				const cachedData = await getPost(currentCacheKey) || {
					account: "love4dogs.club",
					posts: [],
					cursor: null,
					cursorHost: null,
					commonRecentTags: []
				};

				const altPayload = {
					uuid: chatUuid,
					context: context,
					prior: "",
					stamp: stamp,
					author: isAnonymous ? null : currentProfileUuid,
					text: finalCommentText
				};

				const newMappedPost = {
					uri: `at://did:plc:local/app.bsky.feed.post/${chatUuid}`,
					displayKey: chatUuid,
					cid: "local-pending",
					text: finalCommentText,
					author: {
						did: isAnonymous ? "" : currentProfileUuid || "",
						handle: isAnonymous ? "anonymous" : authorName.toLowerCase(),
						displayName: isAnonymous ? "Anonymous" : authorName,
						avatar: isAnonymous ? "" : authorAvatar
					},
					createdAt: new Date().toISOString(),
					images: [],
					imageAlts: [JSON.stringify(altPayload)],
					tags: ["chat", context],
					replyCount: 0,
					repostCount: 0,
					likeCount: 0,
					comments: []
				};

				// Filter out the old post if present in cache!
				if (oldPostDisplayKey || oldPostUri) {
					cachedData.posts = (cachedData.posts || []).filter(p => 
						p.displayKey !== oldPostDisplayKey && p.uri !== oldPostUri
					);
				}

				cachedData.posts = [newMappedPost, ...(cachedData.posts || [])];
				await setPost(currentCacheKey, cachedData);
			} catch (cacheErr) {
				console.warn("Failed to write optimistic star comment to cache:", cacheErr);
			}

			// Close modal
			showModal = false;

			// Trigger sync queue processing
			startQueueProcessor().catch(err => console.error("Error running queue processor for stars rating:", err));
		} catch (err) {
			console.error("Failed to submit star rating:", err);
			errorMsg = err.message || "An unexpected error occurred.";
		} finally {
			isSubmitting = false;
		}
	}
</script>

<button
	class="stat stars"
	class:disabled={isOwnPost}
	onclick={handleOpenModal}
	type="button"
	title={isOwnPost ? "Authors cannot rate their own posts" : "Add star rating"}
>
	<Star size={13} /> <sup>{count||""}</sup> 
</button>

{#if showModal}
	<div
		class="modal-backdrop"
		onclick={handleCloseModal}
		onkeydown={(e) => {
			if (e.key === "Escape") handleCloseModal();
		}}
		role="button"
		tabindex="-1"
		aria-label="Close modal"
	>
		<div
			class="modal-content"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
			tabindex="-1"
		>
			<h2 id="modal-title" class="modal-heading">Add Star Rating</h2>

			<form onsubmit={handleSubmit}>
				<div class="rating-selector-group">
					<span class="group-label">Your Rating</span>
					<div class="stars-row">
						<button 
							type="button" 
							class="frown-btn" 
							class:active={selectedRating === 0} 
							onclick={() => selectedRating = 0}
							aria-label="0 stars (frown)"
						>
							☹️
						</button>
						<div class="star-icons">
							{#each [1, 2, 3, 4, 5] as star}
								<button 
									type="button" 
									class="star-icon-btn" 
									onclick={() => selectedRating = star}
									aria-label="{star} stars"
								>
									<Star 
										size={22} 
										fill={star <= selectedRating ? "#e09f19" : "none"} 
										color={star <= selectedRating ? "#e09f19" : "#a8a196"} 
									/>
								</button>
							{/each}
						</div>
					</div>
				</div>

				<div class="comment-textarea-group">
					<label for="rating-comment" class="group-label">Comment (optional)</label>
					<textarea
						id="rating-comment"
						class="rating-textarea"
						bind:value={commentText}
						placeholder="Add a review comment..."
						maxlength="200"
						onpaste={(e) => {
							e.preventDefault();
							errorMsg = "Pasting is disabled. Please type your comment.";
						}}
						oninput={() => {
							if (errorMsg === "Pasting is disabled. Please type your comment.") {
								errorMsg = "";
							}
						}}
					></textarea>
				</div>

				<div class="anonymity-checkbox-group">
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={isAnonymous} />
						Post anonymously
					</label>
				</div>

				{#if errorMsg}
					<p class="error-banner">{errorMsg}</p>
				{/if}

				<div class="modal-actions">
					<button type="button" class="btn-cancel" onclick={handleCloseModal} disabled={isSubmitting}>Cancel</button>
					<button type="submit" class="btn-submit" disabled={isSubmitting}>
						{isSubmitting ? "Submitting..." : "Submit Rating"}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if showWarningToast}
	<div class="stars-toast" role="alert">
		<div class="toast-header">
			<span class="toast-title warning">Action Blocked</span>
			<button class="toast-close" onclick={() => showWarningToast = false} aria-label="Close">×</button>
		</div>
		<p class="toast-text">Authors cannot rate their own posts.</p>
	</div>
{/if}

<style>
	.stars {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: #6b7280;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		transition: color 0.15s ease;
	}

	.stars:hover:not(.disabled) {
		color: #1a4a7a;
	}

	.stars sup {
		font-size: 0.65rem;
		align-self: flex-start;
		position: relative;
		top: -0.15em;
	}

	.stars.disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(46, 38, 32, 0.4);
		backdrop-filter: blur(5px);
		-webkit-backdrop-filter: blur(5px);
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.modal-content {
		background: #fffaf1;
		border: 1px solid rgba(58, 91, 65, 0.25);
		border-radius: 16px;
		width: 100%;
		max-width: 420px;
		padding: 1.5rem;
		box-shadow: 0 20px 50px rgba(46, 28, 12, 0.25);
		color: #2c2520;
		box-sizing: border-box;
	}

	.modal-heading {
		margin: 0 0 1.25rem 0;
		font-size: 1.25rem;
		font-weight: 700;
		color: #3b6e4f;
	}

	.group-label {
		display: block;
		font-size: 0.84rem;
		font-weight: 600;
		color: #5a5048;
		margin-bottom: 0.4rem;
	}

	.rating-selector-group {
		margin-bottom: 1.2rem;
	}

	.stars-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: #fdfaf5;
		border: 1px solid #ede6db;
		border-radius: 10px;
	}

	.frown-btn {
		font-size: 1.4rem;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0;
		opacity: 0.4;
		filter: grayscale(100%);
		transition: all 0.15s ease;
	}

	.frown-btn.active, .frown-btn:hover {
		opacity: 1;
		filter: none;
	}

	.star-icons {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		border-left: 1px solid #ede6db;
		padding-left: 0.75rem;
	}

	.star-icon-btn {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.1s ease;
	}

	.star-icon-btn:active {
		transform: scale(0.9);
	}

	.comment-textarea-group {
		margin-bottom: 1.2rem;
	}

	.rating-textarea {
		width: 100%;
		height: 90px;
		padding: 0.6rem;
		border: 1px solid #d8d3ca;
		background: #fcfcfc;
		border-radius: 8px;
		font-size: 0.88rem;
		color: #2c2520;
		font-family: inherit;
		resize: none;
		box-sizing: border-box;
	}

	.rating-textarea:focus {
		outline: none;
		border-color: #3b6e4f;
		background: #fff;
	}

	.anonymity-checkbox-group {
		margin-bottom: 1.5rem;
	}

	.checkbox-label {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.86rem;
		color: #5a5048;
		cursor: pointer;
		font-weight: 500;
	}

	.checkbox-label input {
		width: 16px;
		height: 16px;
		cursor: pointer;
		accent-color: #3b6e4f;
	}

	.error-banner {
		color: #8e2f21;
		font-size: 0.84rem;
		font-weight: 600;
		margin-bottom: 1rem;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}

	.btn-cancel {
		padding: 0.55rem 1rem;
		border: 1px solid #d8d3ca;
		background: #f5f2ed;
		color: #5a5048;
		border-radius: 8px;
		font-size: 0.86rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-cancel:hover {
		background: #e9e5de;
		color: #2c2520;
	}

	.btn-submit {
		padding: 0.55rem 1.1rem;
		border: none;
		background: #3b6e4f;
		color: #fff;
		border-radius: 8px;
		font-size: 0.86rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-submit:hover {
		background: #2b533a;
	}

	.btn-cancel:disabled, .btn-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.stars-toast {
		position: fixed;
		bottom: 1.5rem;
		right: 1.5rem;
		z-index: 10000;
		max-width: 380px;
		background: rgba(255, 250, 241, 0.95);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid rgba(142, 47, 33, 0.22);
		border-radius: 12px;
		padding: 1rem;
		box-shadow: 0 12px 30px rgba(46, 28, 12, 0.18);
		animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		color: #2c2520;
	}

	@keyframes slideUp {
		from {
			transform: translateY(10px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.toast-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.toast-title.warning {
		font-weight: 700;
		color: #8e2f21;
		font-size: 0.9rem;
	}

	.toast-close {
		background: transparent;
		border: none;
		color: #9a9388;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}

	.toast-close:hover {
		color: #8e2f21;
	}

	.toast-text {
		margin: 0;
		font-size: 0.86rem;
		color: #5a5048;
		line-height: 1.4;
	}
</style>
