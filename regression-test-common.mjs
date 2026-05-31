// Tag pool for regression tests
export const REGRESSION_TAG_POOL = [
	'wanted', 'offered', 'volunteer', 'event', 'lost', 'found', 'urgent', 'help', 'meetup',  'rescue', 'supplies', 'transportation', 'medical', 'training',
];

// Returns a new array with n unique random elements from arr
export function pickNUniqueRandom(arr, n) {
	const copy = arr.slice();
	const result = [];
	for (let i = 0; i < n && copy.length > 0; i++) {
		const idx = Math.floor(Math.random() * copy.length);
		result.push(copy.splice(idx, 1)[0]);
	}
	return result;
}
export function parseArgs(argv = process.argv.slice(2)) {
	const args = {};
	for (const arg of argv) {
		const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
		if (match) args[match[1]] = match[2] ?? true;
	}
	return args;
}

export function resolveTestConfig(args = {}) {
	return {
		baseUrl: args.server || process.env.TEST_SERVER_URL || 'http://localhost:5173',
		author: args.author || process.env.BSKY_AUTHOR || 'love4dogs.club',
		indexWaitMs: Number(args.wait || process.env.TEST_INDEX_WAIT_MS || 15000),
	};
}

export function createAssertions() {
	let passed = 0;
	let failed = 0;

	function pass(label) {
		console.log(`  [PASS] ${label}`);
		passed += 1;
	}

	function fail(label, detail = '') {
		console.error(`  [FAIL] ${label}${detail ? ': ' + detail : ''}`);
		failed += 1;
	}

	function assert(condition, label, detail = '') {
		if (condition) {
			pass(label);
		} else {
			fail(label, detail);
		}
	}

	function assertEqual(actual, expected, label) {
		if (actual === expected) {
			pass(label);
		} else {
			fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		}
	}

	function counts() {
		return { passed, failed, total: passed + failed };
	}

	return { pass, fail, assert, assertEqual, counts };
}

export function generateUuid(length = 12) {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i += 1) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result;
}

export async function fetchRandomDogImageUrl(fetchImpl = fetch) {
	const res = await fetchImpl('https://dog.ceo/api/breeds/image/random');
	if (!res.ok) throw new Error(`dog.ceo API returned ${res.status}`);
	const json = await res.json();
	if (json.status !== 'success' || !json.message) {
		throw new Error(`dog.ceo API bad response: ${JSON.stringify(json)}`);
	}
	return String(json.message);
}

export async function fetchMultipleDogImages(count, fetchImpl = fetch) {
	const urls = [];
	for (let i = 0; i < count; i += 1) {
		urls.push(await fetchRandomDogImageUrl(fetchImpl));
	}
	return urls;
}

