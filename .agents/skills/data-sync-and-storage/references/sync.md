# Offline Synchronization Queue Reference

Synchronization operations and state consistency are defined in [sync.js](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/sync.js).

## How Sync Operations Work

### 1. Verification of Online State
* The sync queue runs via `processSyncQueue()`.
* It exits immediately if `navigator.onLine` is false or if another sync process is currently running (`syncInFlight` lock).

### 2. Media Upload Phase
* The queue processor checks the queued item for references to offline media URLs (e.g. `/offline-media/<localUuid>`).
* If found, the raw files are fetched from the IndexedDB `offlineImages` store and uploaded to Bluesky via `POST /api/post` (with `mode: 'upload-media'`).
* The local temporary URLs in text, HTML chunks, and image lists are replaced with the newly received public CDN URLs before publication.
* The successfully uploaded temporary image is deleted from the `offlineImages` store.

### 3. Publishing the Bundle
* The processor publishes the updated bundle via `publishChunkBundleToBsky`.
* Upon completion, the origin AT URI of the post is returned.

### 4. Updating Local States
* For **profiles**:
  - The local profile draft is updated with the returned `existingProfileAtUri` and `previousAtUri`.
  - Offline image properties are updated to point to the resolved CDN URLs.
  - The profile is updated in the profile registry (see `upsertStoredProfile`).
  - Map cache entries are updated (removing temporary local drafts and registering the new AT URI).
