import {
	getSyncQueue,
	deleteSyncItem,
	getOfflineImage,
	deleteOfflineImage,
	setProfile,
	getProfile
} from './db.js';
import { publishChunkBundleToBsky } from './bskyChunkStore.js';
import { getCurrentProfileUuid, upsertStoredProfile } from './profileRegistry.js';

let syncInFlight = false;

export async function processSyncQueue() {
	if (syncInFlight) return;
	if (typeof navigator !== 'undefined' && !navigator.onLine) return;

	syncInFlight = true;
	console.log('[Sync] Starting sync queue processing...');

	try {
		const queue = await getSyncQueue();
		if (queue.length === 0) {
			console.log('[Sync] Queue is empty.');
			return;
		}

		for (const item of queue) {
			try {
				console.log(`[Sync] Syncing item ${item.id} (type: ${item.type}, uuid: ${item.uuid})`);
				await syncItem(item);
				await deleteSyncItem(item.id);
				console.log(`[Sync] Successfully synced item ${item.id}`);
			} catch (err) {
				console.error(`[Sync] Failed to sync item ${item.id}:`, err);
				// Stop processing the rest of the queue if we hit a network or system issue
				if (typeof navigator !== 'undefined' && !navigator.onLine) break;
			}
		}
	} finally {
		syncInFlight = false;
		console.log('[Sync] Sync queue processing finished.');
	}
}

