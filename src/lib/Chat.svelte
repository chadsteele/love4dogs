<script>
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { generateUuid } from "$lib/uuid.js";
	import {
		getProfile,
		getPost,
		setPost,
		enqueueSync,
		getSyncQueue,
		deleteSyncItem,
		updateSyncItem,
		getOfflineImage,
		setOfflineImage,
		deleteOfflineImage
	} from "$lib/db.js";
	import { listStoredProfiles, getCurrentProfileUuid } from "$lib/profileRegistry.js";
	import { buildCompressedTimestamp, parseTimestampMs, formatRelativeDateTime } from "$lib/dateTime.js";
	import { MessageSquare, Image, X, Reply, RefreshCw, Send, AlertTriangle, CornerDownRight, ArrowUpRight } from "lucide-svelte";
	import { goto } from "$app/navigation";
	import ImageLayout from "$lib/ImageLayout.svelte";

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
	let attachedImages = $state([]); // Array of File objects
	let attachedImagePreviews = $state([]); // Array of object URL previews
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
		const newDetails = {};
		const promises = uniqueUuids.map(async (uuid) => {
			if (authorProfiles[uuid]) return;
			const details = await getProfileDetails(uuid);
			newDetails[uuid] = details;
		});
		await Promise.all(promises);
		if (Object.keys(newDetails).length > 0) {
			authorProfiles = {
				...authorProfiles,
				...newDetails
			};
		}
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

		const sorted = comments
			.map(c => ({ ...c, replies: [] }))
			.sort((a, b) => {
				const timeA = parseTimestampMs(a.stamp, { allowBase36: true }) || 0;
				const timeB = parseTimestampMs(b.stamp, { allowBase36: true }) || 0;
				return timeA - timeB;
			});

		for (const c of sorted) {
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

	// Module-level sync lock initialization
	if (globalThis.__love4dogsSyncQueueProcessing === undefined) {
		globalThis.__love4dogsSyncQueueProcessing = false;
	}

	async function mergeSyncQueueComments(existingComments) {
		try {
			const queue = await getSyncQueue();
			const contextQueue = queue.filter(item => item.context === context);
			if (contextQueue.length === 0) return existingComments;

			const existingUuids = new Set(existingComments.map(c => c.uuid));
			const merged = [...existingComments];

			for (const item of contextQueue) {
				if (!existingUuids.has(item.uuid)) {
					const syncComment = {
						uuid: item.uuid,
						context: item.context,
						prior: item.prior,
						stamp: item.stamp,
						author: item.author,
						text: item.text,
						img: item.imageUuids && item.imageUuids.length > 0 ? `/offline-media/${item.imageUuids[0]}` : null,
						imgs: item.imageUuids ? item.imageUuids.map(id => `/offline-media/${id}`) : null
					};
					merged.push(syncComment);
				}
			}
			return merged;
		} catch (err) {
			console.warn("Failed to merge sync queue comments:", err);
			return existingComments;
		}
	}

	async function processQueueItem(item) {
		let resolvedBlobs = [];
		let uploadedImgUrls = [];

		// 1. Upload images if any
		if (item.imageUuids && item.imageUuids.length > 0) {
			for (const imgUuid of item.imageUuids) {
				const blob = await getOfflineImage(imgUuid);
				if (!blob) {
					throw new Error(`Offline image ${imgUuid} not found`);
				}
				const fd = new FormData();
				fd.append("mode", "upload-media");
				fd.append("file", blob);
				const uploadRes = await fetch("/api/post", { method: "POST", body: fd });
				if (!uploadRes.ok) {
					const errData = await uploadRes.json().catch(() => ({}));
					throw new Error(errData.error || `Image upload failed for ${imgUuid}`);
				}
				const uploadData = await uploadRes.json();
				resolvedBlobs.push(uploadData.blob);
				uploadedImgUrls.push(uploadData.url);
			}
		} else {
			// Fallback: use author's profilePic as carrier, but don't set it in alt JSON img field
			const details = await getProfileDetails(item.author);
			const profilePicUrl = details?.profilePic || "";
			const fallbackBlob = await resolveCarrierBlob(profilePicUrl);
			resolvedBlobs = [fallbackBlob];
		}

		// 2. Construct altPayload
		const altPayload = {
			uuid: item.uuid,
			context: item.context,
			prior: item.prior,
			stamp: item.stamp,
			author: item.author,
			text: item.text,
			img: uploadedImgUrls.length > 0 ? uploadedImgUrls[0] : null,
			imgs: uploadedImgUrls.length > 0 ? uploadedImgUrls : null
		};

		// 3. Post to API
		const postFd = new FormData();
		postFd.append("text", item.text);
		postFd.append("tags", JSON.stringify(["chat", item.context]));

		const uploadedMedia = [];
		for (let i = 0; i < resolvedBlobs.length; i++) {
			uploadedMedia.push({
				kind: "image",
				blob: resolvedBlobs[i],
				alt: i === 0 ? JSON.stringify(altPayload) : `Attachment ${i + 1}`
			});
		}
		postFd.append("uploadedMedia", JSON.stringify(uploadedMedia));

		const postRes = await fetch("/api/post", { method: "POST", body: postFd });
		if (!postRes.ok) {
			const errData = await postRes.json().catch(() => ({}));
			throw new Error(errData.error || "Failed to publish comment to Bluesky");
		}
	}

	async function startQueueProcessor() {
		if (globalThis.__love4dogsSyncQueueProcessing) return;
		globalThis.__love4dogsSyncQueueProcessing = true;
		console.log("[Sync Queue] Background queue processor started.");
		try {
			while (true) {
				const queue = await getSyncQueue();
				// Filter queue items that are pending or failed and have retryCount < 10
				const nextItem = queue.find(item => item.status !== 'syncing' && (item.retryCount || 0) < 10);
				if (!nextItem) {
					break;
				}

				// Mark as syncing in IndexedDB
				nextItem.status = 'syncing';
				await updateSyncItem(nextItem.id, nextItem);

				let success = false;
				try {
					console.log(`[Sync Queue] Processing queue item ${nextItem.id} (attempt ${nextItem.retryCount + 1}/10)...`);
					await processQueueItem(nextItem);
					success = true;
				} catch (err) {
					console.error(`[Sync Queue] Queue item ${nextItem.id} failed:`, err);
				}

				if (success) {
					console.log(`[Sync Queue] Queue item ${nextItem.id} completed successfully.`);
					await deleteSyncItem(nextItem.id);
					if (nextItem.imageUuids) {
						for (const imgUuid of nextItem.imageUuids) {
							await deleteOfflineImage(imgUuid);
						}
					}
					// Trigger a background refresh to pull down indexed comments from Bluesky
					fetchComments().catch(() => {});
				} else {
					nextItem.retryCount = (nextItem.retryCount || 0) + 1;
					nextItem.status = 'pending';
					await updateSyncItem(nextItem.id, nextItem);

					if (nextItem.retryCount >= 10) {
						console.warn(`[Sync Queue] Queue item ${nextItem.id} exceeded max retries. Discarding.`);
						await deleteSyncItem(nextItem.id);
						if (nextItem.imageUuids) {
							for (const imgUuid of nextItem.imageUuids) {
								await deleteOfflineImage(imgUuid);
							}
						}
					} else {
						console.log(`[Sync Queue] Waiting 10 seconds before next retry of item ${nextItem.id}...`);
						await new Promise(resolve => setTimeout(resolve, 10000));
					}
				}
			}
		} finally {
			globalThis.__love4dogsSyncQueueProcessing = false;
			console.log("[Sync Queue] Background queue processor finished.");
		}
	}

	// Initial loading & profile checks
	onMount(async () => {
		await loadSessionProfile();
		await fetchComments();
		startQueueProcessor().catch(err => console.error("Error starting queue processor", err));
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
		const currentCacheKey = `bsky:feed:${context}:latest:20::`;
		error = "";
		let cacheLoaded = false;

		// 1. Try to load from local IndexedDB cache first
		try {
			const cachedData = await getPost(currentCacheKey);
			if (cachedData && Array.isArray(cachedData.posts)) {
				const fetched = [];
				for (const post of cachedData.posts) {
					if (post.imageAlts && post.imageAlts.length > 0) {
						try {
							const payload = JSON.parse(post.imageAlts[0]);
							if (payload && payload.uuid && payload.context === context && payload.author) {
								fetched.push(payload);
							}
						} catch {}
					}
				}
				comments = await mergeSyncQueueComments(fetched);
				// Load profiles for these comments immediately
				const authorUuids = comments.map(c => c.author);
				await loadAuthorProfiles(authorUuids);
				// Hide skeleton loader immediately since cache loaded successfully
				loading = false;
				cacheLoaded = true;
			}
		} catch (err) {
			console.warn("Failed to load comments from local cache:", err);
		}

		// 2. Fetch latest comments from the SvelteKit API (network)
		try {
			const res = await fetch(`/api/feed?query=${encodeURIComponent(context)}&limit=20&refresh=1&chat=1`);
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

			// Merge local pending comments that haven't been indexed by Bluesky yet (within last 2 minutes)
			const fetchedUuids = new Set(fetched.map(c => c.uuid));
			const nowMs = Date.now();
			const localPending = comments.filter(c => {
				if (fetchedUuids.has(c.uuid)) return false;
				if (c.author !== currentProfileUuid) return false;
				const stampMs = parseTimestampMs(c.stamp, { allowBase36: true }) || 0;
				return (nowMs - stampMs) < 2 * 60 * 1000;
			});

			const mergedComments = [...fetched, ...localPending];
			comments = await mergeSyncQueueComments(mergedComments);

			// Also merge local pending posts into the database cache data
			const cachedData = cacheLoaded ? await getPost(currentCacheKey) : null;
			const cachedPosts = cachedData?.posts || [];
			const fetchedUris = new Set(posts.map(p => p.uri));
			const fetchedDisplayKeys = new Set(posts.map(p => p.displayKey));
			const localPendingPosts = cachedPosts.filter(p => {
				if (p.cid !== "local-pending") return false;
				if (fetchedUris.has(p.uri) || fetchedDisplayKeys.has(p.displayKey)) return false;
				const createdAtMs = Date.parse(p.createdAt) || 0;
				return (nowMs - createdAtMs) < 2 * 60 * 1000;
			});

			data.posts = [...posts, ...localPendingPosts];
			await setPost(currentCacheKey, data);

			// Load profiles for these comment authors
			const authorUuids = comments.map(c => c.author);
			await loadAuthorProfiles(authorUuids);
		} catch (err) {
			// Only show error if we don't have any comments loaded from cache
			if (comments.length === 0) {
				error = err.message || "Unable to load comments.";
			}
		} finally {
			loading = false;
		}
	}

	async function fetchCommentByUuid(uuid) {
		try {
			const res = await fetch(`/api/feed?query=${encodeURIComponent(uuid)}&chat=1`);
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
		const files = Array.from(event.target.files || []);
		if (files.length === 0) return;

		const remaining = 4 - attachedImages.length;
		if (remaining <= 0) {
			postError = "You can attach up to 4 images.";
			return;
		}

		const toAdd = files.slice(0, remaining);
		for (const file of toAdd) {
			if (!file.type.startsWith("image/")) {
				postError = "Please select image files only.";
				continue;
			}
			if (file.size > 2 * 1024 * 1024) {
				postError = "Each image must be 2 MB or smaller.";
				continue;
			}
			attachedImages = [...attachedImages, file];
			attachedImagePreviews = [...attachedImagePreviews, URL.createObjectURL(file)];
		}
		postError = "";
		event.target.value = "";
	}

	function removeAttachment(index) {
		if (index === undefined) {
			for (const preview of attachedImagePreviews) {
				URL.revokeObjectURL(preview);
			}
			attachedImages = [];
			attachedImagePreviews = [];
		} else {
			URL.revokeObjectURL(attachedImagePreviews[index]);
			attachedImages = attachedImages.filter((_, i) => i !== index);
			attachedImagePreviews = attachedImagePreviews.filter((_, i) => i !== index);
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
			const chatUuid = generateUuid();
			const stamp = buildCompressedTimestamp(Date.now());

			// Save attached images to offlineImages
			const imageUuids = [];
			const localImgUrls = [];
			for (const file of attachedImages) {
				const imgUuid = generateUuid();
				await setOfflineImage(imgUuid, file);
				imageUuids.push(imgUuid);
				localImgUrls.push(`/offline-media/${imgUuid}`);
			}

			const syncItem = {
				uuid: chatUuid,
				context: context,
				prior: replyingToComment ? replyingToComment.uuid : "",
				stamp: stamp,
				author: currentProfileUuid,
				text: commentText.trim(),
				imageUuids: imageUuids,
				retryCount: 0,
				status: 'pending'
			};

			await enqueueSync(syncItem);

			// Construct payload for optimistic UI update
			const altPayload = {
				uuid: chatUuid,
				context: context,
				prior: replyingToComment ? replyingToComment.uuid : "",
				stamp: stamp,
				author: currentProfileUuid,
				text: commentText.trim(),
				img: localImgUrls.length > 0 ? localImgUrls[0] : null, // Keep single img field for compatibility
				imgs: localImgUrls.length > 0 ? localImgUrls : null  // Array of up to 4 images
			};

			// Optimistic Update: Add current author's details to local cache immediately
			if (currentProfileUuid && currentProfile) {
				authorProfiles = {
					...authorProfiles,
					[currentProfileUuid]: currentProfile
				};
			}

			// Add the new comment locally to comments array immediately
			comments = [...comments, altPayload];

			// Cache the comment in IndexedDB so it persists across views
			try {
				const currentCacheKey = `bsky:feed:${context}:latest:20::`;
				const cachedData = await getPost(currentCacheKey) || {
					account: "love4dogs.club",
					posts: [],
					cursor: null,
					cursorHost: null,
					commonRecentTags: []
				};

				const newMappedPost = {
					uri: `at://did:plc:local/app.bsky.feed.post/${chatUuid}`,
					displayKey: chatUuid,
					cid: "local-pending",
					text: commentText.trim(),
					author: {
						did: currentProfileUuid,
						handle: currentProfile?.name || "anonymous",
						displayName: currentProfile?.name || "Anonymous",
						avatar: currentProfile?.profilePic || ""
					},
					createdAt: new Date().toISOString(),
					images: localImgUrls.length > 0 ? [...localImgUrls] : [],
					imageAlts: [JSON.stringify(altPayload)],
					tags: ["chat", context],
					replyCount: 0,
					repostCount: 0,
					likeCount: 0,
					comments: []
				};

				cachedData.posts = [newMappedPost, ...(cachedData.posts || [])];
				await setPost(currentCacheKey, cachedData);
			} catch (cacheErr) {
				console.warn("Failed to update comments in local database cache:", cacheErr);
			}

			// Cleanup form and reply states
			commentText = "";
			replyingToComment = null;
			removeAttachment();

			// Trigger the background queue processing without awaiting it
			startQueueProcessor().catch(err => console.error("Error running queue processor", err));
		} catch (err) {
			postError = err.message || "An unexpected error occurred while saving locally.";
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

					{#if attachedImagePreviews.length > 0}
						<div class="previews-container">
							{#each attachedImagePreviews as preview, index}
								<div class="preview-container">
									<img src={preview} alt="Attached preview {index + 1}" />
									<button type="button" class="remove-preview-btn" onclick={() => removeAttachment(index)} aria-label="Remove image">
										<X size={14} />
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				{#if postError}
					<div class="post-error">{postError}</div>
				{/if}

				<div class="editor-footer">
					<div class="footer-left">
						<label class="attach-btn" class:disabled={posting} title="Attach images (up to 4)">
							<Image size={18} />
							<input type="file" accept="image/*" multiple onchange={handleFileChange} disabled={posting} class="hidden-input" />
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
					{#if c.imgs && c.imgs.length > 0}
						<div class="comment-attachment">
							<ImageLayout images={c.imgs} alt="Comment attachment" />
						</div>
					{:else if c.img}
						<div class="comment-attachment">
							<ImageLayout images={[c.img]} alt="Comment attachment" />
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
		width:fit-content;
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
		width: 360px;
		max-width: 100%;
		box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
	}

	.comment-attachment img {
		display: block;
		width:auto;
		height: 100px;
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

	.previews-container {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.5rem;
		background: rgba(0, 0, 0, 0.02);
		border-top: 1px solid rgba(96, 71, 49, 0.1);
	}

	.preview-container {
		display: inline-block;
		position: relative;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid #d7c8b6;
		width: 80px;
		height: 80px;
	}

	.preview-container img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
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
