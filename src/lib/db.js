import { DbCacheEntry, DbCacheStore } from './models.js';

const DB_NAME = 'love4dogs_db';
const DB_VERSION = 1;

let dbPromise = null;
const postCacheStore = DbCacheStore.from({ storeName: 'posts', maxEntries: 100 });
const offlineImageCacheStore = DbCacheStore.from({ storeName: 'offlineImages', maxEntries: 200 });

// In-memory fallback for Node.js / SSR / testing environments
const memoryStores = {
	settings: new Map(),
	profiles: new Map(),
	posts: new Map(),
	syncQueue: new Map(), // key: auto-incrementing int
	offlineImages: new Map()
};
let nextSyncId = 1;

function unwrap(val) {
	if (val === null || typeof val !== 'object') {
		return val;
	}
	if (Array.isArray(val)) {
		return val.map(unwrap);
	}
	if (typeof Blob !== 'undefined' && val instanceof Blob) {
		return val;
	}
	if (typeof File !== 'undefined' && val instanceof File) {
		return val;
	}
	if (typeof ArrayBuffer !== 'undefined' && val instanceof ArrayBuffer) {
		return val;
	}
	const copy = {};
	for (const key of Object.keys(val)) {
		copy[key] = unwrap(val[key]);
	}
	return copy;
}

function createCachedRecord(key, value, options = {}) {
	return DbCacheEntry.from(key, unwrap(value), options).toJSON();
}

export function getDB() {
	if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
		return null;
	}
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = (event) => {
				const db = event.target.result;
				if (!db.objectStoreNames.contains('settings')) {
					db.createObjectStore('settings');
				}
				if (!db.objectStoreNames.contains('profiles')) {
					db.createObjectStore('profiles');
				}
				if (!db.objectStoreNames.contains('posts')) {
					db.createObjectStore('posts');
				}
				if (!db.objectStoreNames.contains('syncQueue')) {
					db.createObjectStore('syncQueue', { autoIncrement: true });
				}
				if (!db.objectStoreNames.contains('offlineImages')) {
					db.createObjectStore('offlineImages');
				}
			};
			request.onsuccess = (event) => {
				resolve(event.target.result);
			};
			request.onerror = (event) => {
				reject(event.target.error);
			};
		});
	}
	return dbPromise;
}

// ── Settings store helpers ──────────────────────────────────────────────────
export async function getSetting(key, fallback = null) {
	const db = await getDB();
	if (!db) {
		return memoryStores.settings.has(key) ? memoryStores.settings.get(key) : fallback;
	}
	return new Promise((resolve) => {
		const tx = db.transaction('settings', 'readonly');
		const store = tx.objectStore('settings');
		const req = store.get(key);
		req.onsuccess = () => resolve(req.result !== undefined ? req.result : fallback);
		req.onerror = () => resolve(fallback);
	});
}

