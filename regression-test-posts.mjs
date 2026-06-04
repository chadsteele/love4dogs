/**
 * Post Regression Test
 *
 * Publishes a large post to Bluesky requiring 4+ chunk posts, then downloads
 * the public post thread and verifies the reconstructed payload is whole and complete.
 *
 * Prerequisites:
 *   - Dev server running: npm run dev
 *   - Bluesky credentials in .env (BSKY_USERNAME / BSKY_PASSWORD)
 *
 * Usage:
 *   node regression-test-posts.mjs [--author=<handle>] [--server=<url>] [--wait=<ms>] [--location=<query>]
 *
 * Options:
 *   --author   Bluesky handle or DID of the publishing account (default: BSKY_AUTHOR env or 'love4dogs.club')
 *   --server   Local dev server base URL (default: TEST_SERVER_URL env or 'http://localhost:5173')
 *   --wait     Milliseconds to wait for Bluesky indexing (default: 15000)
 *   --location Geocoding location parameter (default: test location)
 */

import {
	buildCombinedPayloadBundle,
	buildChunkEntriesFromBundle,
	collectChunkPayloadsFromPosts,
	reconstructBundleFromChunkPayloads,
	publishChunkBundleToBsky,
	chunkHtmlByAltPayload,
	measureChunkAltPayloadLength,
} from './src/lib/bskyChunkStore.js';
import {
	parseArgs,
	resolveTestConfig,
	createAssertions,
	generateUuid,
	createRandomTestLocation,
	findLocationLeakInText,
	fetchMultipleDogImages,
	uploadDogImageToBluesky,
	sleep,
	REGRESSION_TAG_POOL,
	pickNUniqueRandom,
	generateRealDogPostContent,
	loadRegressionProfileSeeds,
	pickRandomRegressionProfileSeed,
} from './regression-test-common.mjs';

const args = parseArgs();
const {
	baseUrl: BASE_URL,
	author: AUTHOR,
	indexWaitMs: INDEX_WAIT_MS,
	location: LOCATION,
	testMode,
} = resolveTestConfig(args);
const { pass, fail, assert, assertEqual, counts } = createAssertions();

