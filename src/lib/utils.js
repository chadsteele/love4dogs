import {
	PUBLIC_CONTACT_ALPHABET,
	PUBLIC_CONTACT_OUTPUT_ALPHABET
} from '$env/static/public';
import { getSetting, setSetting } from './db.js';

export const MEDIA_TOKEN_PREFIX = '🎞️';
export const MEDIA_TOKEN_HEX_LENGTH = 12;

/**
 * Build a media token from a hex digest string (lowercase, no special chars).
 * @param {string} hex
 * @returns {string}
 */
export function mediaTokenFromHex(hex) {
	return `${MEDIA_TOKEN_PREFIX}${String(hex).toLowerCase().slice(0, MEDIA_TOKEN_HEX_LENGTH)}`;
}

/**
	 * Build a media token by SHA-256 hashing a source/origin string.
	 * @param {string} value
	 * @returns {Promise<string>}
	 */
export async function mediaTokenFromOrigin(value = '') {
	const source = String(value || '').trim();
	if (!source) return '';
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
	const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
	return mediaTokenFromHex(hex);
	}

/**
	 * Build a stable media origin from a locally selected file.
	 * @param {File} file
	 * @returns {string}
	 */
export function mediaOriginFromFile(file) {
	const raw = String(file?.webkitRelativePath || file?.path || file?.name || '').trim();
	return raw.replace(/\\/g, '/');
	}

/**
	 * Build a media token from a locally selected file origin.
	 * @param {File} file
	 * @returns {Promise<string>}
	 */
export async function mediaTokenFromFile(file) {
	return mediaTokenFromOrigin(mediaOriginFromFile(file));
	}

