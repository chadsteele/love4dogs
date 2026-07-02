import { build, files, version } from '$service-worker';

const CACHE_NAME = `love4dogs-cache-${version}`;
const ASSETS = [
	...build, // SvelteKit built client files
	...files, // Static files
	'/'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.addAll(ASSETS);
		}).then(() => {
			self.skipWaiting();
		})
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE_NAME) {
					await caches.delete(key);
				}
			}
			self.clients.claim();
		})
	);
});

// Helper to open IndexedDB in Service Worker context
function getOfflineImageFromDB(uuid) {
	return new Promise((resolve) => {
		// Use standard IndexedDB open inside Service Worker
		const request = indexedDB.open('love4dogs_db', 1);
		request.onsuccess = (event) => {
			const db = event.target.result;
			if (!db.objectStoreNames.contains('offlineImages')) {
				resolve(null);
				return;
			}
			try {
				const tx = db.transaction('offlineImages', 'readonly');
				const store = tx.objectStore('offlineImages');
				const req = store.get(uuid);
				req.onsuccess = () => {
					const res = req.result;
					resolve(res && res.blob ? res.blob : (res || null));
				};
				req.onerror = () => resolve(null);
			} catch (e) {
				resolve(null);
			}
		};
		request.onerror = () => resolve(null);
	});
}

self.addEventListener('fetch', (event) => {
	// Intercept GET requests only
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);

	// 1. Intercept offline media requests
	if (url.pathname.startsWith('/offline-media/')) {
		const uuid = url.pathname.split('/').pop();
		event.respondWith(
			getOfflineImageFromDB(uuid).then((blob) => {
				if (blob) {
					return new Response(blob, {
						headers: { 'content-type': blob.type || 'image/jpeg' }
					});
				}
				return new Response('Not found', { status: 404 });
			})
		);
		return;
	}

	// 2. Cache-first strategy for Bluesky CDN images
	if (url.hostname === 'cdn.bsky.app') {
		event.respondWith(
			caches.open('bluesky-image-cache').then((cache) => {
				return cache.match(event.request).then((cachedResponse) => {
					if (cachedResponse) {
						return cachedResponse;
					}
					return fetch(event.request).then((networkResponse) => {
						if (networkResponse.status === 200) {
							cache.put(event.request, networkResponse.clone());
						}
						return networkResponse;
					}).catch(() => {
						return new Response('Network error', { status: 408 });
					});
				});
			})
		);
		return;
	}

	// 3. Network-first, fallback to cache for HTML, CSS, JS, etc.
	event.respondWith(
		fetch(event.request).then((networkResponse) => {
			const isAsset = ASSETS.includes(url.pathname);
			if (networkResponse.status === 200 && isAsset) {
				const clone = networkResponse.clone();
				caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
			}
			return networkResponse;
		}).catch(() => {
			return caches.match(event.request).then((cachedResponse) => {
				if (cachedResponse) {
					return cachedResponse;
				}
				// If page navigation, return main page index
				if (event.request.mode === 'navigate') {
					return caches.match('/');
				}
				return new Response('Offline', { status: 503 });
			});
		})
	);
});