export async function uploadDogImageToBluesky({ baseUrl, imageUrl, fetchImpl = fetch }) {
	const imgRes = await fetchImpl(imageUrl, { method: 'GET' });
	if (!imgRes.ok) {
		throw new Error(`Failed to download dog image: ${imgRes.status} ${imageUrl}`);
	}
	const imgBytes = await imgRes.arrayBuffer();
	const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

	const formData = new FormData();
	formData.append('mode', 'upload-media');
	formData.append('file', new Blob([imgBytes], { type: contentType }), 'dog.jpg');

	const res = await fetchImpl(`${baseUrl}/api/post`, { method: 'POST', body: formData });
	const json = await res.json().catch(() => ({}));
	if (!res.ok || !json.ok) {
		throw new Error(`Upload failed (${res.status}): ${json.error || 'unknown error'}`);
	}

	return {
		kind: 'image',
		alt: 'A dog photo',
		blob: json.blob,
		url: json.url,
		did: json.did,
		sourceUrl: imageUrl,
	};
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegex(value = '') {
	return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findLocationLeakInText(text = '', location = {}) {
	const source = String(text || '');
	if (!source.trim()) return '';

	if (/📍/.test(source)) return 'contains map marker';

	const normalized = source.toLowerCase();
	const address = String(location?.address || '').trim();
	const formattedAddress = String(location?.formattedAddress || '').trim();
	const city = String(location?.city || '').trim();
	const zip = String(location?.zip || '').trim();

	if (address && normalized.includes(address.toLowerCase())) {
		return 'contains street address';
	}

	if (
		formattedAddress &&
		normalized.includes(formattedAddress.toLowerCase())
	) {
		return 'contains formatted address';
	}

	if (city) {
		const cityRegex = new RegExp(`\\b${escapeRegex(city)}\\b`, 'i');
		if (cityRegex.test(source)) return 'contains city';
	}

	if (zip) {
		const zipRegex = new RegExp(`\\b${escapeRegex(zip)}\\b`);
		if (zipRegex.test(source)) return 'contains zip';
	}

	return '';
}

const DENVER_METRO_CITIES = [
	{
		city: 'Denver',
		zips: ['80202', '80203', '80204', '80205', '80206', '80209', '80210'],
		latRange: [39.64, 39.79],
		lonRange: [-105.11, -104.88],
	},
	{
		city: 'Lakewood',
		zips: ['80214', '80215', '80226', '80227', '80228', '80232'],
		latRange: [39.66, 39.75],
		lonRange: [-105.17, -105.03],
	},
	{
		city: 'Aurora',
		zips: ['80010', '80011', '80012', '80013', '80014', '80015', '80017'],
		latRange: [39.66, 39.77],
		lonRange: [-104.89, -104.70],
	},
	{
		city: 'Arvada',
		zips: ['80002', '80003', '80004', '80005', '80007'],
		latRange: [39.78, 39.87],
		lonRange: [-105.16, -105.04],
	},
	{
		city: 'Westminster',
		zips: ['80020', '80021', '80023', '80234', '80260'],
		latRange: [39.83, 39.92],
		lonRange: [-105.09, -104.95],
	},
	{
		city: 'Littleton',
		zips: ['80120', '80121', '80122', '80123', '80127', '80128'],
		latRange: [39.56, 39.64],
		lonRange: [-105.10, -104.93],
	},
];

const STREET_NAMES = [
	'Aspen',
	'Pine',
	'Cedar',
	'Oak',
	'Maple',
	'Spruce',
	'Ridge',
	'Summit',
	'Meadow',
	'Canyon',
	'Creek',
	'Juniper',
];

const STREET_TYPES = ['St', 'Ave', 'Blvd', 'Rd', 'Ln', 'Way', 'Dr'];
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function pickRandom(items = []) {
	return items[Math.floor(Math.random() * items.length)];
}

function randomInRange([min, max] = [0, 1]) {
	return min + Math.random() * (max - min);
}

function singleHash(lat, lon) {
	const latRange = [-90, 90];
	const lonRange = [-180, 180];
	let hash = '';
	let bits = 0;
	let value = 0;
	let useLon = true;

	while (hash.length < 9) {
		const mid = useLon
			? (lonRange[0] + lonRange[1]) / 2
			: (latRange[0] + latRange[1]) / 2;
		const upper = useLon ? lon >= mid : lat >= mid;
		value = (value << 1) | (upper ? 1 : 0);

		if (useLon) {
			if (upper) lonRange[0] = mid;
			else lonRange[1] = mid;
		} else {
			if (upper) latRange[0] = mid;
			else latRange[1] = mid;
		}

		useLon = !useLon;
		if (++bits === 5) {
			hash += BASE32[value];
			bits = 0;
			value = 0;
		}
	}

	return hash;
}

function buildMapHashes(lat, lon) {
	const exact = singleHash(lat, lon);
	const approximate = exact.slice(0, 5);
	const path = `${approximate}/${exact}`;
	return { approximate, exact, path };
}

export function createRandomColoradoLocation() {
	const selectedCity = pickRandom(DENVER_METRO_CITIES);
	const houseNumber = String(100 + Math.floor(Math.random() * 9800));
	const streetName = pickRandom(STREET_NAMES);
	const streetType = pickRandom(STREET_TYPES);
	const zip = pickRandom(selectedCity.zips);
	const lat = Number(randomInRange(selectedCity.latRange).toFixed(6));
	const lon = Number(randomInRange(selectedCity.lonRange).toFixed(6));
	const hashes = buildMapHashes(lat, lon);

	const address = `${houseNumber} ${streetName} ${streetType}`;

	return {
		address,
		city: selectedCity.city,
		state: 'CO',
		zip,
		country: 'USA',
		lat,
		lon,
		approximate: hashes.approximate,
		exact: hashes.exact,
		hashPath: hashes.path,
		formattedAddress: `${address}, ${selectedCity.city}, CO, USA, ${zip}`,
	};
}
