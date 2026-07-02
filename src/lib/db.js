const DB_NAME = 'love4dogs_db';
const DB_VERSION = 1;

let dbPromise = null;

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
	const PROFILE_VIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
	if (!db) {
		const profile = memoryStores.profiles.get(uuid) || null;
		if (profile && profile.cachedAt && profile.data && Date.now() - profile.cachedAt > PROFILE_VIEW_CACHE_TTL_MS) {
			memoryStores.profiles.delete(uuid);
			return null;
		}
		return profile;
	}
	return new Promise((resolve) => {
		const tx = db.transaction('profiles', 'readonly');
		const store = tx.objectStore('profiles');
		const req = store.get(uuid);
		req.onsuccess = () => {
			const profile = req.result || null;
			if (profile && profile.cachedAt && profile.data && Date.now() - profile.cachedAt > PROFILE_VIEW_CACHE_TTL_MS) {
				deleteProfile(uuid).catch(() => {});
				resolve(null);
			} else {
				resolve(profile);
			}
		};
		req.onerror = () => resolve(null);
	});
}

export async function setProfile(uuid, data) {
	const db = await getDB();
	const unwrapped = unwrap(data);
	if (!db) {
		memoryStores.profiles.set(uuid, unwrapped);
		const now = Date.now();
		const PROFILE_VIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
		const remaining = [];
		for (const [key, val] of memoryStores.profiles.entries()) {
			if (val && val.cachedAt && val.data && now - val.cachedAt > PROFILE_VIEW_CACHE_TTL_MS) {
				memoryStores.profiles.delete(key);
			} else if (val && val.cachedAt && val.data) {
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
				const now = Date.now();
				const PROFILE_VIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
				const toDelete = [];
				const remaining = [];
				
				for (const item of items) {
					const val = item.value;
					if (val && val.cachedAt && val.data) {
						if (now - val.cachedAt > PROFILE_VIEW_CACHE_TTL_MS) {
							toDelete.push(item.key);
						} else {
							remaining.push(item);
						}
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
	const PROFILE_VIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
	if (!db) {
		const now = Date.now();
		const results = [];
		for (const [key, profile] of memoryStores.profiles.entries()) {
			if (profile && profile.cachedAt && profile.data && now - profile.cachedAt > PROFILE_VIEW_CACHE_TTL_MS) {
				memoryStores.profiles.delete(key);
			} else {
				results.push(profile);
			}
		}
		return results;
	}
	return new Promise((resolve) => {
		const tx = db.transaction('profiles', 'readonly');
		const store = tx.objectStore('profiles');
		const keysReq = store.getAllKeys();
		const valsReq = store.getAll();

		tx.oncomplete = () => {
			const keys = keysReq.result || [];
			const vals = valsReq.result || [];
			const now = Date.now();
			const valid = [];
			const expiredKeys = [];
			for (let i = 0; i < vals.length; i++) {
				const profile = vals[i];
				const key = keys[i];
				if (profile && profile.cachedAt && profile.data && now - profile.cachedAt > PROFILE_VIEW_CACHE_TTL_MS) {
					expiredKeys.push(key);
				} else {
					valid.push(profile);
				}
			}
			if (expiredKeys.length > 0) {
				const writeTx = db.transaction('profiles', 'readwrite');
				const writeStore = writeTx.objectStore('profiles');
				for (const key of expiredKeys) {
					writeStore.delete(key);
				}
			}
			resolve(valid);
		};
		tx.onerror = () => resolve([]);
	});
}

// ── Posts store helpers ─────────────────────────────────────────────────────
export async function getPost(uri) {
	const db = await getDB();
	if (!db) {
		const post = memoryStores.posts.get(uri) || null;
		if (post && post.cachedAt && Date.now() - post.cachedAt > 7 * 24 * 60 * 60 * 1000) {
			memoryStores.posts.delete(uri);
			return null;
		}
		return post;
	}
	return new Promise((resolve) => {
		const tx = db.transaction('posts', 'readonly');
		const store = tx.objectStore('posts');
		const req = store.get(uri);
		req.onsuccess = () => {
			const post = req.result || null;
			if (post && post.cachedAt && Date.now() - post.cachedAt > 7 * 24 * 60 * 60 * 1000) {
				deletePost(uri).catch(() => {});
				resolve(null);
			} else {
				resolve(post);
			}
		};
		req.onerror = () => resolve(null);
	});
}

export async function setPost(uri, data) {
	const db = await getDB();
	const unwrapped = unwrap(data);
	if (typeof unwrapped === 'object' && unwrapped !== null) {
		unwrapped.cachedAt = unwrapped._testCachedAt || Date.now();
	}
	if (!db) {
		memoryStores.posts.set(uri, unwrapped);
		// Prune memory store
		const now = Date.now();
		const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
		const remaining = [];
		for (const [key, val] of memoryStores.posts.entries()) {
			const cachedAt = val?.cachedAt || 0;
			if (now - cachedAt > sevenDaysMs) {
				memoryStores.posts.delete(key);
			} else {
				remaining.push({ key, val });
			}
		}
		if (remaining.length > 100) {
			remaining.sort((a, b) => (a.val?.cachedAt || 0) - (b.val?.cachedAt || 0));
			const toDeleteCount = remaining.length - 100;
			for (let i = 0; i < toDeleteCount; i++) {
				memoryStores.posts.delete(remaining[i].key);
			}
		}
		return;
	}
	return new Promise((resolve, reject) => {
		const tx = db.transaction('posts', 'readwrite');
		const store = tx.objectStore('posts');
		
		// Put the new post
		store.put(unwrapped, uri);
		
		// Read and prune in the same transaction
		const items = [];
		const req = store.openCursor();
		req.onsuccess = (event) => {
			const cursor = event.target.result;
			if (cursor) {
				items.push({ key: cursor.key, value: cursor.value });
				cursor.continue();
			} else {
				const now = Date.now();
				const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
				const toDelete = [];
				const remaining = [];
				
				for (const item of items) {
					const cachedAt = item.value?.cachedAt || 0;
					if (now - cachedAt > sevenDaysMs) {
						toDelete.push(item.key);
					} else {
						remaining.push(item);
					}
				}
				
				if (remaining.length > 100) {
					remaining.sort((a, b) => (a.value?.cachedAt || 0) - (b.value?.cachedAt || 0));
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
		const now = Date.now();
		const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
		const results = [];
		for (const [key, post] of memoryStores.posts.entries()) {
			if (post && post.cachedAt && now - post.cachedAt > sevenDaysMs) {
				memoryStores.posts.delete(key);
			} else {
				results.push(post);
			}
		}
		return results;
	}
	return new Promise((resolve) => {
		const tx = db.transaction('posts', 'readonly');
		const store = tx.objectStore('posts');
		const req = store.getAll();
		req.onsuccess = () => {
			const posts = req.result || [];
			const now = Date.now();
			const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
			const valid = [];
			const expiredKeys = [];
			for (const post of posts) {
				if (post && post.cachedAt && now - post.cachedAt > sevenDaysMs) {
					const key = post.uri || post.displayKey;
					if (key) expiredKeys.push(key);
				} else {
					valid.push(post);
				}
			}
			if (expiredKeys.length > 0) {
				const writeTx = db.transaction('posts', 'readwrite');
				const writeStore = writeTx.objectStore('posts');
				for (const key of expiredKeys) {
					writeStore.delete(key);
				}
			}
			resolve(valid);
		};
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
	const unwrapped = unwrap(blob);
	const entry = { blob: unwrapped, cachedAt: Date.now() };
	if (!db) {
		memoryStores.offlineImages.set(uuid, entry);
		const remaining = [];
		for (const [key, val] of memoryStores.offlineImages.entries()) {
			remaining.push({ key, cachedAt: val?.cachedAt || 0 });
		}
		if (remaining.length > 200) {
			remaining.sort((a, b) => a.cachedAt - b.cachedAt);
			const toDeleteCount = remaining.length - 200;
			for (let i = 0; i < toDeleteCount; i++) {
				memoryStores.offlineImages.delete(remaining[i].key);
			}
		}
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
				
				if (remaining.length > 200) {
					remaining.sort((a, b) => a.cachedAt - b.cachedAt);
					const deleteCount = remaining.length - 200;
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

