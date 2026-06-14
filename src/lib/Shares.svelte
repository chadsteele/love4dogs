<script>
	import { onMount } from "svelte";
	import { Repeat2 } from "lucide-svelte";
	import { getSetting, setSetting, getPost, setPost, enqueueSync } from "$lib/db.js";
	import { getCurrentProfileUuid } from "$lib/profileRegistry.js";
	import { generateUuid } from "$lib/uuid.js";
	import { buildCompressedTimestamp } from "$lib/dateTime.js";
	import { startQueueProcessor } from "$lib/syncProcessor.js";

	let { count = 0, cardViewHref, title = "", imageUrl = "", context } = $props();

	let displayCount = $state(0);
	let showToast = $state(false);
	let showModal = $state(false);
	let shareComment = $state("");
	let copiedHtml = $state("");
	let errorMsg = $state("");
	let toastTimeout;

	// Background share counter task
	onMount(async () => {
		if (count > 0) {
			displayCount = count;
			return;
		}

		// Count shares from cache or background fetch
		const cacheKey = `share_count_${context}`;
		const cached = await getSetting(cacheKey);
		const thirtyMinutes = 30 * 60 * 1000;

		if (cached && Date.now() - cached.timestamp < thirtyMinutes) {
			displayCount = cached.count;
			return;
		}

		// If not cached or expired, run background task
		try {
			const res = await fetch(`/api/feed?query=${encodeURIComponent(context)}&chat=1`);
			if (res.ok) {
				const data = await res.json();
				const posts = data?.posts || [];
				let shareCount = 0;
				for (const p of posts) {
					if (p.imageAlts && p.imageAlts.length > 0) {
						try {
							const payload = JSON.parse(p.imageAlts[0]);
							if (payload && payload.share) {
								shareCount++;
							}
						} catch {}
					}
				}
				displayCount = shareCount;
				await setSetting(cacheKey, { count: shareCount, timestamp: Date.now() });
			}
		} catch (err) {
			console.error("Failed to fetch share count in background:", err);
			if (cached) {
				displayCount = cached.count;
			}
		}
	});

	function openShareModal(e) {
		e.stopPropagation();
		e.preventDefault();
		shareComment = "";
		errorMsg = "";
		showModal = true;
	}

	async function handleShare(e) {
		if (e) {
			e.stopPropagation();
			e.preventDefault();
		}

		const normalizedComment = shareComment.trim();

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

		showModal = false;

		const origin = typeof window !== "undefined" ? window.location.origin : "";
		const absoluteUrl = origin + cardViewHref;

		// 1. Construct styled rich HTML block
		const commentHtml = shareComment.trim() 
			? `<p style="margin: 0 0 12px 0; font-size: 14px; color: #5a5048; font-style: italic; font-weight: 500; border-left: 3px solid #3b6e4f; padding-left: 8px;">"${shareComment.trim()}"</p>`
			: "";

		const htmlContent = `<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 500px; border: 1px solid #ede5d8; border-radius: 12px; padding: 16px; background: #fffaf1; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">` +
			commentHtml +
			`<h3 style="margin: 0 0 10px 0; font-size: 18px;"><a href="${absoluteUrl}" style="text-decoration: none; color: #1a4a7a; font-weight: bold;">${title}</a></h3>` +
			(imageUrl ? `<img src="${imageUrl}" alt="${title}" style="width: 100%; max-width: 320px; border-radius: 8px; border: 1px solid #d9ccb9; object-fit: cover;" />` : "") +
			`</div>`;

		copiedHtml = htmlContent;

		// 2. Write rich HTML and plain text to clipboard
		try {
			if (navigator.clipboard && window.ClipboardItem) {
				const htmlBlob = new Blob([htmlContent], { type: "text/html" });
				const textBlob = new Blob([absoluteUrl], { type: "text/plain" });
				const clipboardItem = new ClipboardItem({
					"text/html": htmlBlob,
					"text/plain": textBlob
				});
				await navigator.clipboard.write([clipboardItem]);
			} else {
				await navigator.clipboard.writeText(absoluteUrl);
			}
		} catch (err) {
			console.warn("Failed rich copy, falling back to text copy:", err);
			try {
				await navigator.clipboard.writeText(absoluteUrl);
			} catch (fallbackErr) {
				console.error("Clipboard write failed completely:", fallbackErr);
			}
		}

		// 3. Show Toast notification
		showToast = true;
		if (toastTimeout) clearTimeout(toastTimeout);
		toastTimeout = setTimeout(() => {
			showToast = false;
		}, 6000);

		// 4. Publish share to Bluesky as a comment post
		try {
			const currentProfileUuid = await getCurrentProfileUuid();
			const chatUuid = generateUuid();
			const stamp = buildCompressedTimestamp(Date.now());

			const postText = `❤️ Shared: ${shareComment.trim() || title.trim()}`

			const syncItem = {
				uuid: chatUuid,
				context: context,
				prior: "",
				stamp: stamp,
				author: currentProfileUuid || null,
				text: postText,
				share: htmlContent,
				retryCount: 0,
				status: 'pending'
			};

			await enqueueSync(syncItem);

			// Increment display count and cache immediately
			displayCount++;
			const cacheKey = `share_count_${context}`;
			await setSetting(cacheKey, { count: displayCount, timestamp: Date.now() });

			// Optimistic Local DB cache write so it shows in local discussion
			try {
				const currentCacheKey = `bsky:feed:${context}:latest:20::`;
				const cachedData = await getPost(currentCacheKey) || {
					account: "love4dogs.club",
					posts: [],
					cursor: null,
					cursorHost: null,
					commonRecentTags: []
				};

				const profileName = currentProfileUuid ? "Self" : "Anonymous";
				const newMappedPost = {
					uri: `at://did:plc:local/app.bsky.feed.post/${chatUuid}`,
					displayKey: chatUuid,
					cid: "local-pending",
					text: postText,
					author: {
						did: currentProfileUuid || "",
						handle: profileName.toLowerCase(),
						displayName: profileName,
						avatar: ""
					},
					createdAt: new Date().toISOString(),
					images: [],
					imageAlts: [JSON.stringify({
						uuid: chatUuid,
						context: context,
						prior: "",
						stamp: stamp,
						author: currentProfileUuid || null,
						text: postText,
						share: htmlContent
					})],
					tags: ["chat", context],
					replyCount: 0,
					repostCount: 0,
					likeCount: 0,
					comments: []
				};

				cachedData.posts = [newMappedPost, ...(cachedData.posts || [])];
				await setPost(currentCacheKey, cachedData);
			} catch (cacheErr) {
				console.warn("Failed to update share comment in local cache:", cacheErr);
			}

			// Trigger sync processor
			startQueueProcessor().catch(err => console.error("Error running queue processor for share:", err));
		} catch (shareErr) {
			console.error("Failed to enqueue share post:", shareErr);
		}
	}
