import {readFile, writeFile} from 'node:fs/promises';

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

const REGRESSION_PROFILE_SEEDS_URL = new URL('./.regression-profile-seeds.json', import.meta.url);

export function resolveTestConfig(args = {}) {
	return {
		baseUrl: args.server || process.env.TEST_SERVER_URL || 'http://localhost:5173',
		author: args.author || process.env.BSKY_AUTHOR || 'love4dogs.club',
		indexWaitMs: Number(args.wait || process.env.TEST_INDEX_WAIT_MS || 15000),
		location: normalizeRegressionLocation(
			args.location || process.env.TEST_LOCATION || 'mauritius',
		),
		testMode: 'test' in args,
	};
}

export function normalizeRegressionLocation(value = '') {
	const source = String(value || '').trim();
	if (!source) return 'Port Louis, Mauritius';

	const normalized = source.toLowerCase();
	if (['mauritius', 'mu', 'mru', 'port-louis'].includes(normalized)) {
		return 'Port Louis, Mauritius';
	}
	if (['colorado', 'co', 'denver', 'usa', 'us'].includes(normalized)) {
		return 'Denver, Colorado, USA';
	}

	return source;
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

export async function loadRegressionProfileSeeds() {
	try {
		const raw = await readFile(REGRESSION_PROFILE_SEEDS_URL, 'utf8');
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((entry) => entry && typeof entry === 'object')
			: [];
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
}

export async function resetRegressionProfileSeeds() {
	await writeFile(
		REGRESSION_PROFILE_SEEDS_URL,
		'[]\n',
		'utf8',
	);
}

export async function saveRegressionProfileSeed(seed = {}) {
	const normalized = {
		uuid: String(seed?.uuid || '').trim(),
		authorid: String(seed?.authorid || seed?.uuid || '').trim(),
		authorName: String(seed?.authorName || seed?.title || '').trim(),
		authorAvatar: String(seed?.authorAvatar || seed?.profilePic || '').trim(),
		location: String(seed?.location || '').trim(),
		createdAt: new Date().toISOString(),
	};

	if (!normalized.uuid || !normalized.authorid || !normalized.authorName) {
		throw new Error('Regression profile seed requires uuid, authorid, and authorName.');
	}

	const existing = await loadRegressionProfileSeeds();
	const next = [
		normalized,
		...existing.filter((entry) => String(entry?.uuid || '').trim() !== normalized.uuid),
	].slice(0, 24);

	await writeFile(
		REGRESSION_PROFILE_SEEDS_URL,
		`${JSON.stringify(next, null, 2)}\n`,
		'utf8',
	);

	return normalized;
}

export function pickRandomRegressionProfileSeed(seeds = []) {
	const candidates = Array.isArray(seeds)
		? seeds.filter((entry) => {
			const uuid = String(entry?.uuid || '').trim();
			const authorid = String(entry?.authorid || '').trim();
			const authorName = String(entry?.authorName || '').trim();
			return Boolean(uuid && authorid && authorName);
		})
		: [];

	if (candidates.length === 0) return null;
	return pickRandom(candidates);
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

function randomMilesOffset(maxMiles = 30) {
	return (Math.random() * 2 - 1) * maxMiles;
}

function offsetCoordinatesByMiles(baseLat, baseLon, maxMiles = 30) {
	const latMiles = randomMilesOffset(maxMiles);
	const lonMiles = randomMilesOffset(maxMiles);
	const latDelta = latMiles / 69;
	const lonScale = Math.max(0.2, Math.cos((baseLat * Math.PI) / 180));
	const lonDelta = lonMiles / (69 * lonScale);
	return {
		lat: Number((baseLat + latDelta).toFixed(6)),
		lon: Number((baseLon + lonDelta).toFixed(6)),
	};
}

function hasUsableAddress(location = {}) {
	const line1 = [location.houseNumber, location.road]
		.map((value) => String(value || '').trim())
		.filter(Boolean)
		.join(' ');
	const hasLocality = Boolean(
		String(location.city || '').trim() ||
			String(location.suburb || '').trim() ||
			String(location.neighbourhood || '').trim() ||
			String(location.zip || '').trim()
	);
	return Boolean(line1 || hasLocality);
}

async function geocodeBaseLocation({baseUrl, query, fetchImpl = fetch}) {
	const response = await fetchImpl(`${baseUrl}/api/geocode`, {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify({query}),
	});

	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload?.ok === false) {
		throw new Error(payload?.error || `Geocoding failed for ${JSON.stringify(query)}`);
	}

	const lat = Number(payload?.lat);
	const lon = Number(payload?.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
		throw new Error(`Geocoding returned invalid coordinates for ${JSON.stringify(query)}`);
	}

	return {lat, lon};
}

async function reverseGeocodeLocation({baseUrl, lat, lon, fetchImpl = fetch}) {
	const response = await fetchImpl(`${baseUrl}/api/geocode`, {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify({lat, lon, reverse: true}),
	});

	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload?.ok === false) {
		return null;
	}

	const location = {
		lat: Number(payload?.lat),
		lon: Number(payload?.lon),
		houseNumber: String(payload?.houseNumber || '').trim(),
		road: String(payload?.road || '').trim(),
		neighbourhood: String(payload?.neighbourhood || '').trim(),
		suburb: String(payload?.suburb || '').trim(),
		city: String(payload?.city || '').trim(),
		state: String(payload?.state || '').trim(),
		country: String(payload?.country || '').trim(),
		zip: String(payload?.zip || '').trim(),
		formattedAddress: String(payload?.formattedAddress || '').trim(),
	};

	if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
		return null;
	}

	if (!hasUsableAddress(location)) {
		return null;
	}

	return location;
}

export async function createRandomTestLocation({
	baseUrl,
	location = 'Mauritius',
	fetchImpl = fetch,
	maxOffsetMiles = 30,
	maxAttempts = 12,
} = {}) {
	const normalizedLocation = normalizeRegressionLocation(location);
	const apiBase = String(baseUrl || '').trim();
	if (!apiBase) {
		throw new Error('createRandomTestLocation requires baseUrl for geocoding.');
	}

	const {lat: baseLat, lon: baseLon} = await geocodeBaseLocation({
		baseUrl: apiBase,
		query: normalizedLocation,
		fetchImpl,
	});

	for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
		const {lat, lon} = offsetCoordinatesByMiles(baseLat, baseLon, maxOffsetMiles);
		const reverse = await reverseGeocodeLocation({baseUrl: apiBase, lat, lon, fetchImpl});
		if (!reverse) continue;

		const hashes = buildMapHashes(lat, lon);
		const addressLine = [reverse.houseNumber, reverse.road]
			.map((value) => String(value || '').trim())
			.filter(Boolean)
			.join(' ');

		return {
			address: addressLine || reverse.formattedAddress,
			city: reverse.city,
			state: reverse.state,
			zip: reverse.zip,
			country: reverse.country,
			lat,
			lon,
			approximate: hashes.approximate,
			exact: hashes.exact,
			hashPath: hashes.path,
			formattedAddress: reverse.formattedAddress,
			houseNumber: reverse.houseNumber,
			road: reverse.road,
			neighbourhood: reverse.neighbourhood,
			suburb: reverse.suburb,
		};
	}

	throw new Error(
		`Unable to reverse geocode a usable address near ${JSON.stringify(normalizedLocation)} after ${maxAttempts} attempts.`
	);
}