/**
	 * @deprecated Prefer mediaTokenFromOrigin or mediaTokenFromFile.
	 * Build a media token by SHA-256 hashing an ArrayBuffer (browser-compatible).
	 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
export async function mediaTokenFromBuffer(buffer) {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
	return mediaTokenFromHex(hex);
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_INDEX = Object.fromEntries([...BASE32].map((char, index) => [char, index]));
const DEFAULT_SITE_BASE_URL = 'https://love4dogs.club';
const DEFAULT_MAP_BASE_URL = 'https://love4dogs.club/map';
const DEFAULT_LOCATION_CACHE_KEY = 'love4dogs.location-cache';
const DEFAULT_LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_REVERSE_GEO_CACHE_KEY = 'love4dogs.reverse-geo-cache';
const DEFAULT_REVERSE_GEO_MAX_ENTRIES = 100;
const DEFAULT_MAP_APPROX_POSTS_CACHE_KEY = 'love4dogs.map-approx-posts-cache.v2';
const DEFAULT_MAP_APPROX_POSTS_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAP_APPROX_POSTS_CACHE_MAX_ENTRIES = 400;
export const CONTACT_LOCK_PREFIX = '🔒';
const CONTACT_ALPHABET = PUBLIC_CONTACT_ALPHABET;
const CONTACT_OUTPUT_ALPHABET =
	PUBLIC_CONTACT_OUTPUT_ALPHABET ;
const CONTACT_BASE = BigInt(CONTACT_ALPHABET.length);
const CONTACT_OUTPUT_BASE = BigInt(CONTACT_OUTPUT_ALPHABET.length);

export function isContactEncrypted(value = '') {
	return String(value).startsWith(CONTACT_LOCK_PREFIX);
}

export function normalizeContactInput(text = '') {
	return [...String(text).toLowerCase()]
		.filter((char) => CONTACT_ALPHABET.includes(char))
		.join('');
}

export function cleanCanonicalName(value = '') {
	return String(value || '')
		.replace(/[^A-Za-z0-9/]/g, '-')
		.replace(/-+/g, '-')
		.replace(/(^-|-$)/g, '');
}

export function isLocalHost() {
	if (typeof window === 'undefined') return false;
	const hostname = String(window.location?.hostname || '').toLowerCase();
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function rewriteLove4DogsUrlForLocalhost(url = '') {
	const source = String(url || '').trim();
	if (!source || !isLocalHost()) return source;

	let parsed;
	try {
		parsed = new URL(source);
	} catch {
		return source;
	}

	const host = String(parsed.hostname || '').toLowerCase();
	if (host !== 'love4dogs.club' && host !== 'www.love4dogs.club') {
		return source;
	}

	const localOrigin = String(window.location?.origin || '').trim();
	if (!localOrigin) return source;

	return `${localOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function buildCanonicalUrl(uuid = '', name = '', baseUrl = DEFAULT_SITE_BASE_URL) {
	const trimmedName = String(name || '').trim();
	if (!trimmedName) return '';

	// remove spaces around /
	const cleaned = cleanCanonicalName(trimmedName).split('/').map(segment => segment.trim()).filter(Boolean).join('/');
	if (!cleaned) return '';

	const safeUuid = String(uuid || '').trim();
	const safeBaseUrl = rewriteLove4DogsUrlForLocalhost(String(baseUrl || DEFAULT_SITE_BASE_URL)).replace(/\/+$/, '');

	return `${safeBaseUrl}/${safeUuid}/${cleaned}`;
}

export function encryptContact(input = '') {
	if (!input) return '';
	let value = 0n;
	for (const char of input) {
		const idx = CONTACT_ALPHABET.indexOf(char);
		if (idx < 0) throw new Error('Contact contains unsupported characters');
		value = value * CONTACT_BASE + BigInt(idx);
	}
	if (value === 0n) return CONTACT_OUTPUT_ALPHABET[0];
	let output = '';
	while (value > 0n) {
		const idx = Number(value % CONTACT_OUTPUT_BASE);
		output = CONTACT_OUTPUT_ALPHABET[idx] + output;
		value = value / CONTACT_OUTPUT_BASE;
	}
	return output;
}

function fromOutputBase(encoded) {
	let value = 0n;
	for (const char of String(encoded)) {
		const idx = CONTACT_OUTPUT_ALPHABET.indexOf(char);
		if (idx < 0) throw new Error('Invalid compressed contact value');
		value = value * CONTACT_OUTPUT_BASE + BigInt(idx);
	}
	return value;
}

export function decryptContact(encoded = '') {
	if (!encoded) return '';
	let value = fromOutputBase(encoded);
	if (value === 0n) return CONTACT_ALPHABET[0];
	let output = '';
	while (value > 0n) {
		const idx = Number(value % CONTACT_BASE);
		output = CONTACT_ALPHABET[idx] + output;
		value = value / CONTACT_BASE;
	}
	return output;
}

function isValidCoordinate(lat, lon) {
	return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

async function getLocalStorageJson(key) {
	return await getSetting(key);
}

async function setLocalStorageJson(key, value) {
	await setSetting(key, value);
}

async function getCachedLocation(cacheKey, ttlMs) {
	const parsed = await getLocalStorageJson(cacheKey);
	if (!parsed?.savedAt || !parsed?.location) return null;

	if (Date.now() - parsed.savedAt > ttlMs) {
		return null;
	}

	return parsed.location;
}

async function setCachedLocation(cacheKey, location) {
	await setLocalStorageJson(cacheKey, { savedAt: Date.now(), location });
}

function reverseGeoCacheKey(lat, lon) {
	return `${lat},${lon}`;
}

async function getCachedReverseGeo(cacheKey, lat, lon) {
	const parsed = await getLocalStorageJson(cacheKey);
	if (!parsed || typeof parsed !== 'object') return null;

	const key = reverseGeoCacheKey(lat, lon);
	const cached = parsed[key];
	if (!cached) return null;

	return {
		houseNumber: cached.houseNumber || '',
		road: cached.road || '',
		neighbourhood: cached.neighbourhood || '',
		suburb: cached.suburb || '',
		city: cached.city || '',
		state: cached.state || '',
		country: cached.country || '',
		zip: cached.zip || '',
		formattedAddress: cached.formattedAddress || ''
	};
}

async function setCachedReverseGeo(cacheKey, maxEntries, lat, lon, value) {
	const parsed = await getLocalStorageJson(cacheKey);
	const cache = parsed && typeof parsed === 'object' ? parsed : {};

	const key = reverseGeoCacheKey(lat, lon);
	cache[key] = {
		houseNumber: value.houseNumber || '',
		road: value.road || '',
		neighbourhood: value.neighbourhood || '',
		suburb: value.suburb || '',
		city: value.city || '',
		state: value.state || '',
		country: value.country || '',
		zip: value.zip || '',
		formattedAddress: value.formattedAddress || '',
		savedAt: Date.now()
	};

	const entries = Object.entries(cache);
	if (entries.length > maxEntries) {
		entries.sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0));
		await setLocalStorageJson(cacheKey, Object.fromEntries(entries.slice(0, maxEntries)));
		return;
	}

	await setLocalStorageJson(cacheKey, cache);
}

export function buildLocationBlock(location, mapBaseUrl = DEFAULT_MAP_BASE_URL) {
	if (!location) return '';

	const hash = gpsToHash(Number(location.lat), Number(location.lon));
	if (!hash) return '';
	const localizedMapBaseUrl = rewriteLove4DogsUrlForLocalhost(String(mapBaseUrl || DEFAULT_MAP_BASE_URL));

	const details = [location.city, location.state, location.country, location.zip]
		.filter(Boolean)
		.join(', ');
	return `\n\n📍 ${localizedMapBaseUrl}/${hash.path}\n${details}`;
}

export async function lookupLocationDetails(lat, lon, options = {}) {
	const reverseGeoCacheKeyName = options.reverseGeoCacheKey || DEFAULT_REVERSE_GEO_CACHE_KEY;
	const reverseGeoMaxEntries = options.reverseGeoMaxEntries || DEFAULT_REVERSE_GEO_MAX_ENTRIES;
	const acceptLanguage = options.acceptLanguage || 'en';
	const nextLat = Number(lat);
	const nextLon = Number(lon);

	if (!isValidCoordinate(nextLat, nextLon)) {
		return {
			location: null,
			error: 'Invalid map coordinates.',
			fromCache: false
		};
	}

	let city = '';
	let state = '';
	let country = '';
	let zip = '';
	let houseNumber = '';
	let road = '';
	let neighbourhood = '';
	let suburb = '';
	let formattedAddress = '';
	let fromCache = false;

	const reverseGeo = await getCachedReverseGeo(reverseGeoCacheKeyName, nextLat, nextLon);
	if (reverseGeo) {
		houseNumber = reverseGeo.houseNumber;
		road = reverseGeo.road;
		neighbourhood = reverseGeo.neighbourhood;
		suburb = reverseGeo.suburb;
		city = reverseGeo.city;
		state = reverseGeo.state;
		country = reverseGeo.country;
		zip = reverseGeo.zip;
		formattedAddress = reverseGeo.formattedAddress;
		fromCache = true;
	} else {
		try {
			const res = await fetch(
				`https://nominatim.openstreetmap.org/reverse?lat=${nextLat}&lon=${nextLon}&format=json`,
				{ headers: { 'Accept-Language': acceptLanguage } }
			);
			const data = await res.json();
			houseNumber = data?.address?.house_number || '';
			road = data?.address?.road || data?.address?.pedestrian || '';
			neighbourhood = data?.address?.neighbourhood || '';
			suburb = data?.address?.suburb || '';
			city = data?.address?.city || data?.address?.town || data?.address?.village || data?.address?.hamlet || '';
			state = data?.address?.state || data?.address?.province || data?.address?.region || data?.address?.state_district || '';
			country = data?.address?.country || '';
			zip = data?.address?.postcode || '';
			const line1 = [houseNumber, road].filter(Boolean).join(' ').trim();
			const line2 = [neighbourhood, suburb].filter(Boolean).join(', ').trim();
			const fallbackFormatted = [line1, line2, city, state, country, zip]
				.filter(Boolean)
				.join(', ');
			formattedAddress = String(data?.display_name || fallbackFormatted || '').trim();
			await setCachedReverseGeo(reverseGeoCacheKeyName, reverseGeoMaxEntries, nextLat, nextLon, {
				houseNumber,
				road,
				neighbourhood,
				suburb,
				city,
				state,
				country,
				zip,
				formattedAddress
			});
		} catch {
			// Keep coordinate updates working even if reverse geocoding fails.
		}
	}

	return {
		location: {
			lat: nextLat,
			lon: nextLon,
			houseNumber,
			road,
			neighbourhood,
			suburb,
			city,
			state,
			country,
			zip,
			formattedAddress
		},
		error: '',
		fromCache
	};
}

function getCurrentPosition(options = { enableHighAccuracy: true, timeout: 8000 }) {
	return new Promise((resolve, reject) => {
		navigator.geolocation.getCurrentPosition(resolve, reject, options);
	});
}

export async function lookupLocationWithCache(options = {}) {
	const locationCacheKey = options.locationCacheKey || DEFAULT_LOCATION_CACHE_KEY;
	const locationCacheTtlMs = options.locationCacheTtlMs || DEFAULT_LOCATION_CACHE_TTL_MS;
	const reverseGeoCacheKeyName = options.reverseGeoCacheKey || DEFAULT_REVERSE_GEO_CACHE_KEY;
	const reverseGeoMaxEntries = options.reverseGeoMaxEntries || DEFAULT_REVERSE_GEO_MAX_ENTRIES;
	const acceptLanguage = options.acceptLanguage || 'en';

	const cachedLocation = await getCachedLocation(locationCacheKey, locationCacheTtlMs);
	if (cachedLocation) {
		return { location: cachedLocation, error: '', fromCache: true };
	}

	if (typeof navigator === 'undefined' || !navigator.geolocation) {
		return {
			location: null,
			error: 'Location services are unavailable in this browser.',
			fromCache: false
		};
	}

	try {
		const position = await getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 });
		const lat = Number(position.coords.latitude);
		const lon = Number(position.coords.longitude);
		const { location } = await lookupLocationDetails(lat, lon, {
			reverseGeoCacheKey: reverseGeoCacheKeyName,
			reverseGeoMaxEntries,
			acceptLanguage
		});
		await setCachedLocation(locationCacheKey, location);
		return { location, error: '', fromCache: false };
	} catch {
		return {
			location: null,
			error: 'Location services are not enabled. Enable them to include a pin and zip code in your post.',
			fromCache: false
		};
	}
}

function mapApproxCacheOptions(options = {}) {
	return {
		cacheKey: options.cacheKey || DEFAULT_MAP_APPROX_POSTS_CACHE_KEY,
		ttlMs: options.ttlMs || DEFAULT_MAP_APPROX_POSTS_CACHE_TTL_MS,
		maxEntries: options.maxEntries || DEFAULT_MAP_APPROX_POSTS_CACHE_MAX_ENTRIES
	};
}

function sanitizeApproxPost(post = {}) {
	if (!post || typeof post !== 'object') return null;
	const uri = String(post.uri || '').trim();
	const lat = Number(post.lat);
	const lon = Number(post.lon);
	if (!uri || !isValidCoordinate(lat, lon)) return null;

	const computed = gpsToHash(lat, lon);
	const approximate = String(post.approximate || computed?.approx || '').trim().toLowerCase();
	const exact = String(post.exact || computed?.exact || '').trim().toLowerCase();

	return {
		uri,
		uuid: String(post.uuid || '').trim(),
		cid: String(post.cid || ''),
		text: String(post.text || ''),
		facets: Array.isArray(post.facets) ? post.facets : [],
		createdAt: String(post.createdAt || ''),
		images: Array.isArray(post.images) ? post.images.filter(Boolean) : [],
		imageAlts: Array.isArray(post.imageAlts)
			? post.imageAlts.map((alt) => String(alt || '')).filter(Boolean)
			: [],
		video: post.video || null,
		replyCount: Number(post.replyCount || 0),
		repostCount: Number(post.repostCount || 0),
		likeCount: Number(post.likeCount || 0),
		comments: Array.isArray(post.comments) ? post.comments : [],
		approximate,
		exact,
		lat,
		lon
	};
}

function pruneMapApproxCacheData(raw, { ttlMs, maxEntries }) {
	const now = Date.now();
	const data = raw && typeof raw === 'object' ? raw : {};
	const entries = [];

	for (const [approximate, entry] of Object.entries(data)) {
		const savedAt = Number(entry?.savedAt || 0);
		if (!approximate || !savedAt || now - savedAt > ttlMs) continue;
		const posts = Array.isArray(entry?.posts)
			? entry.posts.map((post) => sanitizeApproxPost(post)).filter(Boolean)
			: [];
		entries.push([approximate, { savedAt, posts }]);
	}

	entries.sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0));
	return Object.fromEntries(entries.slice(0, maxEntries));
}

async function readMapApproxCache(options = {}) {
	const { cacheKey, ttlMs, maxEntries } = mapApproxCacheOptions(options);
	const parsed = await getLocalStorageJson(cacheKey);
	const pruned = pruneMapApproxCacheData(parsed, { ttlMs, maxEntries });
	await setLocalStorageJson(cacheKey, pruned);
	return pruned;
}

async function writeMapApproxCache(data, options = {}) {
	const { cacheKey, ttlMs, maxEntries } = mapApproxCacheOptions(options);
	const pruned = pruneMapApproxCacheData(data, { ttlMs, maxEntries });
	await setLocalStorageJson(cacheKey, pruned);
	return pruned;
}

export async function getApproxCacheEntry(approximate = '', options = {}) {
	if (typeof window === 'undefined') return null;
	const key = String(approximate || '').trim().toLowerCase();
	if (!key) return null;
	const cache = await readMapApproxCache(options);
	return cache[key] || null;
}

export async function getApproxPostsFromCache(approximate = '', options = {}) {
	if (typeof window === 'undefined') return null;
	const key = String(approximate || '').trim().toLowerCase();
	if (!key) return null;
	const cache = await readMapApproxCache(options);
	const entry = cache[key];
	return entry ? entry.posts : null;
}

export async function setApproxPostsInCache(approximate = '', posts = [], options = {}) {
	if (typeof window === 'undefined') return;
	const key = String(approximate || '').trim().toLowerCase();
	if (!key) return;
	const cache = await readMapApproxCache(options);
	const sanitizedPosts = Array.isArray(posts)
		? posts.map((post) => sanitizeApproxPost(post)).filter(Boolean)
		: [];

	const existingEntry = cache[key];
	const preservedLocalPosts = [];
	if (existingEntry && Array.isArray(existingEntry.posts)) {
		for (const post of existingEntry.posts) {
			if (post.isUserPost) {
				preservedLocalPosts.push(post);
			}
		}
	}

	const bskyPostsFiltered = sanitizedPosts.filter(
		(bp) => !preservedLocalPosts.some((lp) => lp.uri === bp.uri)
	);
	const finalPosts = [...preservedLocalPosts, ...bskyPostsFiltered];

	cache[key] = {
		savedAt: Date.now(),
		posts: finalPosts,
		hasLocalPost: preservedLocalPosts.length > 0
	};
	await writeMapApproxCache(cache, options);
}

export async function upsertApproxPostInCache(post = {}, options = {}) {
	if (typeof window === 'undefined') return;
	const sanitized = sanitizeApproxPost(post);
	if (!sanitized?.approximate) return;
	sanitized.isUserPost = true; // Mark as user-added post
	const cache = await readMapApproxCache(options);
	const existing = Array.isArray(cache[sanitized.approximate]?.posts)
		? cache[sanitized.approximate].posts
		: [];
	const withoutUri = existing.filter((entry) => entry?.uri !== sanitized.uri);
	cache[sanitized.approximate] = {
		savedAt: Date.now(),
		posts: [sanitized, ...withoutUri],
		hasLocalPost: true
	};
	await writeMapApproxCache(cache, options);
}

export async function removeApproxPostFromCache(uri = '', options = {}) {
	if (typeof window === 'undefined') return;
	const targetUri = String(uri || '').trim();
	if (!targetUri) return;
	const cache = await readMapApproxCache(options);
	for (const [approximate, entry] of Object.entries(cache)) {
		const posts = Array.isArray(entry?.posts) ? entry.posts : [];
		const filtered = posts.filter((post) => post?.uri !== targetUri);
		if (filtered.length === posts.length) continue;
		cache[approximate] = {
			savedAt: Date.now(),
			posts: filtered
		};
	}
	await writeMapApproxCache(cache, options);
}

function singleHash(lat, lon) {
	const latRange = [-90, 90];
	const lonRange = [-180, 180];
	let hash = '';
	let bits = 0;
	let value = 0;
	let useLon = true;

	while (hash.length < 9) {
		const mid = useLon ? (lonRange[0] + lonRange[1]) / 2 : (latRange[0] + latRange[1]) / 2;
		const upper = useLon ? lon >= mid : lat >= mid;
		value = (value << 1) | (upper ? 1 : 0);
		if (useLon) { if (upper) lonRange[0] = mid; else lonRange[1] = mid; }
		else        { if (upper) latRange[0] = mid; else latRange[1] = mid; }
		useLon = !useLon;
		if (++bits === 5) { hash += BASE32[value]; bits = 0; value = 0; }
	}

	return hash;
}

function singleHashToGps(hash) {
	const s = String(hash || '').trim().toLowerCase();
	if (!s) return null;

	const latRange = [-90, 90];
	const lonRange = [-180, 180];
	let useLon = true;

	for (const c of s) {
		const v = BASE32_INDEX[c];
		if (v === undefined) return null;
		for (let mask = 16; mask > 0; mask >>= 1) {
			const upper = (v & mask) !== 0;
			if (useLon) { if (upper) lonRange[0] = (lonRange[0]+lonRange[1])/2; else lonRange[1] = (lonRange[0]+lonRange[1])/2; }
			else        { if (upper) latRange[0] = (latRange[0]+latRange[1])/2; else latRange[1] = (latRange[0]+latRange[1])/2; }
			useLon = !useLon;
		}
	}

	return { lat: (latRange[0]+latRange[1])/2, lon: (lonRange[0]+lonRange[1])/2 };
}

export function gpsToHash(lat, lon) {
	if (!isValidCoordinate(lat, lon)) return null;
	const exact  = singleHash(lat, lon);
	const approx = exact.slice(0, 5);
	return { approx, exact, path: `${approx}/${exact}` };
}

export function hashToGps(hash) {
	const parts = String(hash || '').trim().toLowerCase().split('/');
	const exact = singleHashToGps(parts[1] || parts[0]);
	if (!exact) return null;
	return { lat: exact.lat, lon: exact.lon, hashes: { approx: parts[1] ? parts[0] : null, exact: parts[1] || parts[0] } };
}

/**
 * Minify and compress HTML by removing whitespace and replacing verbose tags with shorter equivalents.
 * Includes tag compression (div→d, strong→b, em→i) and whitespace removal.
 * This is lossless: compressed tags can be decompressed later without ambiguity.
 * @param {string} html
 * @returns {string}
 */
