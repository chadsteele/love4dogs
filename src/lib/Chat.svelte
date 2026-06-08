<script>
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { generateUuid } from "$lib/uuid.js";
	import { getProfile, setPost } from "$lib/db.js";
	import { listStoredProfiles, getCurrentProfileUuid } from "$lib/profileRegistry.js";
	import { buildCompressedTimestamp, parseTimestampMs, formatRelativeDateTime } from "$lib/dateTime.js";
	import { MessageSquare, Image, X, Reply, RefreshCw, Send, AlertTriangle, CornerDownRight, ArrowUpRight } from "lucide-svelte";
	import { goto } from "$app/navigation";

	// Props
	let { context } = $props();

	// State Variables
	let comments = $state([]);
	let loading = $state(true);
	let posting = $state(false);
	let fetchingPriors = $state(false);
	let error = $state("");
	let postError = $state("");

	// Profiles & Auth state
	let localProfiles = $state([]);
	let currentProfileUuid = $state("");
	let currentProfile = $state(null);
	let authorProfiles = $state({}); // cache of uuid -> {name, profilePic}

	// Form input state
	let commentText = $state("");
	let attachedImage = $state(null); // File object
	let attachedImagePreview = $state(""); // object URL preview
	let replyingToComment = $state(null); // Comment object

	const charLimit = 300;
	const charsRemaining = $derived(charLimit - commentText.length);

	// Derived values for comments tree & missing priors
	const flatComments = $derived(comments);
	
	// Helper to resolve profile details for a given author UUID
	const profileCache = new Map();
	async function getProfileDetails(authorUuid) {
		const key = String(authorUuid || "").trim();
		if (!key) return { name: "Anonymous", profilePic: "" };
		if (profileCache.has(key)) return profileCache.get(key);

		// 1. Check local profiles registry
		const registryMatch = localProfiles.find(p => p.uuid === key);
		if (registryMatch) {
			const profile = {
				name: registryMatch.name || "Anonymous",
				profilePic: registryMatch.avatarUrl || ""
			};
			profileCache.set(key, profile);
			return profile;
		}

		// 2. Check full profile from local store
		const local = await getProfile(key);
		if (local) {
			const name = local.profileName || local.name || "Anonymous";
			const firstImage = Array.isArray(local.profileUploadedMedia) ? local.profileUploadedMedia[0] : null;
			const profilePic = local.profilePic || firstImage?.bskyUrl || firstImage?.url || "";
			const profile = { name, profilePic };
			profileCache.set(key, profile);
			return profile;
		}

		// 3. Fallback to API fetch
		try {
			const res = await fetch(`/api/profile-bundle?uuid=${encodeURIComponent(key)}`);
			if (res.ok) {
				const bundle = await res.json();
				const primary = bundle?.combined?.primary || {};
				const profile = {
					name: primary.name || "Anonymous",
					profilePic: primary.profilePic || ""
				};
				profileCache.set(key, profile);
				return profile;
			}
		} catch (e) {
			console.error("Failed to load author profile details", key, e);
		}

		return { name: "Anonymous", profilePic: "" };
	}

	async function loadAuthorProfiles(uuids) {
		const uniqueUuids = [...new Set(uuids.filter(Boolean))];
		const promises = uniqueUuids.map(async (uuid) => {
			if (authorProfiles[uuid]) return;
			const details = await getProfileDetails(uuid);
			authorProfiles = {
				...authorProfiles,
				[uuid]: details
			};
		});
		await Promise.all(promises);
	}

	// Dynamic calculation of missing priors
	const missingPriors = $derived.by(() => {
		const presentUuids = new Set(comments.map(c => c.uuid));
		return comments
			.map(c => c.prior)
			.filter(prior => prior && !presentUuids.has(prior));
	});

	const uniqueMissingPriors = $derived([...new Set(missingPriors)]);

	// Construct the comment tree from the flat sorted list
	const commentTree = $derived.by(() => {
		const commentMap = new Map();
		const roots = [];

		const sorted = [...comments].sort((a, b) => {
			const timeA = parseTimestampMs(a.stamp, { allowBase36: true }) || 0;
			const timeB = parseTimestampMs(b.stamp, { allowBase36: true }) || 0;
			return timeA - timeB;
		});

		for (const c of sorted) {
			c.replies = [];
			commentMap.set(c.uuid, c);
		}

		for (const c of sorted) {
			if (c.prior && commentMap.has(c.prior)) {
				commentMap.get(c.prior).replies.push(c);
			} else {
				roots.push(c);
			}
		}

		return roots;
	});

	// Initial loading & profile checks
	onMount(async () => {
		await loadSessionProfile();
		await fetchComments();
	});

	async function loadSessionProfile() {
		try {
			localProfiles = await listStoredProfiles();
			currentProfileUuid = await getCurrentProfileUuid();
			if (currentProfileUuid) {
				currentProfile = await getProfileDetails(currentProfileUuid);
			}
		} catch (e) {
			console.error("Failed to check active profile status", e);
		}
	}

	async function fetchComments() {
		loading = true;
		error = "";
		try {
			// Fetch 20 most recent comments, refresh cache
			const res = await fetch(`/api/feed?query=${encodeURIComponent(context)}&limit=20&refresh=1`);
			if (!res.ok) throw new Error("Failed to load comments feed");
			const data = await res.json();
			const posts = data?.posts || [];

			const fetched = [];
			for (const post of posts) {
				if (post.imageAlts && post.imageAlts.length > 0) {
					try {
						const payload = JSON.parse(post.imageAlts[0]);
						if (payload && payload.uuid && payload.context === context && payload.author) {
							fetched.push(payload);
						}
					} catch {}
				}
			}

			comments = fetched;
			// Load profiles for these comment authors
			const authorUuids = comments.map(c => c.author);
			await loadAuthorProfiles(authorUuids);
		} catch (err) {
			error = err.message || "Unable to load comments.";
		} finally {
			loading = false;
		}
	}

	async function fetchCommentByUuid(uuid) {
		try {
			const res = await fetch(`/api/feed?query=${encodeURIComponent(uuid)}`);
			if (res.ok) {
				const data = await res.json();
				const posts = data?.posts || [];
				for (const post of posts) {
					if (post.imageAlts && post.imageAlts.length > 0) {
						try {
							const payload = JSON.parse(post.imageAlts[0]);
							if (payload && payload.uuid === uuid) {
								return payload;
							}
						} catch {}
					}
				}
			}
		} catch (err) {
			console.error("Failed to fetch comment by UUID", uuid, err);
		}
		return null;
	}

	async function handleFetchPriors() {
		if (fetchingPriors || uniqueMissingPriors.length === 0) return;
		fetchingPriors = true;
		try {
			const fetchedPriors = await Promise.all(
				uniqueMissingPriors.map(uuid => fetchCommentByUuid(uuid))
			);
			const validPriors = fetchedPriors.filter(Boolean);
			if (validPriors.length > 0) {
				comments = [...comments, ...validPriors];
				await loadAuthorProfiles(validPriors.map(p => p.author));
			}
		} catch (err) {
			console.error("Error fetching priors", err);
		} finally {
			fetchingPriors = false;
		}
	}

	// Handle Image attachment
	function handleFileChange(event) {
		const file = event.target.files?.[0];
		if (!file) return;

		if (!file.type.startsWith("image/")) {
			postError = "Please select an image file.";
			return;
		}
		if (file.size > 2 * 1024 * 1024) {
			postError = "Image must be 2 MB or smaller.";
			return;
		}

		attachedImage = file;
		if (attachedImagePreview) URL.revokeObjectURL(attachedImagePreview);
		attachedImagePreview = URL.createObjectURL(file);
		postError = "";
	}

	function removeAttachment() {
		attachedImage = null;
		if (attachedImagePreview) {
			URL.revokeObjectURL(attachedImagePreview);
			attachedImagePreview = "";
		}
	}

	// Resolve the carrier blob reference (without re-uploading if Bsky CDN)
	async function resolveCarrierBlob(url) {
		const targetUrl = String(url || "").trim() || (window.location.origin + "/dog-logo.jpg");
		const isCdn = /cdn\.bsky\.app/i.test(targetUrl);
		const fd = new FormData();
		if (isCdn) {
			fd.append("mode", "resolve-cdn-blob");
			fd.append("sourceUrl", targetUrl);
		} else {
			fd.append("mode", "cache-media-url");
			fd.append("sourceUrl", targetUrl);
		}
		const res = await fetch("/api/post", { method: "POST", body: fd });
		if (!res.ok) {
			throw new Error("Failed to resolve carrier blob");
		}
		const data = await res.json();
		if (!data.ok || !data.blob) {
			throw new Error(data.error || "Failed to resolve carrier blob");
		}
		return data.blob;
	}

	// Post Comment Submission
	async function handlePostSubmit(event) {
		event.preventDefault();
		if (!currentProfileUuid) {
			postError = "You must select a profile to post.";
			return;
		}
		if (!commentText.trim()) {
			postError = "Please enter comment text.";
			return;
		}
		if (commentText.length > charLimit) {
			postError = `Comment exceeds ${charLimit} character limit.`;
			return;
		}

		posting = true;
		postError = "";

		try {
			let resolvedBlob = null;
			let uploadedImgUrl = null;

			if (attachedImage) {
				// Upload custom attached image
				const fd = new FormData();
				fd.append("mode", "upload-media");
				fd.append("file", attachedImage);
				const uploadRes = await fetch("/api/post", { method: "POST", body: fd });
				if (!uploadRes.ok) {
					const errData = await uploadRes.json().catch(() => ({}));
					throw new Error(errData.error || "Image upload failed");
				}
				const uploadData = await uploadRes.json();
				resolvedBlob = uploadData.blob;
				uploadedImgUrl = uploadData.url;
			} else {
				// Fallback: use author's profilePic as carrier, but don't set it in alt JSON img field
				const profilePicUrl = currentProfile?.profilePic || "";
				resolvedBlob = await resolveCarrierBlob(profilePicUrl);
			}

			// Construct payload exactly as required
			const chatUuid = generateUuid();
			const altPayload = {
				uuid: chatUuid,
				context: context,
				prior: replyingToComment ? replyingToComment.uuid : "",
				stamp: buildCompressedTimestamp(Date.now()),
				author: currentProfileUuid,
				text: commentText.trim(),
				img: attachedImage ? uploadedImgUrl : null // Keep img null/empty if using fallback carrier
			};

			const postFd = new FormData();
			// Keep post text clean and do not append tags to post text
			postFd.append("text", commentText.trim());
			// Pass tags to help Bluesky index this post with context UUID
			postFd.append("tags", JSON.stringify(["chat", context]));
			postFd.append("uploadedMedia", JSON.stringify([
				{
					kind: "image",
					blob: resolvedBlob,
					alt: JSON.stringify(altPayload)
				}
			]));

			const postRes = await fetch("/api/post", { method: "POST", body: postFd });
			if (!postRes.ok) {
				const errData = await postRes.json().catch(() => ({}));
				throw new Error(errData.error || "Failed to publish comment to Bluesky");
			}

			// Cleanup form and reply states
			commentText = "";
			replyingToComment = null;
			removeAttachment();

			// Reload discussion comments
			await fetchComments();
		} catch (err) {
			postError = err.message || "An unexpected error occurred.";
		} finally {
			posting = false;
		}
	}

	function startReply(comment) {
		replyingToComment = comment;
		// Scroll to reply form
		const formEl = document.getElementById("chat-form");
		if (formEl) {
			formEl.scrollIntoView({ behavior: "smooth" });
		}
	}