// ---------------------------------------------------------------------------
// Real dog story & profile content generators
// ---------------------------------------------------------------------------

const _DOG_NAMES = [
	'Max', 'Bella', 'Charlie', 'Luna', 'Cooper', 'Daisy', 'Buddy', 'Molly',
	'Rocky', 'Lola', 'Bear', 'Sadie', 'Duke', 'Zoe', 'Zeus', 'Penny',
	'Milo', 'Roxy', 'Jack', 'Maggie', 'Atlas', 'Nala', 'Leo', 'Stella', 'Koda',
];
const _DOG_BREEDS = [
	'Labrador Retriever', 'Golden Retriever', 'German Shepherd', 'French Bulldog',
	'Beagle', 'Poodle', 'Border Collie', 'Australian Shepherd', 'Siberian Husky',
	'Boxer', 'Bernese Mountain Dog', 'Dachshund', 'Shih Tzu', 'Pit Bull Mix',
	'Corgi', 'Mutt / Mixed Breed', 'Great Dane Mix', 'Rottweiler Mix',
];
const _DOG_COLORS = [
	'chocolate brown', 'golden', 'black and white', 'tan and black',
	'silver grey', 'brindle', 'cream', 'red merle', 'pure white', 'jet black', 'liver and white',
];
const _PERSON_FIRST = [
	'Jennifer', 'Marcus', 'Sarah', 'David', 'Ashley', 'Carlos', 'Emily',
	'James', 'Natalie', 'Tyler', 'Amanda', 'Kevin', 'Diane', 'Luis', 'Rachel',
];
const _PERSON_LAST = [
	'Marsh', 'Delgado', 'Kim', 'Thornton', 'Rivera', 'Mendoza', 'Chen',
	'Whitfield', 'Okafor', 'Brooks', 'Cruz', 'Patton', 'Garcia', 'Sullivan', 'Park',
];
const _PARKS = [
	"Cheesman Park", "Washington Park", "City Park", "Sloan's Lake Park",
	'Ruby Hill Park', 'Cherry Creek Dog Park', 'Stapleton Dog Park', 'Berkeley Lake Park',
];
const _SHELTERS = [
	'Denver Dumb Friends League', 'Foothills Animal Shelter',
	'Humane Society of Boulder Valley', 'Arapahoe County Animal Control',
	'Colorado Animal Rescue', 'Mile High Mutts Rescue', 'Second Chance Humane Society',
];
const _ORG_NAMES = [
	'Rocky Mountain Paws Rescue', 'Colorado Dog Rescue Network',
	'Mile High Second Chances', 'Centennial Canine Coalition',
	'Front Range Dog Advocates', 'Denver Dog Welfare Alliance',
	'Pikes Peak Paws', 'Boulder Valley Dog Rescue',
];
const _VET_CLINICS = [
	'Sunrise Veterinary Clinic', 'Foothills Animal Hospital',
	'Peak Care Veterinary Services', 'Mile High Animal Wellness',
	'Horizon Veterinary Center', 'Alpine Pet Care Clinic',
];
const _TRAINER_ORGS = [
	'Colorado Dog Trainers Guild', 'Balanced Paws Training',
	'Rocky Rim Dog Sports', 'Front Range Canine Academy',
	'Summit Dog Training Center', 'Alpine Obedience Club',
];
const _WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const _MONTHS  = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'];
const _WEIGHTS = ['25', '35', '45', '55', '65', '75', '85'];
const _AGES    = ['1', '2', '3', '4', '5', '6', '7', '8'];
const _PROFILE_TYPES = ['rescue_org', 'individual', 'vet_clinic', 'trainer', 'foster'];

// Deterministic pick seeded by uuid + offset so values are consistent per test run.
function _seeded(arr, seed, offset = 0) {
	let h = 5381;
	for (const c of seed) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
	return arr[Math.abs(h + offset) % arr.length];
}

function _imgFigures(imageUrls = []) {
	const captions = [
		'A recent photo taken during our morning walk.',
		'Caught mid-play at the local dog park.',
		'Resting at home — still full of personality.',
		'A candid moment that captures their true character.',
	];
	return imageUrls
		.map((url, i) =>
			`<figure><img src="${url}" alt="Photo ${i + 1}" loading="lazy" decoding="async">` +
			`<figcaption>${captions[i % captions.length]}</figcaption></figure>`
		)
		.join('\n');
}

const _FILLER = [
	'<p>We continue to monitor the situation and will post updates here as they become available. Thank you to everyone in our community who has reached out with support, tips, and kind words. Your compassion truly makes a difference for dogs and their families in our area.</p>',
	'<p>If you have additional information or would like to help, please use the contact form on this page. We review all messages and respond as quickly as we can. Every piece of information helps, no matter how small it seems.</p>',
	'<p>Our local dog community has shown incredible solidarity in situations like this. Whether through sharing posts, donating supplies, or simply spreading the word, each action contributes to a better outcome. Together we make a real difference for every dog in need across Colorado.</p>',
	'<p>Dogs are not just pets — they are family members who bring joy, comfort, and unconditional love into our lives every single day. When one is in need, the entire community rallies. We are deeply grateful for the outpouring of support we have received from neighbors and strangers alike.</p>',
	'<p>Please remember to check local shelters and rescues even if they are some distance away. Dogs can travel further than expected, especially if startled. Posting on community groups and Nextdoor can dramatically increase visibility and the chance of a positive outcome.</p>',
	'<p>We will continue to post regular updates until the situation is fully resolved. Thank you for being part of this caring and responsive community. Your kindness and dedication to animal welfare means the world to us and to every dog we serve.</p>',
	'<p>Animal welfare is a community responsibility, and it is heartwarming to see so many people step up when it matters most. From experienced dog handlers to neighbors who simply keep their eyes open, every contribution counts. We are proud to be part of a community that cares.</p>',
	'<p>Research consistently shows that animals who are quickly reunited with their families — or placed in loving foster or permanent homes — have significantly better outcomes than those who wait in institutional care. Speed and community visibility are the most powerful tools we have. Your shares and your eyes on the ground matter enormously.</p>',
];

function _padToSize(html, targetChars) {
	let result = html;
	let i = 0;
	while (result.length < targetChars) {
		result += '\n' + _FILLER[i % _FILLER.length];
		i++;
		if (i > 600) break;
	}
	return result;
}

/**
 * Generate realistic dog post HTML content driven by the primary tag.
 * Returns { title, description, html } with html padded to ~20 000 chars.
 */