async function syncItem(item) {
	const { uuid, type, postText, chunks = [], primaryPayload = {} } = item;
	let { primaryMedia = [], replyAttachmentPool = [], videoAttachments = [] } = item;

	// 1. Gather all unique offline media references (e.g. offline-img-<localUuid>)
	const offlineMediaMap = new Map(); // localUuid -> uploadedUrl/uploadedBlob

	// Helper to extract offline ID from url
	const getOfflineId = (url) => {
		if (typeof url !== 'string') return null;
		const match = url.match(/\/offline-media\/([a-zA-Z0-9-]+)/);
		return match ? match[1] : null;
	};

	// Find and upload offline images
	const mediaLists = [primaryMedia, replyAttachmentPool, videoAttachments];
	for (const list of mediaLists) {
		for (const media of list) {
			if (!media) continue;
			const offlineId = getOfflineId(media.url) || getOfflineId(media.bskyUrl) || (media.isOfflineMedia ? media.offlineId : null);
			if (offlineId && !offlineMediaMap.has(offlineId)) {
				console.log(`[Sync] Uploading offline image: ${offlineId}`);
				const fileBlob = await getOfflineImage(offlineId);
				if (!fileBlob) {
					throw new Error(`Offline image data not found for ID: ${offlineId}`);
				}

				// Upload to /api/post
				const fd = new FormData();
				fd.append('mode', 'upload-media');
				fd.append('file', fileBlob, media.alt || 'Photo');

				const res = await fetch('/api/post', {
					method: 'POST',
					body: fd
				});
				const json = await res.json().catch(() => ({}));
				if (!res.ok || !json.ok) {
					throw new Error(json.error || `Failed to upload image ${offlineId} to Bluesky`);
				}

				console.log(`[Sync] Image ${offlineId} uploaded successfully. URL: ${json.url}`);
				offlineMediaMap.set(offlineId, {
					url: json.url,
					blob: json.blob
				});

				// Clean up the offline image from DB
				await deleteOfflineImage(offlineId);
			}
		}
	}

	// 2. Replace offline URLs and blobs in media arrays
	const mapMediaEntry = (media) => {
		if (!media) return media;
		const offlineId = getOfflineId(media.url) || getOfflineId(media.bskyUrl) || (media.isOfflineMedia ? media.offlineId : null);
		if (offlineId && offlineMediaMap.has(offlineId)) {
			const uploaded = offlineMediaMap.get(offlineId);
			return {
				...media,
				url: uploaded.url,
				bskyUrl: uploaded.url,
				blob: uploaded.blob,
				isOfflineMedia: false
			};
		}
		return media;
	};

	primaryMedia = primaryMedia.map(mapMediaEntry);
	replyAttachmentPool = replyAttachmentPool.map(mapMediaEntry);
	videoAttachments = videoAttachments.map(mapMediaEntry);

	// 3. Replace offline URL strings in text, HTML chunks, and primaryPayload
	const replaceOfflineUrlsInString = (str) => {
		if (typeof str !== 'string') return str;
		let nextStr = str;
		for (const [offlineId, uploaded] of offlineMediaMap.entries()) {
			const targetUrl = `/offline-media/${offlineId}`;
			nextStr = nextStr.replaceAll(targetUrl, uploaded.url);
		}
		return nextStr;
	};

	const updatedPostText = replaceOfflineUrlsInString(postText);

	// Update primaryPayload fields
	const updatedPrimaryPayload = { ...primaryPayload };
	if (String(type || '').trim().toLowerCase() === 'post') {
		const payloadUuid = String(updatedPrimaryPayload.uuid || uuid || '').trim();
		const payloadAuthorId = String(updatedPrimaryPayload.authorid || updatedPrimaryPayload.authorId || '').trim();
		if (!payloadAuthorId || (payloadUuid && payloadAuthorId === payloadUuid)) {
			const currentProfileUuid = String(await getCurrentProfileUuid() || '').trim();
			if (!currentProfileUuid) {
				throw new Error('Cannot sync post: missing selected profile author UUID.');
			}
			if (payloadUuid && currentProfileUuid === payloadUuid) {
				throw new Error('Cannot sync post: selected profile UUID matches post UUID (invalid author mapping).');
			}
			updatedPrimaryPayload.authorid = currentProfileUuid;
		}
	}
	if (updatedPrimaryPayload.html) {
		updatedPrimaryPayload.html = replaceOfflineUrlsInString(updatedPrimaryPayload.html);
	}
	if (updatedPrimaryPayload.profilePic) {
		updatedPrimaryPayload.profilePic = replaceOfflineUrlsInString(updatedPrimaryPayload.profilePic);
	}
	if (updatedPrimaryPayload.backgroundPic) {
		updatedPrimaryPayload.backgroundPic = replaceOfflineUrlsInString(updatedPrimaryPayload.backgroundPic);
	}

	// Update chunks content HTML
	const updatedChunks = chunks.map(chunk => {
		if (!chunk || !chunk.bundleFragment) return chunk;
		return {
			...chunk,
			bundleFragment: replaceOfflineUrlsInString(chunk.bundleFragment)
		};
	});

	// 4. Publish compiled bundle to Bluesky
	console.log(`[Sync] Publishing chunk bundle to Bluesky for ${uuid}`);
	const publishResult = await publishChunkBundleToBsky({
		fetchImpl: fetch,
		endpoint: '/api/post',
		uuid,
		postType: type,
		postText: updatedPostText,
		chunks: updatedChunks,
		primaryPayload: updatedPrimaryPayload,
		primaryMedia,
		replyAttachmentPool,
		videoAttachments
	});

	const newPublishedAtUri = String(publishResult?.primaryResult?.uri || '').trim();
	console.log(`[Sync] Published successfully. AT URI: ${newPublishedAtUri}`);

	// 5. Update local draft in IndexedDB profiles
	if (type === 'profile' && newPublishedAtUri) {
		const localProfile = await getProfile(uuid);
		if (localProfile) {
			localProfile.existingProfileAtUri = newPublishedAtUri;
			localProfile.previousAtUri = newPublishedAtUri;
			// Update local profile images to real URLs
			if (localProfile.profileUploadedMedia) {
				localProfile.profileUploadedMedia = localProfile.profileUploadedMedia.map(mapMediaEntry);
			}
			if (localProfile.backgroundUploadedMedia) {
				localProfile.backgroundUploadedMedia = localProfile.backgroundUploadedMedia.map(mapMediaEntry);
			}
			localProfile.savedAt = Date.now();
			await setProfile(uuid, localProfile);

			// Register in profiles summary
			await upsertStoredProfile({
				uuid,
				profileName: localProfile.profileName || localProfile.name || '',
				avatarUrl: String(
					localProfile.profileUploadedMedia?.[0]?.url || ''
				)
			});

			// Update the map cache: replace local-draft with real AT URI
			if (localProfile.locationConfirmed && localProfile.confirmedLocation) {
				try {
					const { upsertApproxPostInCache, removeApproxPostFromCache } = await import('./utils.js');
					await removeApproxPostFromCache(`local-draft://${uuid}`);
					await upsertApproxPostInCache({
						uri: newPublishedAtUri,
						uuid,
						text: [localProfile.profileName, localProfile.profileDescription].filter(Boolean).join('\n'),
						lat: localProfile.confirmedLocation.lat,
						lon: localProfile.confirmedLocation.lon,
						images: localProfile.profileUploadedMedia?.[0]?.url ? [localProfile.profileUploadedMedia[0].url] : [],
						isUserPost: true
					});
				} catch (e) {
					console.error('[Sync] Failed to update map cache on sync:', e);
				}
			}
		}
	}
}

// Register listeners in browser
if (typeof window !== 'undefined') {
	window.addEventListener('online', () => {
		processSyncQueue().catch((err) => {
			console.error('[Sync] Background sync check failed:', err);
		});
	});

	// Also trigger a check when app loads
	setTimeout(() => {
		processSyncQueue().catch((err) => {
			console.error('[Sync] Initial sync check failed:', err);
		});
	}, 2000);
}
