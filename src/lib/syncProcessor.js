import {
	getProfile,
	getPost,
	setPost,
	getSyncQueue,
	deleteSyncItem,
	updateSyncItem,
	getOfflineImage,
	deleteOfflineImage
} from "$lib/db.js";
import { listStoredProfiles } from "$lib/profileRegistry.js";

const profileCache = new Map();

export async function getProfileDetails(authorUuid) {
	const key = String(authorUuid || "").trim();
	if (!key) return { name: "Anonymous", profilePic: "" };
	if (profileCache.has(key)) return profileCache.get(key);

	// 1. Check local profiles registry
	try {
		const localProfiles = await listStoredProfiles();
		const registryMatch = localProfiles.find(p => p.uuid === key);
		if (registryMatch) {
			const profile = {
				name: registryMatch.name || "Anonymous",
				profilePic: registryMatch.avatarUrl || ""
			};
			profileCache.set(key, profile);
			return profile;
		}
	} catch (e) {
		console.warn("Failed to list stored profiles in getProfileDetails:", e);
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

async function resolveCarrierBlob(url) {
	const origin = typeof window !== "undefined" ? window.location.origin : "";
	const targetUrl = String(url || "").trim() || (origin + "/dog-logo.jpg");
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
		prior: item.prior || "",
		stamp: item.stamp,
		author: item.author || null,
		text: item.text,
		img: uploadedImgUrls.length > 0 ? uploadedImgUrls[0] : null,
		imgs: uploadedImgUrls.length > 0 ? uploadedImgUrls : null,
		imgHashes: item.imgHashes || []
	};
	if (item.share) {
		altPayload.share = item.share;
	}

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

export async function startQueueProcessor(onItemSynced = () => {}) {
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
				// Trigger callback
				try {
					await onItemSynced(nextItem);
				} catch (err) {
					console.error("Error in onItemSynced callback:", err);
				}
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