</script>

<div class="chat-section">
	<div class="chat-header">
		<div class="chat-title-row">
			<MessageSquare class="icon-green" size={24} />
			<h2>Discussion</h2>
			<span class="comment-badge" aria-label="{flatComments.length} comments">
				{flatComments.length}
			</span>
		</div>
		<button class="refresh-btn" aria-label="Refresh comments" onclick={fetchComments} disabled={loading}>
			<RefreshCw class={loading ? "spin" : ""} size={18} />
		</button>
	</div>

	{#if error}
		<div class="error-banner">
			<AlertTriangle size={18} />
			<span>{error}</span>
		</div>
	{/if}

	{#if uniqueMissingPriors.length > 0}
		<div class="priors-actions">
			<button class="priors-btn" onclick={handleFetchPriors} disabled={fetchingPriors}>
				<ArrowUpRight size={16} />
				{fetchingPriors ? "Fetching priors..." : `Fetch prior comments (${uniqueMissingPriors.length})`}
			</button>
		</div>
	{/if}

	<div class="comments-list" aria-live="polite">
		{#if loading && comments.length === 0}
			<div class="loading-state">
				<div class="skeleton-avatar"></div>
				<div class="skeleton-lines">
					<div class="skeleton-line-long"></div>
					<div class="skeleton-line-short"></div>
				</div>
			</div>
		{:else if comments.length === 0}
			<div class="empty-state">
				<p>No comments yet. Start the conversation!</p>
			</div>
		{:else}
			<div class="tree-container">
				{#each commentTree as node (node.uuid)}
					{@render commentNode(node)}
				{/each}
			</div>
		{/if}
	</div>

	<!-- Discussion Input Form -->
	<div id="chat-form" class="comment-editor-panel">
		{#if !currentProfileUuid}
			<div class="auth-warning">
				<AlertTriangle size={20} class="icon-warning" />
				<p>You must select or create a profile to join the discussion.</p>
				<div class="auth-actions">
					{#if localProfiles.length > 0}
						<button class="btn-secondary" onclick={() => goto("/profile/select")}>Select Profile</button>
					{:else}
						<button class="btn-primary" onclick={() => goto("/profile/edit")}>Create Profile</button>
					{/if}
				</div>
			</div>
		{:else}
			<form onsubmit={handlePostSubmit} class="comment-form">
				{#if replyingToComment}
					<div class="replying-banner">
						<CornerDownRight size={16} />
						<span>Replying to <strong>{authorProfiles[replyingToComment.author]?.name || "Anonymous"}</strong></span>
						<button type="button" class="cancel-reply-btn" onclick={() => replyingToComment = null} aria-label="Cancel reply">
							<X size={14} />
						</button>
					</div>
				{/if}

				<div class="editor-header">
					<img src={currentProfile?.profilePic || "/dog-logo.jpg"} alt={currentProfile?.name || "My Avatar"} class="editor-avatar" />
					<div class="editor-user-info">
						<span class="editor-username">{currentProfile?.name || "Anonymous"}</span>
					</div>
				</div>

				<div class="editor-textarea-wrapper">
					<textarea
						bind:value={commentText}
						placeholder={replyingToComment ? "Write a reply..." : "Add to the discussion..."}
						maxlength={charLimit}
						rows="3"
						disabled={posting}
					></textarea>

					{#if attachedImagePreview}
						<div class="preview-container">
							<img src={attachedImagePreview} alt="Attached preview" />
							<button type="button" class="remove-preview-btn" onclick={removeAttachment} aria-label="Remove image">
								<X size={14} />
							</button>
						</div>
					{/if}
				</div>

				{#if postError}
					<div class="post-error">{postError}</div>
				{/if}

				<div class="editor-footer">
					<div class="footer-left">
						<label class="attach-btn" class:disabled={posting} title="Attach an image">
							<Image size={18} />
							<input type="file" accept="image/*" onchange={handleFileChange} disabled={posting} class="hidden-input" />
						</label>
						<span class="char-counter" class:warning={charsRemaining <= 30}>
							{charsRemaining}
						</span>
					</div>

					<button type="submit" class="send-btn" disabled={posting || !commentText.trim() || charsRemaining < 0}>
						{#if posting}
							<RefreshCw class="spin" size={16} />
							<span>Posting...</span>
						{:else}
							<Send size={16} />
							<span>Post</span>
						{/if}
					</button>
				</div>
			</form>
		{/if}
	</div>
</div>

<!-- Recursive Snippet for Threaded Comments -->
{#snippet commentNode(c)}
	<div class="comment-card-wrapper">
		<div class="comment-card">
			<div class="comment-layout">
				<a href="/profile/view/{c.author}" class="avatar-link">
					<img src={authorProfiles[c.author]?.profilePic || "/dog-logo.jpg"} alt={authorProfiles[c.author]?.name || "Avatar"} class="comment-avatar" />
				</a>
				<div class="comment-content">
					<div class="comment-meta">
						<a href="/profile/view/{c.author}" class="comment-author-name">
							{authorProfiles[c.author]?.name || "Anonymous"}
						</a>
						<span class="comment-time">
							{formatRelativeDateTime(parseTimestampMs(c.stamp, { allowBase36: true }), { allowBase36: true })}
						</span>
					</div>
					<div class="comment-text">
						{c.text}
					</div>
					{#if c.img}
						<div class="comment-attachment">
							<img src={c.img} alt="Comment attachment" loading="lazy" />
						</div>
					{/if}
					<div class="comment-actions">
						<button class="comment-action-btn" onclick={() => startReply(c)} title="Reply to comment">
							<Reply size={14} />
							<span>Reply</span>
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- Recursive Replies Container -->
		{#if c.replies && c.replies.length > 0}
			<div class="replies-list">
				{#each c.replies as reply (reply.uuid)}
					{@render commentNode(reply)}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<style>
	.chat-section {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		background: rgba(255, 250, 241, 0.95);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 1.5rem;
		box-shadow: 0 8px 24px rgba(65, 42, 20, 0.08);
		margin-top: 1.5rem;
	}

	.chat-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid rgba(96, 71, 49, 0.15);
		padding-bottom: 0.75rem;
	}

	.chat-title-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.chat-title-row h2 {
		margin: 0;
		font-size: 1.25rem;
		color: #2b271f;
		font-weight: 700;
	}

	.comment-badge {
		background: #3b6e4f;
		color: #fff;
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.icon-green {
		color: #3b6e4f;
	}

	.refresh-btn {
		background: transparent;
		border: none;
		color: #51463a;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.4rem;
		border-radius: 50%;
		transition: background 0.2s, color 0.2s;
	}

	.refresh-btn:hover:not(:disabled) {
		background: rgba(59, 110, 79, 0.1);
		color: #3b6e4f;
	}

	.refresh-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.priors-actions {
		display: flex;
		justify-content: center;
	}

	.priors-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: rgba(59, 110, 79, 0.1);
		border: 1px dashed rgba(59, 110, 79, 0.4);
		color: #3b6e4f;
		padding: 0.45rem 1rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.priors-btn:hover:not(:disabled) {
		background: #3b6e4f;
		color: #fff;
		border-style: solid;
	}

	.priors-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.comments-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.tree-container {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.comment-card-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.comment-card {
		background: #fff;
		border: 1px solid rgba(96, 71, 49, 0.12);
		border-radius: 12px;
		padding: 0.85rem 1rem;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
		transition: border-color 0.2s;
	}

	.comment-card:hover {
		border-color: rgba(59, 110, 79, 0.3);
	}

	.comment-layout {
		display: flex;
		gap: 0.75rem;
	}

	.avatar-link {
		flex-shrink: 0;
	}

	.comment-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid #fff;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
	}

	.comment-content {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		flex: 1;
		min-width: 0;
	}

	.comment-meta {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.comment-author-name {
		font-weight: 700;
		color: #2b271f;
		text-decoration: none;
		font-size: 0.9rem;
	}

	.comment-author-name:hover {
		color: #3b6e4f;
		text-decoration: underline;
	}

	.comment-time {
		font-size: 0.75rem;
		color: #6f5b47;
	}

	.comment-text {
		color: #4a3e3d;
		font-size: 0.95rem;
		line-height: 1.4;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.comment-attachment {
		margin-top: 0.5rem;
		border-radius: 8px;
		overflow: hidden;
		max-width: min(100%, 360px);
		box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
	}

	.comment-attachment img {
		display: block;
		width: 100%;
		height: auto;
	}

	.comment-actions {
		display: flex;
		gap: 1rem;
		margin-top: 0.3rem;
	}

	.comment-action-btn {
		background: transparent;
		border: none;
		color: #5f665f;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		transition: background 0.15s, color 0.15s;
	}

	.comment-action-btn:hover {
		background: rgba(59, 110, 79, 0.08);
		color: #3b6e4f;
	}

	.replies-list {
		border-left: 2px solid rgba(59, 110, 79, 0.25);
		margin-left: 1.25rem;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	/* Input Editor Panel */
	.comment-editor-panel {
		background: #fff;
		border: 1px solid rgba(96, 71, 49, 0.15);
		border-radius: 12px;
		padding: 1rem;
		box-shadow: 0 4px 12px rgba(65, 42, 20, 0.04);
	}

	.auth-warning {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 1.5rem;
		gap: 0.6rem;
		color: #51463a;
	}

	.icon-warning {
		color: #ba7a23;
	}

	.auth-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.btn-primary, .send-btn {
		background: #3b6e4f;
		color: #fff;
		border: 1px solid #305741;
		border-radius: 8px;
		padding: 0.5rem 1rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	.btn-primary:hover, .send-btn:hover:not(:disabled) {
		background: #2b533a;
	}

	.send-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: #fff;
		color: #305741;
		border: 1px solid #3b6e4f;
		border-radius: 8px;
		padding: 0.5rem 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}

	.btn-secondary:hover {
		background: rgba(59, 110, 79, 0.05);
	}

	.replying-banner {
		background: rgba(59, 110, 79, 0.08);
		border-left: 3px solid #3b6e4f;
		padding: 0.45rem 0.75rem;
		border-radius: 4px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: #3b6e4f;
		margin-bottom: 0.75rem;
	}

	.cancel-reply-btn {
		background: transparent;
		border: none;
		color: #8e2f21;
		cursor: pointer;
		margin-left: auto;
		display: flex;
		align-items: center;
		padding: 0.1rem;
		border-radius: 50%;
	}

	.cancel-reply-btn:hover {
		background: rgba(142, 47, 33, 0.1);
	}

	.editor-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.75rem;
	}

	.editor-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		object-fit: cover;
	}

	.editor-username {
		font-weight: 700;
		font-size: 0.88rem;
		color: #2b271f;
	}

	.editor-textarea-wrapper {
		position: relative;
		border: 1px solid rgba(96, 71, 49, 0.2);
		border-radius: 8px;
		overflow: hidden;
		background: #fffdfb;
		transition: border-color 0.2s;
	}

	.editor-textarea-wrapper:focus-within {
		border-color: #3b6e4f;
	}

	textarea {
		width: 100%;
		border: none;
		outline: none;
		resize: vertical;
		padding: 0.75rem;
		font-family: inherit;
		font-size: 0.95rem;
		color: #2b271f;
		background: transparent;
		box-sizing: border-box;
	}

	.preview-container {
		display: inline-block;
		position: relative;
		margin: 0.5rem;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid #d7c8b6;
		max-width: 120px;
		max-height: 120px;
	}

	.preview-container img {
		display: block;
		max-width: 100%;
		height: auto;
	}

	.remove-preview-btn {
		position: absolute;
		top: 4px;
		right: 4px;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		border: none;
		border-radius: 50%;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	.remove-preview-btn:hover {
		background: rgba(0, 0, 0, 0.8);
	}

	.post-error {
		color: #8e2f21;
		font-size: 0.85rem;
		margin-top: 0.4rem;
		font-weight: 600;
	}

	.editor-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 0.75rem;
	}

	.footer-left {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}

	.attach-btn {
		color: #3b6e4f;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.4rem;
		border-radius: 6px;
		transition: background 0.15s;
	}

	.attach-btn:hover {
		background: rgba(59, 110, 79, 0.08);
	}

	.attach-btn.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hidden-input {
		display: none;
	}

	.char-counter {
		font-size: 0.8rem;
		color: #6f5b47;
		font-weight: 600;
	}

	.char-counter.warning {
		color: #ba7a23;
	}

	.empty-state {
		text-align: center;
		padding: 2rem;
		color: #6f5b47;
		font-style: italic;
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(142, 47, 33, 0.08);
		border: 1px solid rgba(142, 47, 33, 0.25);
		color: #8e2f21;
		padding: 0.75rem;
		border-radius: 8px;
		font-size: 0.9rem;
	}

	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid rgba(96, 71, 49, 0.08);
		border-radius: 12px;
		background: #fff;
	}

	.skeleton-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: #e8e1d7;
		animation: shimmer 1.4s infinite;
	}

	.skeleton-lines {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.skeleton-line-long {
		height: 12px;
		width: 70%;
		border-radius: 6px;
		background: #e8e1d7;
		animation: shimmer 1.4s infinite;
	}

	.skeleton-line-short {
		height: 10px;
		width: 40%;
		border-radius: 6px;
		background: #e8e1d7;
		animation: shimmer 1.4s infinite;
	}

	.spin {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	@keyframes shimmer {
		0% { opacity: 0.6; }
		50% { opacity: 0.9; }
		100% { opacity: 0.6; }
	}
</style>