async function fetchAuthorFeedPostsFromPublicBsky(fetchImpl, author, options = {}) {
	const actor = String(author || '').trim();
	if (!actor) return [];

	const maxPages = Math.max(1, Number(options?.maxPages || 8));
	const pageLimit = Math.max(1, Math.min(100, Number(options?.pageLimit || 100)));
	const postsByUri = new Map();
	let cursor = '';
	const publicXrpc = 'https://public.api.bsky.app/xrpc';

	for (let page = 1; page <= maxPages; page += 1) {
		const feedUrl = `${publicXrpc}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${encodeURIComponent(String(pageLimit))}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
		const response = await fetchImpl(feedUrl);
		if (!response.ok) break;

		const json = await response.json().catch(() => ({}));
		const items = Array.isArray(json?.feed) ? json.feed : [];
		const pagePosts = items
			.map((item) => (item && typeof item === 'object' ? item.post : null))
			.filter((post) => post && typeof post === 'object');

		for (const post of pagePosts) {
			const uri = String(post?.uri || '').trim();
			if (!uri || postsByUri.has(uri)) continue;
			postsByUri.set(uri, post);
		}

		const nextCursor = String(json?.cursor || '').trim();
		if (!nextCursor || items.length === 0) break;
		cursor = nextCursor;
	}

	return Array.from(postsByUri.values());
}

async function waitForCompletePostBundle({
	fetchImpl = fetch,
	author,
	uuid,
	expectedChunkCount,
	timeoutMs = 120000,
	intervalMs = 5000,
}) {
	if (!String(author || '').trim()) {
		throw new Error('Missing Bluesky author.');
	}

	const startedAt = Date.now();
	let lastError = null;
	let attempt = 0;

	while (Date.now() - startedAt < timeoutMs) {
		attempt += 1;
		try {
			const posts = await fetchAuthorFeedPostsFromPublicBsky(fetchImpl, author, {
				maxPages: 10,
				pageLimit: 100,
			});
			const payloads = collectChunkPayloadsFromPosts(posts, { uuid });
			const recoveredCount = payloads.length;
			console.log(`  Poll ${attempt}: recovered ${recoveredCount}/${expectedChunkCount} chunk payloads`);

			if (recoveredCount === expectedChunkCount) {
				const reconstructed = reconstructBundleFromChunkPayloads(payloads);
				return { posts, payloads, ...reconstructed };
			}

			lastError = new Error(`Post payload is incomplete (found ${recoveredCount}/${expectedChunkCount} chunks)`);
		} catch (error) {
			lastError = error;
			const details = error?.details ? ` ${JSON.stringify(error.details)}` : '';
			console.log(`  Poll ${attempt}: not ready yet - ${error.message || error}${details}`);
		}

		await sleep(intervalMs);
	}

	throw lastError || new Error('Timed out waiting for public Bluesky indexing.');
}

async function main() {
	console.log('');
	console.log('============================================================');
	console.log('Post Regression Test - love4dogs');
	console.log('============================================================');
	console.log('');
	console.log(`  Server : ${BASE_URL}`);
	console.log(`  Author : ${AUTHOR}`);
	console.log(`  Location parameter: ${LOCATION}`);
	console.log(`  Wait   : ${INDEX_WAIT_MS}ms`);
	console.log('');

	console.log('Step 1: Verify dev server is reachable');
	if (testMode) {
		console.log('  [TEST MODE] Skipping server check.');
	} else {
		try {
			const ping = await fetch(`${BASE_URL}/api/post?uri=at://invalid`, { method: 'GET' });
			assert(ping.status > 0, 'Dev server is reachable', `HTTP ${ping.status}`);
		} catch (err) {
			fail('Dev server is reachable', err.message);
			console.error('\n  ERROR: Is the dev server running? Try: npm run dev\n');
			process.exit(1);
		}
	}

	console.log('\nStep 2: Build and publish a large post');
	const uuid = generateUuid();
	const testLocation = await createRandomTestLocation({
		baseUrl: BASE_URL,
		location: LOCATION,
	});
	const availableProfiles = await loadRegressionProfileSeeds();
	const selectedProfile = pickRandomRegressionProfileSeed(availableProfiles);
	if (!selectedProfile) {
		fail(
			'Regression profile seed available',
			'Run regression-test-profiles.mjs first so posts can use a generated profile author.'
		);
		process.exit(1);
	}
	pass(`Using profile author seed: ${selectedProfile.authorName} (${selectedProfile.authorid})`);
	console.log(`  Location hash path: ${testLocation.hashPath}`);
	console.log(
		`  Map URL preview: ${BASE_URL}/map/${testLocation.approximate}/${testLocation.exact}`,
	);
	const dogImageUrls = await fetchMultipleDogImages(4);
	const uploadedImages = [];
	if (testMode) {
		for (const url of dogImageUrls) uploadedImages.push({ url, alt: 'Dog photo', blob: null });
		console.log('  [TEST MODE] Skipping Bluesky image upload — using raw dog.ceo URLs.');
	} else {
		for (let i = 0; i < dogImageUrls.length; i += 1) {
			const url = dogImageUrls[i];
			try {
				const uploaded = await uploadDogImageToBluesky({
					baseUrl: BASE_URL,
					imageUrl: url,
					fetchImpl: fetch,
				});
				uploadedImages.push(uploaded);
				assert(uploaded.blob && typeof uploaded.blob === 'object', `Carrier image ${i + 1}/${dogImageUrls.length} uploaded`);
			} catch (err) {
				fail(`Carrier image ${i + 1}/${dogImageUrls.length} upload`, err.message);
				process.exit(1);
			}
		}
	}
	const uploadedImageUrls = uploadedImages
		.map((entry) => String(entry?.url || '').trim())
		.filter(Boolean);
	// Pick random tags and generate realistic content driven by the primary tag
	const randomTags = pickNUniqueRandom(REGRESSION_TAG_POOL, 2);
	const allPostTags = [ 'test', ...randomTags];
	const { title, description: postDescription, html: largePostHtml } = generateRealDogPostContent(randomTags[0], allPostTags, uuid, uploadedImageUrls, testLocation);
	const primaryPayload = {
		uuid,
		authorid: selectedProfile.authorid,
		authorName: selectedProfile.authorName,
		authorAvatar: selectedProfile.authorAvatar || '',
		title,
		description: postDescription,
		address: testLocation.address,
		city: testLocation.city,
		state: testLocation.state,
		zip: testLocation.zip,
		country: testLocation.country,
		location: {
			lat: testLocation.lat,
			lon: testLocation.lon,
			approximate: testLocation.approximate,
			exact: testLocation.exact,
			hashPath: testLocation.hashPath,
			formattedAddress: testLocation.formattedAddress,
			city: testLocation.city,
			state: testLocation.state,
			country: testLocation.country,
			zip: testLocation.zip,
		},
		html: largePostHtml,
		tags: allPostTags,
	};
	const subsequentPayload = chunkHtmlByAltPayload(largePostHtml, 2000, { uuid });
	const bundle = buildCombinedPayloadBundle(primaryPayload, subsequentPayload, {
		uuid,
		maxPayloadChars: 2000,
	});
	const chunkEntries = buildChunkEntriesFromBundle(bundle);

	console.log(`  Combined JSON size      : ${bundle.combinedJson.length} chars`);
	console.log(`  Bundle fragments        : ${bundle.fragments.length}`);
	console.log(`  Chunk entries           : ${chunkEntries.length}`);
	for (const entry of chunkEntries) {
		const payloadLen = measureChunkAltPayloadLength(entry.bundleFragment, {
			uuid,
			index: entry.index,
			total: entry.total,
		});
		console.log(`    Chunk ${String(entry.index).padStart(2)} / ${entry.total}: fragment ${entry.bundleFragment.length} chars → alt payload ${payloadLen} chars`);
		assert(payloadLen <= 2000, `Chunk ${entry.index} payload within 2000-char limit`, `${payloadLen} chars`);
	}

	assert(chunkEntries.length >= 4, `At least 4 chunks required (got ${chunkEntries.length})`);
	assert(subsequentPayload.length > 0, 'Post subsequent payload is non-empty');
	assert(/<img\b/i.test(largePostHtml), 'Post HTML includes inline image tags');
	assert(
		uploadedImageUrls.every((url) => largePostHtml.includes(url)),
		'Post HTML includes uploaded image URLs',
	);
	assertEqual(primaryPayload.uuid, uuid, 'Primary payload UUID matches');
	assertEqual(primaryPayload.authorid, selectedProfile.authorid, 'Primary payload authorid matches selected profile');
	assertEqual(primaryPayload.authorName, selectedProfile.authorName, 'Primary payload authorName matches selected profile');
	assert(!primaryPayload.tags.includes('profile'), 'Primary payload does not include profile tag');
	assertEqual(uploadedImages.length, dogImageUrls.length, 'Uploaded image count matches source count');
	assertEqual(primaryPayload.state, testLocation.state, 'Primary payload state matches selected location');
	assertEqual(primaryPayload.country, testLocation.country, 'Primary payload country matches selected location');
	assert(typeof primaryPayload.zip === 'string', 'Primary payload zip is a string');
	assert(typeof primaryPayload.address === 'string' && primaryPayload.address.trim().length > 0, 'Primary payload includes address');
	assertEqual(primaryPayload.city, testLocation.city, 'Primary payload city matches selected location');
	assert(/^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/i.test(String(primaryPayload.location?.approximate || '')), 'Primary payload includes /map approximate hash');
	assert(/^[0-9bcdefghjkmnpqrstuvwxyz]{9}$/i.test(String(primaryPayload.location?.exact || '')), 'Primary payload includes /map exact hash');
	assert(
		String(primaryPayload.location?.hashPath || '') ===
			`${primaryPayload.location?.approximate}/${primaryPayload.location?.exact}`,
		'Primary payload includes /map hash path',
	);
	const locationLeakInPublishText = findLocationLeakInText(title, testLocation);
	assert(!locationLeakInPublishText, 'Publish text excludes location data', locationLeakInPublishText);
	if (testMode) {
		console.log('\n[TEST MODE] Post payload that would be published:');
		console.log(JSON.stringify({
			postText: title,
			tags: primaryPayload.tags,
			chunkCount: chunkEntries.length,
			chunkSizes: chunkEntries.map((e) => e.bundleFragment.length),
			primaryPayload,
		}, null, 2));
		process.exit(0);
	}


	let publishResult;
	try {
		publishResult = await publishChunkBundleToBsky({
			fetchImpl: fetch,
			endpoint: `${BASE_URL}/api/post`,
			uuid,
			tags: primaryPayload.tags,
			postText: title,
			primaryPayload,
			chunks: chunkEntries,
			primaryMedia: uploadedImages.map((img) => ({
				kind: 'image',
				alt: img.alt,
				blob: img.blob,
			})),
			replyAttachmentPool: [],
			videoAttachments: [],
		});
		pass('Published large post to Bluesky');
	} catch (err) {
		fail('Publish large post', err.message);
		console.error('\n  Publish error:', err);
		process.exit(1);
	}

	const originUri = publishResult?.originResult?.uri || publishResult?.primaryResult?.uri || '';
	assert(typeof originUri === 'string' && originUri.startsWith('at://'), `Origin post URI: ${originUri}`);
	assert(Array.isArray(publishResult?.chunkResults) && publishResult.chunkResults.length > 0, `Chunk posts created: ${publishResult?.chunkResults?.length}`);
	assertEqual(publishResult.chunkCount, chunkEntries.length, `chunkCount matches fragment count (${chunkEntries.length})`);
	assertEqual(publishResult.chunkResults.length, Math.ceil(chunkEntries.length / 4), `Expected ${Math.ceil(chunkEntries.length / 4)} chunk post(s) for ${chunkEntries.length} chunk entries`);

	console.log('');
	console.log('  Published URIs:');
	console.log(`    Origin : ${originUri}`);
	for (let i = 0; i < publishResult.chunkResults.length; i += 1) {
		const uri = publishResult.chunkResults[i]?.uri || '(no uri)';
		console.log(`    Chunk post ${i + 1}: ${uri}`);
	}

	console.log(`\nStep 3: Waiting ${INDEX_WAIT_MS / 1000}s before polling public Bluesky...`);
	await sleep(INDEX_WAIT_MS);
	pass(`Waited ${INDEX_WAIT_MS}ms`);

	console.log('\nStep 4: Download thread and reconstruct bundle from public Bluesky');
	let loaded;
	try {
		loaded = await waitForCompletePostBundle({
			fetchImpl: fetch,
			author: AUTHOR,
			uuid,
			expectedChunkCount: chunkEntries.length,
			timeoutMs: Math.max(INDEX_WAIT_MS * 8, 120000),
			intervalMs: 5000,
		});
	} catch (err) {
		fail('Reconstruct post bundle', err.message);
		if (err.details) console.error('  Details:', JSON.stringify(err.details, null, 2));
		console.error('\n  Tip: Try increasing --wait or rerun later if public indexing is delayed.\n');
		process.exit(1);
	}

	assert(loaded !== null && typeof loaded === 'object', 'Post bundle loaded');
	assert(typeof loaded.combinedJson === 'string' && loaded.combinedJson.length > 0, 'combinedJson is non-empty');
	assert(Array.isArray(loaded.fragments) && loaded.fragments.length > 0, 'Fragments list is non-empty');
	assert(Array.isArray(loaded.payloads), 'Payloads list present');

	console.log(`  Payloads recovered   : ${loaded.payloads.length}`);
	console.log(`  Fragments recovered  : ${loaded.fragments.length}`);
	console.log(`  combinedJson length  : ${loaded.combinedJson.length} chars`);

	console.log('\nStep 5: Verify chunk count and reconstructed payload');
	assertEqual(loaded.payloads.length, chunkEntries.length, `Recovered ${loaded.payloads.length} chunk payloads (expected ${chunkEntries.length})`);
	assertEqual(loaded.combinedJson, bundle.combinedJson, 'Reconstructed JSON matches original exactly');
	const reconstructedParsed = JSON.parse(loaded.combinedJson);
	const reconstructedPrimary = reconstructedParsed?.primary || {};
	// primary.html is intentionally omitted from the combined JSON (html lives in subsequent chunks).
	// Validate HTML presence via subsequent instead.
	const reconstructedHtml = Array.isArray(reconstructedParsed?.subsequent)
		? reconstructedParsed.subsequent.join('')
		: '';
	assert(/<img\b/i.test(reconstructedHtml), 'Reconstructed subsequent HTML includes inline image tags');
	let allUploadedUrlsPresentInPrimaryHtml = true;
	for (const url of uploadedImageUrls) {
		if (!reconstructedHtml.includes(url)) {
			allUploadedUrlsPresentInPrimaryHtml = false;
			fail(`Uploaded image URL present in reconstructed subsequent HTML: ${url.slice(0, 60)}...`);
		}
	}
	if (allUploadedUrlsPresentInPrimaryHtml) {
		pass('All uploaded image URLs present in reconstructed subsequent HTML');
	}

	const recoveredTexts = (Array.isArray(loaded.posts) ? loaded.posts : [])
		.map((post) => String(post?.record?.text || ''))
		.filter(Boolean);
	const leakedRecoveredText = recoveredTexts.find((text) =>
		Boolean(findLocationLeakInText(text, testLocation))
	);
	assert(!leakedRecoveredText, 'Recovered post texts exclude location data', leakedRecoveredText || '');

	console.log('');
	console.log('============================================================');
	const summary = counts();
	console.log(`Test complete: ${summary.passed} passed, ${summary.failed} failed`);
	console.log('============================================================');
	console.log('');

	process.exit(counts().failed > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('Unexpected error:', err);
	process.exit(1);
});