export async function setSetting(key, value) {
	const db = await getDB();
	const unwrapped = unwrap(value);
	if (!db) {
		memoryStores.settings.set(key, unwrapped);
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('settings', 'readwrite');
		const store = tx.objectStore('settings');
		const req = store.put(unwrapped, key);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function removeSetting(key) {
	const db = await getDB();
	if (!db) {
		memoryStores.settings.delete(key);
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('settings', 'readwrite');
		const store = tx.objectStore('settings');
		const req = store.delete(key);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

// ── Profiles store helpers ──────────────────────────────────────────────────
export async function getProfile(uuid) {
	const db = await getDB();
	if (!db) {
		return memoryStores.profiles.get(uuid) || null;
	}
	return new Promise((resolve) => {
		const tx = db.transaction('profiles', 'readonly');
		const store = tx.objectStore('profiles');
		const req = store.get(uuid);
		req.onsuccess = () => resolve(req.result || null);
		req.onerror = () => resolve(null);
	});
}

export async function setProfile(uuid, data) {
	const db = await getDB();
	const unwrapped = unwrap(data);
	if (!db) {
		memoryStores.profiles.set(uuid, unwrapped);
		const remaining = [];
		for (const [key, val] of memoryStores.profiles.entries()) {
			if (val && val.cachedAt && val.data) {
				remaining.push({ key, val });
			}
		}
		if (remaining.length > 100) {
			remaining.sort((a, b) => (a.val.cachedAt || 0) - (b.val.cachedAt || 0));
			const toDeleteCount = remaining.length - 100;
			for (let i = 0; i < toDeleteCount; i++) {
				memoryStores.profiles.delete(remaining[i].key);
			}
		}
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('profiles', 'readwrite');
		const store = tx.objectStore('profiles');
		
		store.put(unwrapped, uuid);
		
		const items = [];
		const req = store.openCursor();
		req.onsuccess = (event) => {
			const cursor = event.target.result;
			if (cursor) {
				items.push({ key: cursor.key, value: cursor.value });
				cursor.continue();
			} else {
				const toDelete = [];
				const remaining = [];
				
				for (const item of items) {
					const val = item.value;
					if (val && val.cachedAt && val.data) {
						remaining.push(item);
					}
				}
				
				if (remaining.length > 100) {
					remaining.sort((a, b) => (a.value.cachedAt || 0) - (b.value.cachedAt || 0));
					const deleteCount = remaining.length - 100;
					for (let i = 0; i < deleteCount; i++) {
						toDelete.push(remaining[i].key);
					}
				}
				
				for (const key of toDelete) {
					store.delete(key);
				}
			}
		};
		
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function deleteProfile(uuid) {
	const db = await getDB();
	if (!db) {
		memoryStores.profiles.delete(uuid);
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('profiles', 'readwrite');
		const store = tx.objectStore('profiles');
		const req = store.delete(uuid);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function getAllProfiles() {
	const db = await getDB();
	if (!db) {
		return Array.from(memoryStores.profiles.values());
	}
	return new Promise((resolve) => {
		const tx = db.transaction('profiles', 'readonly');
		const store = tx.objectStore('profiles');
		const req = store.getAll();
		req.onsuccess = () => resolve(req.result || []);
		tx.onerror = () => resolve([]);
	});
}

// ── Posts store helpers ─────────────────────────────────────────────────────
export async function getPost(uri) {
	const db = await getDB();
	if (!db) {
		return memoryStores.posts.get(uri) || null;
	}
	return new Promise((resolve) => {
		const tx = db.transaction('posts', 'readonly');
		const store = tx.objectStore('posts');
		const req = store.get(uri);
		req.onsuccess = () => resolve(req.result || null);
		req.onerror = () => resolve(null);
	});
}

export async function setPost(uri, data) {
	const db = await getDB();
	const cachedRecord = createCachedRecord(uri, data, {
		cachedAt: data?._testCachedAt || data?.cachedAt || Date.now()
	});
	if (!db) {
		memoryStores.posts.set(uri, cachedRecord);
		postCacheStore.pruneMemoryStore(memoryStores.posts);
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('posts', 'readwrite');
		const store = tx.objectStore('posts');
		
		// Put the new post
		store.put(cachedRecord, uri);
		
		// Read and prune in the same transaction
		const items = [];
		const req = store.openCursor();
		req.onsuccess = (event) => {
			const cursor = event.target.result;
			if (cursor) {
				items.push({ key: cursor.key, value: cursor.value });
				cursor.continue();
			} else {
				const toDelete = [];
				const remaining = [];
				
				for (const item of items) {
					remaining.push(item);
				}
				
				if (remaining.length > postCacheStore.maxEntries) {
					remaining.sort((a, b) => (a.value?.cachedAt || 0) - (b.value?.cachedAt || 0));
					const deleteCount = remaining.length - postCacheStore.maxEntries;
					for (let i = 0; i < deleteCount; i++) {
						toDelete.push(remaining[i].key);
					}
				}
				
				for (const key of toDelete) {
					store.delete(key);
				}
			}
		};
		
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function deletePost(uri) {
	const db = await getDB();
	if (!db) {
		memoryStores.posts.delete(uri);
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('posts', 'readwrite');
		const store = tx.objectStore('posts');
		const req = store.delete(uri);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function getAllPosts() {
	const db = await getDB();
	if (!db) {
		return Array.from(memoryStores.posts.values());
	}
	return new Promise((resolve) => {
		const tx = db.transaction('posts', 'readonly');
		const store = tx.objectStore('posts');
		const req = store.getAll();
		req.onsuccess = () => resolve(req.result || []);
		req.onerror = () => resolve([]);
	});
}

// ── Sync Queue helpers ──────────────────────────────────────────────────────
export async function enqueueSync(item) {
	const db = await getDB();
	const unwrapped = unwrap(item);
	if (!db) {
		const id = nextSyncId++;
		memoryStores.syncQueue.set(id, unwrapped);
		return id;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('syncQueue', 'readwrite');
		const store = tx.objectStore('syncQueue');
		const req = store.add(unwrapped);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function updateSyncItem(id, item) {
	const db = await getDB();
	const unwrapped = unwrap(item);
	if (!db) {
		memoryStores.syncQueue.set(id, unwrapped);
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('syncQueue', 'readwrite');
		const store = tx.objectStore('syncQueue');
		const req = store.put(unwrapped, id);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function getSyncQueue() {
	const db = await getDB();
	if (!db) {
		return Array.from(memoryStores.syncQueue.entries()).map(([id, val]) => ({ id, ...val }));
	}
	return new Promise((resolve) => {
		const tx = db.transaction('syncQueue', 'readonly');
		const store = tx.objectStore('syncQueue');
		const keysReq = store.getAllKeys();
		const valsReq = store.getAll();

		tx.oncomplete = () => {
			const keys = keysReq.result || [];
			const vals = valsReq.result || [];
			const list = keys.map((key, i) => ({ id: key, ...vals[i] }));
			resolve(list);
		};
		tx.onerror = () => resolve([]);
	});
}

export async function deleteSyncItem(id) {
	const db = await getDB();
	if (!db) {
		memoryStores.syncQueue.delete(id);
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('syncQueue', 'readwrite');
		const store = tx.objectStore('syncQueue');
		const req = store.delete(id);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

// ── Offline Images helpers ──────────────────────────────────────────────────
export async function getOfflineImage(uuid) {
	const db = await getDB();
	if (!db) {
		const val = memoryStores.offlineImages.get(uuid) || null;
		return val && val.blob ? val.blob : val;
	}
	return new Promise((resolve) => {
		const tx = db.transaction('offlineImages', 'readonly');
		const store = tx.objectStore('offlineImages');
		const req = store.get(uuid);
		req.onsuccess = () => {
			const res = req.result;
			resolve(res && res.blob ? res.blob : (res || null));
		};
		req.onerror = () => resolve(null);
	});
}

export async function setOfflineImage(uuid, blob) {
	const db = await getDB();
	const entry = createCachedRecord(uuid, { blob }, { cachedAt: Date.now() });
	if (!db) {
		memoryStores.offlineImages.set(uuid, entry);
		offlineImageCacheStore.pruneMemoryStore(memoryStores.offlineImages);
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('offlineImages', 'readwrite');
		const store = tx.objectStore('offlineImages');
		
		store.put(entry, uuid);
		
		const items = [];
		const req = store.openCursor();
		req.onsuccess = (event) => {
			const cursor = event.target.result;
			if (cursor) {
				items.push({ key: cursor.key, value: cursor.value });
				cursor.continue();
			} else {
				const remaining = [];
				for (const item of items) {
					const val = item.value;
					remaining.push({ key: item.key, cachedAt: val?.cachedAt || 0 });
				}
				
				if (remaining.length > offlineImageCacheStore.maxEntries) {
					remaining.sort((a, b) => a.cachedAt - b.cachedAt);
					const deleteCount = remaining.length - offlineImageCacheStore.maxEntries;
					for (let i = 0; i < deleteCount; i++) {
						store.delete(remaining[i].key);
					}
				}
			}
		};
		
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function deleteOfflineImage(uuid) {
	const db = await getDB();
	if (!db) {
		memoryStores.offlineImages.delete(uuid);
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('offlineImages', 'readwrite');
		const store = tx.objectStore('offlineImages');
		const req = store.delete(uuid);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

// ── One-time LocalStorage Migration ─────────────────────────────────────────
let migrationRan = false;
export async function migrateFromLocalStorage() {
	if (typeof window === 'undefined' || typeof localStorage === 'undefined' || migrationRan) {
		return;
	}
	const db = await getDB();
	if (!db) return;

	migrationRan = true;
	console.log('[IndexedDB] Starting localStorage migration check...');

	// Migrate current profile uuid
	const currentUuid = localStorage.getItem('love4dogs.current-profile-uuid');
	if (currentUuid) {
		await setSetting('love4dogs.current-profile-uuid', currentUuid);
		localStorage.removeItem('love4dogs.current-profile-uuid');
	}

	// Migrate about visited
	const aboutVisited = localStorage.getItem('love4dogs.about-page-visited-at');
	if (aboutVisited) {
		await setSetting('love4dogs.about-page-visited-at', aboutVisited);
		localStorage.removeItem('love4dogs.about-page-visited-at');
	}

	// Migrate other settings keys
	const settingsKeys = [
		'love4dogs.settings.favorite-search-terms-v1',
		'love4dogs.settings.default-search-term-v1',
		'love4dogs.search-term-v1',
		'love4dogs.location-cache',
		'love4dogs.reverse-geo-cache',
		'love4dogs.my-post-uris',
		'love4dogs.authorid',
		'love4dogs.map-approx-posts-cache'
	];

	for (const key of settingsKeys) {
		const val = localStorage.getItem(key);
		if (val !== null) {
			try {
				await setSetting(key, JSON.parse(val));
			} catch {
				await setSetting(key, val);
			}
			localStorage.removeItem(key);
		}
	}

	// Migrate profiles
	const keysToMigrate = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key && key.startsWith('love4dogs.profile-v2.')) {
			keysToMigrate.push(key);
		}
	}

	for (const key of keysToMigrate) {
		const uuid = key.replace('love4dogs.profile-v2.', '');
		const val = localStorage.getItem(key);
		if (val) {
			try {
				const parsed = JSON.parse(val);
				await setProfile(uuid, parsed);
				console.log(`[IndexedDB] Migrated profile draft: ${uuid}`);
			} catch (e) {
				console.error('Failed to parse legacy profile:', e);
			}
			localStorage.removeItem(key);
		}
	}

	// Migrate profile registry summaries list
	const registryVal = localStorage.getItem('love4dogs.profile-registry-v1');
	if (registryVal) {
		try {
			await setSetting('love4dogs.profile-registry-v1', JSON.parse(registryVal));
		} catch {}
		localStorage.removeItem('love4dogs.profile-registry-v1');
	}

	console.log('[IndexedDB] localStorage migration check complete.');
}

// Automatically trigger migration if in browser
if (typeof window !== 'undefined') {
	migrateFromLocalStorage().catch((err) => {
		console.error('Migration failed:', err);
	});
}

export async function getAllPostKeys() {
	const db = await getDB();
	if (!db) {
		return Array.from(memoryStores.posts.keys());
	}
	return new Promise((resolve) => {
		const tx = db.transaction('posts', 'readonly');
		const store = tx.objectStore('posts');
		const req = store.getAllKeys();
		req.onsuccess = () => resolve(req.result || []);
		req.onerror = () => resolve([]);
	});
}

export async function clearAllPosts() {
	const db = await getDB();
	if (!db) {
		memoryStores.posts.clear();
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('posts', 'readwrite');
		const store = tx.objectStore('posts');
		const req = store.clear();
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

