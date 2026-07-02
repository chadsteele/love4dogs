# Local Database Reference

All local persistence is managed in [db.js](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/db.js). It uses IndexedDB with an in-memory Map fallback for SSR and test execution (e.g. Node.js).

## Store Definitions

1. **`settings`**: Key-value store for user preferences and application settings.
2. **`profiles`**: Store for local dog profile drafts, keyed by UUID.
3. **`posts`**: Store for locally cached feed posts, keyed by Bluesky post URI.
4. **`syncQueue`**: Autoincrementing queue storing operations to synchronize with Bluesky.
5. **`offlineImages`**: Image blobs cached for offline post/profile edits, keyed by UUID.

## Key Mechanisms

### 1. In-Memory Fallbacks
If `indexedDB` or `window` is undefined, queries fall back to `memoryStores` Maps. The mock queue uses an auto-incrementing integer key `nextSyncId`.

### 2. Post Cache Pruning & Expiration (TTL)
To prevent unbound local database growth:
* **7-Day Expiration**: Posts are kept for at most 7 days (`7 * 24 * 60 * 60 * 1000` ms). When retrieved via `getPost` or `getAllPosts`, any expired post is filtered out and deleted from the store.
* **100-Post Limit**: When adding posts via `setPost`, the store checks if the post count exceeds 100. If it does, posts are sorted by `cachedAt` timestamp, and the oldest posts are pruned until the count returns to 100.

### 3. LocalStorage Migrations
Upon browser load, `migrateFromLocalStorage()` runs once to move existing data into IndexedDB:
* Migrates current profile UUID and settings keys (e.g. `love4dogs.settings.favorite-search-terms-v1`, `love4dogs.location-cache`, etc.).
* Migrates draft profile data from keys starting with `love4dogs.profile-v2.`.
* Deletes migrated keys from LocalStorage.
