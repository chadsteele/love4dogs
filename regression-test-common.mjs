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