</script>

<button
	class="stat shares"
	onclick={openShareModal}
	type="button"
>
	<Repeat2 size={13} /> <sup>{displayCount||""}</sup> 
</button>

{#if showModal}
	<div class="modal-backdrop" onclick={() => showModal = false} role="presentation">
		<div class="modal-content" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-title">
			<h2 id="modal-title" class="modal-heading">Share</h2>
			
			<form onsubmit={handleShare}>
				<p class="modal-info">This will copy a rich preview link to your clipboard, so you can paste it to the social platform of your choice.<br/> And it will post a share notification in the discussion thread.</p>
				
				<div class="comment-textarea-group">
					<label for="share-comment" class="group-label">Add a comment (optional)</label>
					<textarea
						id="share-comment"
						class="share-textarea"
						bind:value={shareComment}
						placeholder="Why are you sharing?..."
						maxlength="150"
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
					<span class="char-count">{150 - shareComment.length} characters remaining</span>
				</div>

				{#if errorMsg}
					<p class="error-banner">{errorMsg}</p>
				{/if}
				
				<div class="modal-actions">
					<button type="button" class="btn-cancel" onclick={() => showModal = false}>Cancel</button>
					<button type="submit" class="btn-submit">
						Share & Copy
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if showToast}
	<div class="share-toast" role="alert">
		<div class="toast-header">
			<span class="toast-title">Copied to Clipboard!</span>
			<button class="toast-close" onclick={() => showToast = false} aria-label="Close">×</button>
		</div>
		<p class="toast-text">Rich share preview link has been copied. You can paste it on the platform of your choice.</p>
		<div class="toast-preview">
			{@html copiedHtml}
		</div>
	</div>
{/if}

<style>
	.shares {
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

	.shares:hover {
		color: #1a4a7a;
	}

	.shares sup {
		font-size: 0.65rem;
		align-self: flex-start;
		position: relative;
		top: -0.15em;
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
		animation: scaleUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
		color: #2c2520;
		box-sizing: border-box;
	}

	@keyframes scaleUp {
		from {
			transform: scale(0.95);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	.modal-heading {
		margin: 0 0 0.8rem 0;
		font-size: 1.25rem;
		font-weight: 700;
		color: #3b6e4f;
	}

	.modal-info {
		font-size: 0.82rem;
		line-height: 1.4;
		color: #6a6056;
		margin: 0 0 1.2rem 0;
	}

	.group-label {
		display: block;
		font-size: 0.84rem;
		font-weight: 600;
		color: #5a5048;
		margin-bottom: 0.4rem;
	}

	.comment-textarea-group {
		margin-bottom: 1.2rem;
	}

	.share-textarea {
		width: 100%;
		height: 70px;
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

	.share-textarea:focus {
		outline: none;
		border-color: #3b6e4f;
		background: #fff;
	}

	.char-count {
		display: block;
		text-align: right;
		font-size: 0.72rem;
		color: #8a7e72;
		margin-top: 0.25rem;
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

	.share-toast {
		position: fixed;
		bottom: 1.5rem;
		right: 1.5rem;
		z-index: 10000;
		max-width: 380px;
		background: rgba(255, 250, 241, 0.95);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid rgba(58, 91, 65, 0.22);
		border-radius: 12px;
		padding: 1rem;
		box-shadow: 0 12px 30px rgba(46, 28, 12, 0.18);
		animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		color: #2c2520;
	}

	.toast-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.toast-title {
		font-weight: 700;
		color: #3b6e4f;
		font-size: 0.9rem;
	}

	.toast-close {
		background: transparent;
		border: none;
		color: #9a9388;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}

	.toast-close:hover {
		color: #2c2520;
	}

	.toast-text {
		margin: 0 0 0.65rem 0;
		font-size: 0.82rem;
		line-height: 1.4;
		color: #5a5048;
	}

	.toast-preview {
		background: #faf7f2;
	}

	.error-banner {
		color: #8e2f21;
		font-size: 0.84rem;
		font-weight: 600;
		margin-bottom: 1rem;
	}
</style>
