import {
	PUBLIC_CONTACT_ALPHABET,
	PUBLIC_CONTACT_OUTPUT_ALPHABET
} from '$env/static/public';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_INDEX = Object.fromEntries([...BASE32].map((char, index) => [char, index]));
const DEFAULT_MAP_BASE_URL = 'https://love4dogs.club/map';
const DEFAULT_LOCATION_CACHE_KEY = 'love4dogs.location-cache';
const DEFAULT_LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_REVERSE_GEO_CACHE_KEY = 'love4dogs.reverse-geo-cache';
const DEFAULT_REVERSE_GEO_MAX_ENTRIES = 100;
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

function getLocalStorageJson(key) {
	if (typeof window === 'undefined') return null;

	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function setLocalStorageJson(key, value) {
	if (typeof window === 'undefined') return;

	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Ignore cache write failures (private mode/storage limits).
	}
}

function getCachedLocation(cacheKey, ttlMs) {
	const parsed = getLocalStorageJson(cacheKey);
	if (!parsed?.savedAt || !parsed?.location) return null;

	if (Date.now() - parsed.savedAt > ttlMs) {
		return null;
	}

	return parsed.location;
}

function setCachedLocation(cacheKey, location) {
	setLocalStorageJson(cacheKey, { savedAt: Date.now(), location });
}

function reverseGeoCacheKey(lat, lon) {
	return `${lat},${lon}`;
}

function getCachedReverseGeo(cacheKey, lat, lon) {
	const parsed = getLocalStorageJson(cacheKey);
	if (!parsed || typeof parsed !== 'object') return null;

	const key = reverseGeoCacheKey(lat, lon);
	const cached = parsed[key];
	if (!cached) return null;

	return {
		city: cached.city || '',
		country: cached.country || '',
		zip: cached.zip || ''
	};
}

function setCachedReverseGeo(cacheKey, maxEntries, lat, lon, value) {
	const parsed = getLocalStorageJson(cacheKey);
	const cache = parsed && typeof parsed === 'object' ? parsed : {};

	const key = reverseGeoCacheKey(lat, lon);
	cache[key] = {
		city: value.city || '',
		country: value.country || '',
		zip: value.zip || '',
		savedAt: Date.now()
	};

	const entries = Object.entries(cache);
	if (entries.length > maxEntries) {
		entries.sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0));
		setLocalStorageJson(cacheKey, Object.fromEntries(entries.slice(0, maxEntries)));
		return;
	}

	setLocalStorageJson(cacheKey, cache);
}

export function buildLocationBlock(location, mapBaseUrl = DEFAULT_MAP_BASE_URL) {
	if (!location) return '';

	const hash = gpsToHash(Number(location.lat), Number(location.lon));
	if (!hash) return '';

	const details = [location.city, location.country, location.zip].filter(Boolean).join(', ');
	return `\n\n📍 ${mapBaseUrl}/${hash.path}\n${details}`;
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
	let country = '';
	let zip = '';
	let fromCache = false;

	const reverseGeo = getCachedReverseGeo(reverseGeoCacheKeyName, nextLat, nextLon);
	if (reverseGeo) {
		city = reverseGeo.city;
		country = reverseGeo.country;
		zip = reverseGeo.zip;
		fromCache = true;
	} else {
		try {
			const res = await fetch(
				`https://nominatim.openstreetmap.org/reverse?lat=${nextLat}&lon=${nextLon}&format=json`,
				{ headers: { 'Accept-Language': acceptLanguage } }
			);
			const data = await res.json();
			city = data?.address?.city || data?.address?.town || data?.address?.village || data?.address?.hamlet || '';
			country = data?.address?.country || '';
			zip = data?.address?.postcode || '';
			setCachedReverseGeo(reverseGeoCacheKeyName, reverseGeoMaxEntries, nextLat, nextLon, { city, country, zip });
		} catch {
			// Keep coordinate updates working even if reverse geocoding fails.
		}
	}

	return {
		location: { lat: nextLat, lon: nextLon, city, country, zip },
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

	const cachedLocation = getCachedLocation(locationCacheKey, locationCacheTtlMs);
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
		setCachedLocation(locationCacheKey, location);
		return { location, error: '', fromCache: false };
	} catch {
		return {
			location: null,
			error: 'Location services are not enabled. Enable them to include a pin and zip code in your post.',
			fromCache: false
		};
	}
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