export function generateRealDogPostContent(primaryTag, tags, uuid, imageUrls = []) {
	const name    = _seeded(_DOG_NAMES,    uuid, 0);
	const breed   = _seeded(_DOG_BREEDS,   uuid, 1);
	const color   = _seeded(_DOG_COLORS,   uuid, 2);
	const age     = _seeded(_AGES,         uuid, 3);
	const weight  = _seeded(_WEIGHTS,      uuid, 4);
	const ownerFn = _seeded(_PERSON_FIRST, uuid, 5);
	const ownerLn = _seeded(_PERSON_LAST,  uuid, 6);
	const owner   = `${ownerFn} ${ownerLn}`;
	const park    = _seeded(_PARKS,        uuid, 7);
	const shelter = _seeded(_SHELTERS,     uuid, 8);
	const day     = _seeded(_WEEKDAYS,     uuid, 9);
	const month   = _seeded(_MONTHS,       uuid, 10);
	const imgs    = _imgFigures(imageUrls);
	const tag     = String(primaryTag || 'help').toLowerCase();

	let title, description, body;

	if (tag === 'lost') {
		title = `LOST: ${breed} Named "${name}" — Missing Since ${day}`;
		description = `Help us find ${name}! Our beloved ${age}-year-old ${color} ${breed} went missing near ${park}. Approx. ${weight} lbs, microchipped. Please share. Contact ${owner}.`;
		body = `<h2>Help Us Find ${name}!</h2>
<p>Our family is heartbroken. ${name}, our ${age}-year-old ${color} ${breed}, disappeared from near ${park} on ${day} evening around 6:30 PM. We were finishing our walk when a loud noise startled ${name} and the leash slipped. By the time we recovered, ${name} had vanished into the trees along the trail.</p>
${imgs}
<h3>Description</h3>
<ul>
  <li><strong>Name:</strong> ${name}</li>
  <li><strong>Breed:</strong> ${breed}</li>
  <li><strong>Color:</strong> ${color}</li>
  <li><strong>Age:</strong> ${age} years</li>
  <li><strong>Weight:</strong> approx. ${weight} lbs</li>
  <li><strong>Microchipped:</strong> Yes — registered to ${owner}</li>
  <li><strong>Spayed/Neutered:</strong> Yes</li>
  <li><strong>Last seen wearing:</strong> blue harness (may have slipped off)</li>
</ul>
<h3>What We've Done So Far</h3>
<p>We immediately contacted ${shelter} and filed a lost-dog report. We have walked the area each morning and evening, placed over 40 flyers at local businesses, and posted on Nextdoor and Facebook community groups. Our neighbor set up a wildlife camera near the trail entrance. We have notified every veterinary clinic within 15 miles and sent ${name}'s microchip number to all area shelters.</p>
<p>If you spot ${name}, please do not chase — scared dogs run. Instead, crouch down, call softly, or toss treats nearby. ${name} is food-motivated. Even a distant sighting is valuable, so please use the contact form on this page immediately.</p>
<h3>Please Help</h3>
<p>Shares are the single most effective thing you can do right now. The more eyes on this post, the faster ${name} comes home. We are offering a reward and are overwhelmed with gratitude for the support of this community. ${name} is deeply loved and very missed — especially by our kids, who ask about ${name} every morning.</p>`;
	} else if (tag === 'found') {
		title = `FOUND: ${color} ${breed} Wandering Near ${park}`;
		description = `We found a stray ${breed} near ${park} — no collar, appears healthy and friendly. Scanned for microchip at ${shelter}. Holding safely. Is this your dog?`;
		body = `<h2>Found Dog — Searching for Owner</h2>
<p>We found a ${color} ${breed} wandering alone near ${park} on ${day} afternoon. The dog appeared to have been on their own for some time — slightly dehydrated but otherwise in good health. No collar or ID tags were present. We've taken the dog in temporarily while we search for their family.</p>
${imgs}
<h3>Description of Found Dog</h3>
<ul>
  <li><strong>Breed:</strong> ${breed} (approximate)</li>
  <li><strong>Color:</strong> ${color}</li>
  <li><strong>Estimated Age:</strong> ${age}–${Number(age) + 1} years</li>
  <li><strong>Estimated Weight:</strong> ${weight} lbs</li>
  <li><strong>Sex:</strong> Male, neutered</li>
  <li><strong>Temperament:</strong> Calm, friendly, good with strangers</li>
  <li><strong>Microchip:</strong> Present but registration outdated — not in national database</li>
</ul>
<h3>What We've Done</h3>
<p>We brought the dog to ${shelter} for a microchip scan and vet check. The chip was registered but the contact number was disconnected. We filed a found-animal report with city animal control and are temporarily fostering the dog — we've named them ${name} — while the search continues. ${name} is house-trained, knows sit and stay, and gets along well with our resident dog, which suggests they had a loving home before.</p>
<p>If this is your dog, please use the contact form and provide identifying details: vet records, prior photos, unique markings. We'll verify and reunite you as quickly as possible. If no owner is found within 30 days, we will work with our rescue network to find ${name} a permanent home.</p>`;
	} else if (tag === 'offered') {
		title = `"${name}" Needs a Forever Home — ${breed}, ${age} Yrs, Loves Everyone`;
		description = `Meet ${name}, a ${age}-year-old ${color} ${breed} ready for adoption. Good with kids and dogs, fully vetted, house-trained. Currently fostered in Denver, CO. Adoption fee: $150.`;
		body = `<h2>Meet ${name} — Adoptable ${breed}</h2>
<p>We are so excited to introduce ${name}, a ${age}-year-old ${color} ${breed} looking for their forever home. ${name} came to us through ${shelter} after their previous owner had to move into a situation that could not accommodate a pet. Despite the change, ${name} has adjusted beautifully and shown remarkable resilience and love.</p>
${imgs}
<h3>About ${name}</h3>
<p>${name} loves morning walks, belly rubs, and chasing tennis balls. Weighing approximately ${weight} lbs, ${name} is in excellent health — fully vaccinated, heartworm-negative, and recently given a clean bill of health by our vet. ${name} knows sit, stay, come, down, and leave-it reliably, and is working on loose-leash walking (improving every week!).</p>
<ul>
  <li><strong>Age:</strong> ${age} years</li>
  <li><strong>Breed:</strong> ${breed}</li>
  <li><strong>Weight:</strong> ${weight} lbs</li>
  <li><strong>Good with kids:</strong> Yes — best with children 8+</li>
  <li><strong>Good with dogs:</strong> Yes, after proper intro</li>
  <li><strong>House-trained:</strong> Yes</li>
  <li><strong>Energy level:</strong> Moderate — two walks/day recommended</li>
</ul>
<h3>Adoption Requirements</h3>
<p>We're looking for a home where ${name} will be an indoor family member. A fenced yard is preferred but not required. The adoption fee is $150 and includes spay/neuter, current vaccines, microchip, and a starter kit. All applicants complete an interview and home check. We match dogs to families carefully — this is not first-come, first-served. Apply using the contact form on this page.</p>`;
	} else if (tag === 'wanted') {
		title = `Advice Wanted: ${name} the ${breed} Struggles With Separation Anxiety`;
		description = `Has anyone worked through severe separation anxiety in a ${breed}? Our ${age}-year-old ${name} is struggling badly when left alone. Looking for trainer recs and community experience.`;
		body = `<h2>Seeking Advice: Separation Anxiety in Our ${breed}, ${name}</h2>
<p>Hi community — I'm ${owner} and I'm posting because we're at our wit's end with a behavior issue in our ${age}-year-old ${color} ${breed}, ${name}. We adopted ${name} from ${shelter} eight months ago and love ${name} completely, but the separation anxiety has become a serious challenge we can't resolve on our own.</p>
${imgs}
<h3>The Problem</h3>
<p>Every time we leave — even for 10 minutes — ${name} becomes extremely distressed: continuous howling (confirmed by neighbors and a recording app), destructive chewing near exits, attempted window escapes, and excessive paw licking. We return to chaos and a trembling, exhausted dog. The anxiety begins the moment ${name} reads our departure cues: putting on shoes, picking up keys.</p>
<h3>What We've Tried</h3>
<ul>
  <li>Stuffed Kong before departures</li>
  <li>Background music and TV</li>
  <li>Crate (made things much worse — discontinued immediately)</li>
  <li>Long exercise walks before leaving</li>
  <li>Adaptil diffuser and collar — mild improvement only</li>
  <li>Calming chews with L-theanine — minimal effect</li>
  <li>Desensitization to departure cues — partial success, very slow progress</li>
</ul>
<h3>What We're Looking For</h3>
<p>We are specifically seeking: (1) a CSAT-certified separation anxiety trainer in the Denver Front Range area, (2) personal experience with medication-assisted behavior modification (our vet mentioned Clomicalm or fluoxetine as options), and (3) any success stories from ${breed} owners who have worked through a severe case. We are committed — this is not a situation we will give up on. ${name} is family.</p>`;
	} else if (tag === 'rescue') {
		title = `Rescue Story: ${name} Saved From High-Kill Shelter — Now Thriving`;
		description = `${name}, a ${age}-year-old ${color} ${breed}, was pulled from ${shelter} with 24 hours to spare. After three months in foster care, ${name} found their forever home. Read the full story.`;
		body = `<h2>${name}'s Rescue Story — From Kennel 14 to the Sofa</h2>
<p>Sometimes you get the call that changes everything. Ours came on a Tuesday morning: a ${age}-year-old ${color} ${breed} was on the euthanasia list at ${shelter}. They had been in Kennel 14 for 63 days — well past the typical hold period — and time had run out. We had 24 hours to pull ${name} or it would be too late.</p>
${imgs}
<h3>The Pull</h3>
<p>We made the drive at 7 AM. What we found in that kennel broke our hearts and inspired us in equal measure. ${name} was curled in the far corner, facing the wall — a classic stress response in shelter dogs who have stopped expecting good things. But when our foster coordinator crouched down and held out her hand, ${name} slowly turned, crept forward, and pressed a cold nose against her palm. That was the moment we knew ${name} would be okay.</p>
<p>Intake assessment: malnourished (${Number(weight) - 12} lbs, well below healthy weight), untreated ear infections in both ears, and significant anxiety. Despite all of this, ${name} was gentle, non-reactive, and clearly yearned for human connection. We loaded ${name} into the transport van and never looked back.</p>
<h3>The Foster Journey</h3>
<p>For the first two weeks, ${name} barely left the dog bed in the corner of the living room. Our foster family gave space, gentle encouragement, and three consistent meals a day. By week three, ${name} was joining short walks. By week six, ${name} was sleeping on the sofa with the family cat. By month two, ${name} was doing zoomies in the backyard and greeting every visitor with a wagging tail. The transformation never gets old.</p>
<h3>${name} Today</h3>
<p>${name} was adopted by ${owner} and their family in ${month}. They send us weekly updates. ${name} hikes the Front Range trails, goes to the dog park every morning, and recently completed a beginner agility course. This is why we do what we do.</p>`;
	} else if (tag === 'medical') {
		const cost = 3200 + (Math.abs((uuid.charCodeAt(0) || 1) * 17) % 1800);
		title = `Help Needed: ${name} Needs Emergency Surgery — Fundraiser Open`;
		description = `Our ${age}-year-old ${breed}, ${name}, needs emergency surgery estimated at $${cost.toLocaleString()}. We've exhausted savings and CareCredit. Any contribution or share helps bring ${name} home.`;
		body = `<h2>Please Help ${name} — Emergency Surgery Fundraiser</h2>
<p>We never expected to post something like this, but we have nowhere else to turn. Our ${age}-year-old ${color} ${breed}, ${name}, collapsed last week during an evening walk. The emergency vet diagnosed ${name} with a serious internal condition requiring immediate surgical intervention. Without surgery within 48–72 hours, the prognosis is very poor.</p>
${imgs}
<h3>The Diagnosis</h3>
<p>After X-rays, ultrasounds, and blood panels, the team at ${_seeded(_VET_CLINICS, uuid, 11)} gave us the news no pet owner wants to hear. The condition is 100% treatable — but only with surgery that must happen soon. Estimated cost: $${cost.toLocaleString()}, including surgery, anesthesia, a 3-night hospital stay, medications, and follow-up visits.</p>
<p>We are a single-income family and do not have this money available. We've applied for CareCredit and Scratchpay but were approved for far less than the full amount. We have committed every dollar of our savings. We reach out to this community with humility, hoping that together we can save ${name}'s life.</p>
<h3>About ${name}</h3>
<p>${name} has been with our family for ${age} years. They came to us as a puppy from ${shelter} and has been the heart of our home ever since — the first face our kids see in the morning and the last comfort they seek at night. ${name} is otherwise healthy, fully vaccinated, and has never had a major health event before this one.</p>
<h3>How to Help</h3>
<p>Every donation, no matter the size, brings us closer to getting ${name} into surgery. If you cannot donate, please share this post — visibility is everything. We'll post daily updates. All funds beyond the immediate cost will go toward follow-up care and physical therapy during recovery. Thank you for being part of our community.</p>`;
	} else if (tag === 'training') {
		title = `Training Help: ${name} the ${breed} Is Reactive on Leash — ${age} Years Old`;
		description = `Looking for Front Range trainer recommendations for leash reactivity in our ${age}-year-old ${breed}, ${name}. We've done basics and counter-conditioning — ready to invest in specialized professional help.`;
		body = `<h2>Leash Reactivity Help for ${name} — Our ${age}-Year-Old ${breed}</h2>
<p>Hello everyone! I'm ${owner} and I'm reaching out about our ${age}-year-old ${color} ${breed}, ${name}, who has been struggling with leash reactivity toward other dogs for the past year. We adopted ${name} as a puppy, did puppy classes and an adult obedience course, but reactivity emerged around 18 months and has become a significant challenge.</p>
${imgs}
<h3>What the Reactivity Looks Like</h3>
<p>${name} has a threshold of roughly 30–40 feet for unfamiliar dogs. Inside that threshold: lunging, full-bark alarm, hackles raised, pulling hard enough to knock me off balance. Off-leash in enclosed spaces, ${name} is almost always social and playful — classic barrier frustration mixed with anxiety. We live near ${park}, which makes training sessions unpredictable.</p>
<h3>What We've Tried</h3>
<ul>
  <li>Puppy and adult group obedience — completed both</li>
  <li>Counter-conditioning with high-value treats (chicken, cheese, hot dog)</li>
  <li>Look-at-That (LAT) protocol from <em>Control Unleashed</em> — partial progress</li>
  <li>Basket muzzle training — ${name} is fully muzzle-conditioned for safety</li>
  <li>Management: avoiding trigger-heavy times, crossing streets proactively</li>
</ul>
<h3>What We're Looking For</h3>
<p>We want a CPDT-KA or CSAT specialist with proven reactive-dog experience. We're open to board-and-train only with a force-free program and robust transition support. Happy to travel within an hour of Denver for the right trainer. Budget is flexible — we'd rather invest now than deal with an escalating situation. Any personal experience with a reactive ${breed} would be deeply appreciated.</p>`;
	} else if (tag === 'volunteer') {
		title = `Volunteers Needed: Dog Walkers &amp; Fosters at ${shelter}`;
		description = `${shelter} is at capacity and urgently needs volunteers to walk, socialize, and foster dogs. No experience required — just a love of dogs and a few hours a week. Training provided.`;
		body = `<h2>Volunteer Opportunity: Help Dogs at ${shelter}</h2>
<p>${shelter} is currently at capacity and urgently needs community support. With over 60 dogs in our care right now, we depend on dedicated volunteers to provide the enrichment, socialization, and love that our staff alone cannot provide. Whether you have two hours a week or twenty, there is a role that fits your schedule.</p>
${imgs}
<h3>Available Volunteer Roles</h3>
<ul>
  <li><strong>Dog Walker:</strong> Walk assigned shelter dogs 30–60 min. Morning, afternoon, and weekend slots. Our most urgently needed role.</li>
  <li><strong>Socialization Volunteer:</strong> Quiet-room time with anxious dogs — reading aloud, gentle play, gentle handling to reduce kennel stress.</li>
  <li><strong>Foster Family:</strong> Take a dog into your home temporarily (days to weeks). Foster dogs have dramatically higher adoption success rates.</li>
  <li><strong>Event Volunteer:</strong> Help at adoption fairs, fundraisers, and community outreach — table staff, drivers, setup/teardown crews.</li>
  <li><strong>Remote/Admin:</strong> Social media, adoption bio writing, inquiry calls, data entry. Done from home on your schedule.</li>
</ul>
<h3>What We Provide</h3>
<p>All volunteers receive a comprehensive orientation covering dog body language, safe handling, and shelter protocols. Dog walkers are matched to dogs suited to their size and experience. Foster families receive all supplies and full vet care at no cost. Our volunteer coordinator is available seven days a week for support and questions.</p>
<p>We welcome everyone — from lifelong dog owners to first-timers who simply want to help. The only requirements are a genuine love for dogs and reliability. Our dogs bond with their regular volunteers; that consistency matters enormously. Fill out the volunteer form on this page and join us at our next Saturday orientation at 9 AM. We cannot wait to meet you — and neither can the dogs.</p>`;
	} else if (tag === 'event') {
		title = `Paws in the Park: Dog Social at ${park} — ${month}`;
		description = `Join our free monthly dog meetup at ${park}! All breeds and sizes welcome. Meet other local dog owners and let the pups play. Free to attend — donations to ${shelter} always welcome.`;
		body = `<h2>You're Invited: Paws in the Park at ${park}</h2>
<p>We're hosting our monthly Paws in the Park meetup at ${park} and would love for you and your dog to join us! This free, informal gathering welcomes dogs and dog lovers from across the Denver area — from social butterflies to shy pups still building confidence.</p>
${imgs}
<h3>Event Details</h3>
<ul>
  <li><strong>Location:</strong> ${park}, Denver, CO — east lawn, main entrance</li>
  <li><strong>Month:</strong> Third Saturday of ${month}</li>
  <li><strong>Time:</strong> 8:00 AM – 10:30 AM</li>
  <li><strong>Cost:</strong> Free — donations to ${shelter} welcome but never required</li>
  <li><strong>Dogs welcome:</strong> All breeds, all sizes, all ages</li>
  <li><strong>Requirements:</strong> Up-to-date vaccines, on-leash until off-leash zone, friendly temperament</li>
</ul>
<h3>What to Expect</h3>
<p>Our meetups typically draw 20–40 dogs and their owners. We have a designated off-leash play area for social dogs and a calmer on-leash zone for dogs who prefer a gentler pace. Coffee for humans, community water station for the pups. Each month a local rescue brings 2–3 adoptable dogs — last month two found homes at the event. We also do a monthly trick demonstration where any dog can participate. Come see for yourself!</p>`;
	} else if (tag === 'meetup') {
		title = `Denver Dog Lovers Meetup — ${park}, Every Saturday at 8 AM`;
		description = `Join our long-running weekly dog lovers group at ${park} every Saturday morning. Regulars welcome, first-timers celebrated. Bring your pup or come without — all dog enthusiasts are welcome.`;
		body = `<h2>Weekly Dog Lovers Meetup at ${park}</h2>
<p>We've been meeting at ${park} every Saturday morning for three years. What started as six people and eight dogs now regularly draws 30+ dogs and their owners — rain or shine. Everyone is welcome: bring your dog, come solo, or spend the morning with one of ours.</p>
${imgs}
<h3>Our Regular Schedule</h3>
<p><strong>8:00 AM:</strong> Gather at the east picnic area. Coffee shared, introductions made for first-timers.</p>
<p><strong>8:15 AM:</strong> Group walk — a 1.5-mile loop, off-leash friendly along most of the route. Reactive-friendly stragglers always welcome on the alternate path.</p>
<p><strong>9:00 AM:</strong> Free play time in the fenced area, size rotation for the first 15 minutes.</p>
<p><strong>9:30 AM:</strong> Community circle — lost/found updates, adoption spotlights, training wins. Typically 10–15 minutes.</p>
<p><strong>10:00 AM:</strong> Informal socializing until people head home. Some of us grab breakfast after.</p>
<h3>Our Community Values</h3>
<p>We are force-free, judgment-free, and breed-blind. We ask only for basic management, honest self-assessment, and a genuine love of dogs. Our regulars have helped reunite lost dogs, arranged emergency fosters, facilitated dozens of adoptions, and raised thousands for ${shelter}. What started as a casual walk has become something genuinely beautiful. Come see.</p>`;
	} else if (tag === 'supplies') {
		title = `Free Dog Supplies — ${breed}-Size Crate, Beds, Toys, Food — Must Go Soon`;
		description = `Relocating out of state and need to rehome ${name}'s gear. Large wire crate, orthopedic bed, harnesses, toys, opened food. Free to a good home — pickup in Denver metro.`;
		body = `<h2>Free Dog Supplies — Everything Must Go</h2>
<p>We're moving across the country in three weeks and can't take all of ${name}'s supplies. Rather than donate to a general thrift store, we'd love these items to go directly to dogs and families in our community. Everything is gently used and has a lot of life left in it.</p>
${imgs}
<h3>Available Items</h3>
<ul>
  <li><strong>Wire crate (large, ${weight}-lb dog):</strong> 42" double-door with divider and tray. Surface scratches only, fully functional. Retail ~$90+</li>
  <li><strong>Orthopedic dog bed (large):</strong> Memory foam, removable washable cover. Excellent condition.</li>
  <li><strong>Standard dog bed (medium):</strong> Sherpa style, well-loved but clean.</li>
  <li><strong>4x leashes (assorted lengths and materials)</strong></li>
  <li><strong>2x no-pull harness (large)</strong></li>
  <li><strong>Assorted toys:</strong> Rope toys, squeakies, Kong XL (x2), flirt pole, snuffle mat.</li>
  <li><strong>~15 lbs premium kibble:</strong> Sealed bag, well within date.</li>
  <li><strong>Treats and chews:</strong> Partially used bags, all in date.</li>
  <li><strong>Grooming tools:</strong> Slicker brush, nail grinder, ear cleaner kit.</li>
</ul>
<h3>Pickup Details</h3>
<p>Free pickup in the Denver metro area. Prefer to give everything to one household (great for a new dog owner or rescue foster home) but happy to split if needed. Pickup only — we cannot deliver. We ask that items go to homes with dogs, not for resale. Contact us through the form on this page with your availability. Evenings and weekends work best.</p>`;
	} else if (tag === 'transportation') {
		const origin = _seeded(['Pueblo', 'Colorado Springs', 'Grand Junction', 'Durango', 'Fort Collins'], uuid, 12);
		title = `Transport Volunteer Needed: ${name} — ${origin} to Denver Foster Home`;
		description = `${name}, a ${color} ${breed} rescued from a high-kill shelter in ${origin}, needs a volunteer driver to reach a Denver foster home this weekend. Mileage reimbursement available.`;
		body = `<h2>Transport Volunteer Needed for ${name} the ${breed}</h2>
<p>We need a volunteer driver to transport ${name}, a ${age}-year-old ${color} ${breed}, from ${origin} to a waiting foster home in Denver. This is urgent — ${name} has been pulled from a high-kill shelter and has a confirmed foster placement ready. All we need is a driver willing to make the trip this weekend.</p>
${imgs}
<h3>About ${name}</h3>
<p>${name} is a gentle ${weight}-lb ${breed} surrendered to ${shelter} when their owner could no longer provide care. ${name} has been assessed as calm in vehicles, non-reactive to other dogs, and friendly with all people. ${name} is crate-trained and will travel in a secure carrier provided by the rescue.</p>
<h3>Transport Details</h3>
<ul>
  <li><strong>Pickup:</strong> ${origin}, CO (exact address shared with confirmed driver)</li>
  <li><strong>Drop-off:</strong> East Denver, CO (address shared on confirmation)</li>
  <li><strong>Preferred date:</strong> This Saturday or Sunday</li>
  <li><strong>Preferred time:</strong> Morning pickup (8–11 AM)</li>
  <li><strong>Mileage reimbursement:</strong> Available — contact us for details</li>
</ul>
<p>If you can help — even for a single trip — please contact us immediately through the form on this page. You will be met at both ends by rescue representatives. Time is of the essence. Thank you so much for considering this.</p>`;
	} else if (tag === 'urgent') {
		title = `URGENT: Senior ${breed} Named "${name}" Needs Placement in 48 Hours`;
		description = `${name}, a ${age}-year-old ${color} ${breed}, had their foster fall through due to a family emergency. Without a new placement by ${day}, ${name} returns to the shelter. Please help.`;
		body = `<h2>URGENT: ${name} Needs a Home in 48 Hours</h2>
<p>Please read and share immediately. ${name}, a sweet ${age}-year-old ${color} ${breed}, is in a critical situation. We pulled ${name} from ${shelter} last week with a confirmed foster — and that foster had to cancel due to a family emergency. Without a new placement by end of day ${day}, ${name} must return to the shelter where the prognosis is not good.</p>
${imgs}
<h3>About ${name}</h3>
<p>${name} is a senior dog — calm, house-trained, deeply affectionate, and a complete homebody. Arthritis is managed with a daily joint supplement, heartworm-negative, fully vaccinated. ${name} moves at a gentle pace and needs two short walks per day. ${name} is ideal for a quieter household or an experienced dog family who understands the unique joy of giving a senior dog their best remaining years.</p>
<h3>What ${name} Needs Right Now</h3>
<p>We need either a <strong>foster home</strong> (temporary, all supplies and vet care provided by our rescue) or a <strong>forever adopter</strong> willing to fast-track the process. We will waive the typical waiting period for the right applicant given the urgency. Please, if you can help — even for one week — or if you know someone who could — reach out now. Senior dogs deserve a chance too. Don't scroll past ${name}.</p>`;
	} else {
		// help / default
		title = `Need Advice: ${name} Our ${breed} Has Been Acting Strange This Week`;
		description = `Our ${age}-year-old ${breed}, ${name}, has been eating less, sleeping differently, and slightly favoring one leg. Vet visit scheduled — looking for community experience with similar symptoms.`;
		body = `<h2>Community Advice Needed About ${name}</h2>
<p>Hi everyone! I'm ${owner} and I value the experience in this community. Our ${age}-year-old ${color} ${breed}, ${name}, has been showing unusual behaviors for the past week. We have a vet appointment scheduled, but I'd love to hear if anyone has experienced something similar.</p>
${imgs}
<h3>What We've Noticed</h3>
<p>${name} has been eating less than usual — usually finishes their bowl in minutes, now leaving almost half. Sleep patterns have shifted: used to sleep through the night, now waking 2–3 times and pacing. We've also noticed intermittent favoring of the left rear leg — not consistent, but enough that my partner and I both mentioned it independently within 24 hours. Energy is mildly reduced but ${name} still wants to walk and gets excited for play — just tires a little faster.</p>
<p>No vomiting, no diarrhea, normal water intake. No recent changes to food, routine, or environment. No construction, visitors, or obvious stressors. We checked ${name} over at home: no visible wounds or swelling, ears clean, eyes clear, gums pink and moist.</p>
<h3>What We're Looking For</h3>
<p>We know we're not getting a diagnosis here — community experience helps us ask the right questions at the vet. Has anyone seen this combination of symptoms in a ${breed} of this age? Any tests we should specifically request? Any questions we should bring to the appointment that a general vet might not think to ask? Thank you so much for any insight you're willing to share.</p>`;
	}

	const fullHtml = _padToSize(body, 20000);
	return { title, description, html: fullHtml };
}