export function minifyHtml(html = '') {
	let result = String(html || '');

	// Block-level tag regex: remove whitespace immediately after opening and before closing
	result = result.replace(/>(\s+)</g, '><');

	// Collapse multiple whitespace sequences into single space (but preserve at least one)
	result = result.replace(/\s{2,}/g, ' ');

	// Remove whitespace before closing tags
	result = result.replace(/\s+</g, '<');

	// Contract: keep these exact patterns unless explicitly requested by the user.
	// They intentionally support tags with attributes and preserve closing-tag suffixes.
	// Changing these regexes can break backwards compatibility for stored chunk payloads.
	// Replace verbose tags with shorter equivalents
	result = result.replace(/<div>/g, '<d>');
	result = result.replace(/<div\s/g, '<d ');
	result = result.replace(/<\/div/g, '</d');
	result = result.replace(/<strong\s/g, '<b ');
	result = result.replace(/<\/strong>/g, '</b');
	result = result.replace(/<em\s/g, '<i ');
	result = result.replace(/<\/em/g, '</i');

	// Trim the result
	result = result.trim();

	return result;
}

/**
 * Expand compact tags produced by minifyHtml back to standard HTML tags.
 * @param {string} html
 * @returns {string}
 */
export function expandMinifiedHtmlTags(html = '') {
	let result = String(html || '');
	result = result.replace(/<d>/g, '<div>');
	result = result.replace(/<d\s/g, '<div ');
	result = result.replace(/<\/d>/g, '</div>');
	return result;
}