/**
 * Generate realistic profile content (rescue org, individual, vet clinic, etc.).
 * Returns { name, description, html } with html padded to ~22 000 chars.
 */
export function generateRealProfileContent(primaryTag, tags, uuid, imageUrls = []) {
	const profileType = _seeded(_PROFILE_TYPES, uuid, 13);
	const orgName     = _seeded(_ORG_NAMES,      uuid, 14);
	const vetName     = _seeded(_VET_CLINICS,    uuid, 15);
	const trainerOrg  = _seeded(_TRAINER_ORGS,   uuid, 16);
	const firstName   = _seeded(_PERSON_FIRST,   uuid, 17);
	const lastName    = _seeded(_PERSON_LAST,    uuid, 18);
	const dogName     = _seeded(_DOG_NAMES,      uuid, 19);
	const breed       = _seeded(_DOG_BREEDS,     uuid, 20);
	const park        = _seeded(_PARKS,          uuid, 21);
	const shelter     = _seeded(_SHELTERS,       uuid, 22);
	const month       = _seeded(_MONTHS,         uuid, 23);
	const imgs        = _imgFigures(imageUrls);

	let name, description, body;

	if (profileType === 'rescue_org') {
		name = orgName;
		description = `${orgName} is a Colorado 501(c)(3) rescue dedicated to saving dogs from high-kill shelters across the Front Range. We rely entirely on volunteers and community support. Every dog saved is a life transformed.`;
		body = `<h2>About ${orgName}</h2>
<p>${orgName} was founded in ${month} by a small group of passionate animal advocates who believed that every healthy, treatable dog deserves a second chance at life. What began as a handful of volunteers pulling dogs from overcrowded shelters has grown into one of Colorado's most active rescue networks, with foster homes across the Denver metro area and partnerships with shelters from Pueblo to Fort Collins.</p>
${imgs}
<h3>Our Mission</h3>
<p>We exist to bridge the gap between dogs in crisis and the loving homes waiting for them. We focus primarily on dogs facing euthanasia due to overcrowding. Every dog we pull receives a full veterinary workup, all necessary vaccinations, spay/neuter surgery, microchip registration, and placement in a screened foster home before being made available for adoption.</p>
<h3>What We Do</h3>
<ul>
  <li><strong>Shelter Pulls:</strong> We actively monitor euthanasia lists at partner shelters and pull dogs based on our foster capacity, prioritizing the most urgent cases.</li>
  <li><strong>Foster Network:</strong> Our 40+ active foster families provide temporary homes where dogs can decompress, learn house manners, and build confidence. Fosters receive all supplies and vet care at no cost.</li>
  <li><strong>Adoptions:</strong> All adoptions go through a careful matching process — applications, reference checks, and home visits. Our return rate is under 3%.</li>
  <li><strong>Community Education:</strong> We partner with schools, libraries, and community organizations to teach responsible pet ownership, dog bite prevention, and shelter dog advocacy.</li>
  <li><strong>Emergency Response:</strong> When natural disasters, hoarding situations, or sudden owner deaths leave dogs without homes, we mobilize our network to help.</li>
</ul>
<h3>Our Dogs</h3>
<p>We have welcomed dogs of all breeds, ages, and backgrounds. We do not discriminate by breed. We have placed pit bulls, Chihuahuas, senior dogs, three-legged dogs, deaf dogs, and dogs with complex medical needs — because every life has value, and the right family is out there for every dog. Some of our most enthusiastic foster updates come from adopters who initially said they weren't sure about a particular dog.</p>
<h3>How to Get Involved</h3>
<p>The best way to support ${orgName} is to become a foster family. All we ask is your time, your patience, and your home. If you cannot foster, consider volunteering at events, transporting dogs to vet appointments, or donating to our veterinary fund. Every contribution directly supports the dogs in our care. Contact us using the form on this page to learn more.</p>
<h3>Success Stories</h3>
<p>We are proud to share that since our founding we have placed over 800 dogs into permanent homes across Colorado. Each placement represents a dog who was hours from death and a family who gained a loyal companion. We receive photos and updates from adopters every single week. From ${dogName} the ${breed} who now competes in agility with the ${firstName} family, to the eight-year-old senior who spends her days on a sunny back porch near ${park} — these stories fuel everything we do.</p>`;
	} else if (profileType === 'vet_clinic') {
		name = vetName;
		description = `${vetName} provides compassionate, evidence-based care for dogs and their families across the Denver metro area. From routine wellness visits to complex surgery, we treat every patient like family.`;
		body = `<h2>Welcome to ${vetName}</h2>
<p>${vetName} has served the Denver Front Range community for over twelve years. Founded by Dr. ${firstName} ${lastName}, our practice was built on a single belief: that veterinary care should be compassionate, transparent, and accessible. We have grown from a three-person team to a full-service facility with specialists in surgery, dentistry, internal medicine, and rehabilitation — but our culture has never changed.</p>
${imgs}
<h3>Our Services</h3>
<ul>
  <li><strong>Preventive Care:</strong> Annual wellness exams, vaccines, heartworm and flea/tick prevention, dental cleanings, and nutritional counseling tailored to your dog's life stage.</li>
  <li><strong>Sick Visits:</strong> Same-day appointments available for urgent cases. We triage all calls and do our best to see every dog who needs us, even on busy days.</li>
  <li><strong>Surgery:</strong> Soft tissue, orthopedic, and dental surgery performed by experienced surgeons in our on-site surgical suite. Pre-operative bloodwork and post-op monitoring included.</li>
  <li><strong>Diagnostics:</strong> In-house lab, digital X-ray, ultrasound, and access to specialist referral for advanced imaging and oncology.</li>
  <li><strong>Rehabilitation:</strong> Hydrotherapy, laser therapy, and physical rehabilitation for post-surgical recovery and chronic pain management.</li>
  <li><strong>End-of-Life Care:</strong> Compassionate in-home and in-clinic euthanasia services, with grief support resources for families.</li>
</ul>
<h3>Our Philosophy</h3>
<p>We believe in informed consent, clear communication, and individualized care. We will never recommend a procedure we would not recommend for our own dogs. Our team includes certified veterinary technicians, Fear Free certified staff, and a full-time client care coordinator who helps families navigate diagnosis, treatment decisions, and financial planning.</p>
<h3>Community Partnerships</h3>
<p>We proudly partner with ${shelter} to provide discounted care for newly adopted dogs, and we volunteer our services at two low-income community clinics per year. We also host a monthly "Ask the Vet" community session at ${park} on the third Sunday of each month. We believe that every dog — regardless of their owner's income — deserves basic veterinary care, and we put that belief into practice whenever we can.</p>
<h3>Meet Our Team</h3>
<p>Our team of eight veterinarians and twelve technicians brings decades of combined experience and an unwavering passion for animal health. Many of our staff members are foster families for local rescues, and several have adopted their current pets directly from ${shelter}. We don't just work with dogs — we live with them, love them, and advocate for them in everything we do.</p>`;
	} else if (profileType === 'trainer') {
		name = trainerOrg;
		description = `${trainerOrg} offers force-free, science-based training for dogs of all breeds, ages, and backgrounds. From puppy basics to competition obedience, reactive-dog rehab to service dog foundations — we train the whole team.`;
		body = `<h2>Welcome to ${trainerOrg}</h2>
<p>${trainerOrg} was founded by ${firstName} ${lastName}, a Certified Professional Dog Trainer (CPDT-KA) and Certified Separation Anxiety Trainer (CSAT) with over fifteen years of experience. Our program is built entirely on positive reinforcement and the latest behavioral science — no shock, no prong, no force, ever.</p>
${imgs}
<h3>Our Training Programs</h3>
<ul>
  <li><strong>Puppy Foundation (8–20 weeks):</strong> Socialization, bite inhibition, basic manners, confidence building. Small group classes of 4–6 puppies.</li>
  <li><strong>Adult Obedience (6 months+):</strong> Sit, stay, come, down, leave-it, loose-leash walking. Beginner, intermediate, and advanced levels.</li>
  <li><strong>Reactive Dog Program:</strong> Structured desensitization and counter-conditioning for dogs who bark, lunge, or are fearful on leash. Private sessions and specialized small groups.</li>
  <li><strong>Separation Anxiety Protocol:</strong> CSAT-based protocol for dogs with diagnosed separation anxiety. Full assessment, treatment plan, and remote session support.</li>
  <li><strong>Trick and Sport:</strong> Agility foundations, nose work, trick training, and dog parkour. Great enrichment for high-drive dogs and sport-curious owners.</li>
  <li><strong>Service Dog Foundations:</strong> Task training and public access preparation for owner-trained service dogs. Evaluation and documentation available.</li>
</ul>
<h3>Our Approach</h3>
<p>Every dog is an individual. Our assessment process evaluates learning style, arousal threshold, social preferences, and owner lifestyle before recommending a training track. We are transparent about timelines and realistic about expectations. We do not promise miracles — we promise commitment, consistency, and a method that builds trust rather than compliance through fear.</p>
<h3>Facilities and Locations</h3>
<p>We offer training at our indoor facility near ${park}, at outdoor locations across the Denver metro area, and virtually for remote clients and maintenance sessions. We make the training environment match the real world as much as possible — because a dog who only works in a quiet studio is not prepared for real life.</p>
<h3>Community Involvement</h3>
<p>We regularly donate training scholarships to adopters from ${shelter} and partner with local rescues to provide complimentary behavior consultations for newly placed dogs. We believe that a well-trained dog is less likely to be returned or surrendered, and we put that belief into practice every day by supporting the full continuum of dog welfare in our community.</p>`;
	} else if (profileType === 'foster') {
		name = `${firstName} ${lastName} — Foster Family`;
		description = `${firstName} ${lastName} has fostered over 30 dogs in the Denver area through ${shelter} and partner rescues over the past four years. Currently hosting: ${dogName} the ${breed}. Always room for one more.`;
		body = `<h2>Meet ${firstName} ${lastName} — Experienced Foster Family</h2>
<p>Four years ago, ${firstName} said yes to fostering "just one dog" to help out during a shelter overflow. That first dog — a terrified Beagle mix named Oliver — stayed for three months and was adopted into a wonderful family. ${firstName} has not stopped fostering since. To date, ${firstName} has fostered 32 dogs through ${shelter} and two partner rescues, including bottle-baby neonates, senior dogs with medical needs, severely undersocialized dogs, and everything in between.</p>
${imgs}
<h3>Current Foster: ${dogName}</h3>
<p>${dogName} is a ${breed} who arrived two weeks ago from an overcrowded situation. On arrival: underweight, flea-infested, and shut down. Today: clean, fed, learning to trust, and beginning to show a personality that can only be described as goofy and wonderful. ${dogName} is available for adoption through our partner rescue once the behavior assessment and vet clearances are complete.</p>
<h3>What Fostering Actually Looks Like</h3>
<p>People often ask if fostering is hard. The honest answer is yes — and worth every minute of it. The hardest part is not the "foster fails" (when you adopt your own foster dog). The hardest part is the first 48 hours, when a new dog arrives scared and shut down, and you have to resist the urge to rush their healing. The most rewarding part is the moment they realize they are safe — which looks different for every dog, but is never anything less than extraordinary.</p>
<p>${firstName} currently has a dog-friendly home with a securely fenced yard and works from home, which allows for the supervision and consistency foster dogs need during the critical first weeks. The rescue team handles all vet care, supplies, and medical decisions. Foster families just need to show up with patience and love. If you are thinking about fostering, reach out through the contact form — ${firstName} is happy to answer any questions.</p>
<h3>How You Can Help</h3>
<p>The shelter system cannot function without foster homes. Right now in the Denver metro area, dozens of dogs are waiting for a foster placement so they can be pulled from high-kill shelters. If you have space in your home — even temporarily, even for just one dog — please consider reaching out to ${shelter} or any of the local rescues to learn about their foster programs. You don't need experience. You just need willingness. The rescue team handles the rest.</p>`;
	} else {
		// individual
		name = `${firstName} ${lastName} & ${dogName}`;
		description = `${firstName} is a lifelong dog lover based in Denver, CO. ${dogName} is a ${breed} rescue and the best decision ${firstName} ever made. Together they hike, volunteer, and advocate for dog welfare across the Front Range.`;
		body = `<h2>About ${firstName} ${lastName} & ${dogName}</h2>
<p>Hi! I'm ${firstName} ${lastName}, a Denver-based dog lover, amateur photographer, and passionate advocate for shelter dogs. ${dogName}, my ${breed} rescue companion, has been with me for three years and has changed my life in ways I never expected. Together we hike the Front Range trails, volunteer at ${shelter} on weekends, and try to do our small part to make Denver a better place for dogs and their families.</p>
${imgs}
<h3>${dogName}'s Story</h3>
<p>${dogName} came to me through ${shelter} after being surrendered by a family who was moving out of state. From the first meeting, there was something special about ${dogName} — a combination of quiet dignity and barely-suppressed enthusiasm that made the adoption decision easy. The first month was an adjustment: learning each other's rhythms, building trust, establishing routines. By month three, I could not imagine my home, my hikes, or my mornings without ${dogName}.</p>
<h3>What We Do Together</h3>
<ul>
  <li><strong>Hiking:</strong> We've completed 14 Front Range trail systems — ${dogName} wears a pack and carries their own water like a pro.</li>
  <li><strong>Volunteering:</strong> Weekend dog walks and socialization sessions at ${shelter}. ${dogName} has an unofficial role as "confidence model" for shy shelter dogs.</li>
  <li><strong>Training:</strong> We're currently working through an advanced nose-work course at ${trainerOrg}. ${dogName} is genuinely gifted at scent detection.</li>
  <li><strong>Community meetups:</strong> We attend the weekly dog social at ${park} and have made some of our best friendships — human and canine — through that group.</li>
</ul>
<h3>Why I'm Here</h3>
<p>I created this profile to connect with other dog owners in Colorado, share what I'm learning about canine health and behavior, and occasionally help amplify the voices of local rescues and shelters when they need support. I am not a trainer or a vet — just someone who loves dogs deeply and wants to contribute to a community that does too. If you're a fellow Front Range dog person, I'd love to connect.</p>`;
	}

	const fullHtml = _padToSize(body, 22000);
	return { name, description, html: fullHtml };
}
