/**
 * Chunk Regression Test
 *
 * Publishes a large profile to Bluesky requiring 4+ chunk posts, then downloads
 * the manifest and all chunks and verifies the reconstructed payload is whole and complete.
 *
 * Prerequisites:
 *   - Dev server running: npm run dev
 *   - Bluesky credentials in .env (BSKY_USERNAME / BSKY_PASSWORD)
 *
 * Usage:
 *   node regression-test.mjs [--author=<handle>] [--server=<url>] [--wait=<ms>]
 *
 * Options:
 *   --author   Bluesky handle or DID of the publishing account (default: BSKY_AUTHOR env or 'love4dogs.club')
 *   --server   Local dev server base URL (default: TEST_SERVER_URL env or 'http://localhost:5173')
 *   --wait     Milliseconds to wait for Bluesky indexing (default: 15000)
 */

import {
	buildCombinedPayloadBundle,
	buildChunkEntriesFromBundle,
	publishChunkBundleToBsky,
	loadMostRecentProfileBundleFromPublicBsky,
	chunkHtmlByAltPayload,
	measureChunkAltPayloadLength,
} from './src/lib/bskyChunkStore.js';
import {
	parseArgs,
	resolveTestConfig,
	createAssertions,
	generateUuid,
	createRandomColoradoLocation,
	findLocationLeakInText,
	fetchMultipleDogImages,
	uploadDogImageToBluesky,
	sleep,
	REGRESSION_TAG_POOL,
	pickNUniqueRandom,
	generateRealProfileContent,
} from './regression-test-common.mjs';

const args = parseArgs();
const {
	baseUrl: BASE_URL,
	author: AUTHOR,
	indexWaitMs: INDEX_WAIT_MS,
	testMode,
} = resolveTestConfig(args);
const { pass, fail, assert, assertEqual, counts } = createAssertions();

// ---------------------------------------------------------------------------
// Build a large profile HTML content for subsequent payload
// (must be large enough to force 4+ chunks)
// ---------------------------------------------------------------------------

async function waitForCompleteProfileBundle({
	fetchImpl = fetch,
	uuid,
	author,
	expectedChunkCount,
	timeoutMs = 120000,
	intervalMs = 5000,
}) {
	const startedAt = Date.now();
	let lastError = null;
	let attempt = 0;

	while (Date.now() - startedAt < timeoutMs) {
		attempt += 1;
		try {
			const loaded = await loadMostRecentProfileBundleFromPublicBsky({
				fetchImpl,
				uuid,
				author,
				debug: false,
				maxPages: 10,
				pageLimit: 100,
			});

			const recoveredCount = Array.isArray(loaded?.payloads) ? loaded.payloads.length : 0;
			console.log(
				`  Poll ${attempt}: recovered ${recoveredCount}/${expectedChunkCount} chunk payloads`
			);

			if (recoveredCount === expectedChunkCount) {
				return loaded;
			}

			lastError = new Error(
				`Profile payload is incomplete (found ${recoveredCount}/${expectedChunkCount} chunks)`
			);
		} catch (error) {
			lastError = error;
			const details = error?.details
				? ` ${JSON.stringify(error.details)}`
				: '';
			console.log(`  Poll ${attempt}: not ready yet - ${error.message || error}${details}`);
		}

		await sleep(intervalMs);
	}

	throw lastError || new Error('Timed out waiting for public Bluesky indexing.');
}

// ---------------------------------------------------------------------------
// Main regression test
// ---------------------------------------------------------------------------

async function main() {
	console.log('');
	console.log('============================================================');
	console.log('Chunk Regression Test - love4dogs');
	console.log('============================================================');
	console.log('');
	console.log(`  Server : ${BASE_URL}`);
	console.log(`  Author : ${AUTHOR}`);
	console.log(`  Wait   : ${INDEX_WAIT_MS}ms`);
	console.log('');

	// ─── Step 1: Verify dev server is reachable ──────────────────────────────
	console.log('Step 1: Verify dev server is reachable');
	if (testMode) {
		console.log('  [TEST MODE] Skipping server check.');
	} else {
		try {
			const ping = await fetch(`${BASE_URL}/api/post?uri=at://invalid`, { method: 'GET' });
			// We expect a 400 (invalid URI), not a connection error
			assert(ping.status > 0, 'Dev server is reachable', `HTTP ${ping.status}`);
		} catch (err) {
			fail('Dev server is reachable', err.message);
			console.error('\n  ERROR: Is the dev server running? Try: npm run dev\n');
			process.exit(1);
		}
	}

	// ─── Step 2: Fetch random dog images ─────────────────────────────────────
	console.log('\nStep 2: Fetch 4 random dog images from dog.ceo');
	const IMAGE_COUNT = 4;
	let dogImageUrls;
	try {
		dogImageUrls = await fetchMultipleDogImages(IMAGE_COUNT);
		assert(dogImageUrls.length === IMAGE_COUNT, `Fetched ${IMAGE_COUNT} dog image URLs`);
		for (const url of dogImageUrls) {
			assert(url.startsWith('https://'), `URL is HTTPS: ${url.slice(0, 60)}...`);
		}
	} catch (err) {
		fail('Fetch dog images', err.message);
		process.exit(1);
	}

	// ─── Step 3: Upload images to Bluesky via local server ───────────────────
	console.log('\nStep 3: Upload images to Bluesky via local server');
	const uploadedImages = [];
	if (testMode) {
		for (const url of dogImageUrls) uploadedImages.push({ url, alt: 'Dog photo', blob: null });
		console.log('  [TEST MODE] Skipping Bluesky image upload — using raw dog.ceo URLs.');
	} else {
		for (let i = 0; i < dogImageUrls.length; i++) {
			const url = dogImageUrls[i];
			try {
				const uploaded = await uploadDogImageToBluesky({
					baseUrl: BASE_URL,
					imageUrl: url,
					fetchImpl: fetch,
				});
				uploadedImages.push(uploaded);
				assert(
					uploaded.blob && typeof uploaded.blob === 'object',
					`Image ${i + 1}/${IMAGE_COUNT} uploaded: ${url.slice(0, 55)}...`
				);
			} catch (err) {
				fail(`Image ${i + 1}/${IMAGE_COUNT} upload`, err.message);
				process.exit(1);
			}
		}
	}

	// ─── Step 4: Build large profile payload ─────────────────────────────────
	console.log('\nStep 4: Build large profile payload');
	const uuid = generateUuid();
	const coloradoLocation = createRandomColoradoLocation();
	console.log(`  UUID: ${uuid}`);
	console.log(`  Location hash path: ${coloradoLocation.hashPath}`);
	console.log(
		`  Map URL preview: ${BASE_URL}/map/${coloradoLocation.approximate}/${coloradoLocation.exact}`,
	);

	// Pick random tags and generate realistic profile content driven by primary tag
	const randomTags = pickNUniqueRandom(REGRESSION_TAG_POOL, 2);
	const { name: profileName, description: profileDescription, html: contentHtml } = generateRealProfileContent(randomTags[0], randomTags, uuid, dogImageUrls);
	// Always include 'profile', lowercase, unique
	const tags = ['profile',  'test', ...randomTags]
		       .map((t) => String(t).toLowerCase().trim())
		       .filter(Boolean);
	       const uniqueTags = Array.from(new Set(tags));
	       const primaryPayload = {
		       uuid,
		       authorid: `author-${uuid}`,
		       stamp: Date.now().toString(36),
		       canonicalurl: `https://love4dogs.club/profile/view/${uuid}`,
		       title: profileName,
		       description: profileDescription,
		       address: coloradoLocation.address,
		       city: coloradoLocation.city,
		       state: coloradoLocation.state,
		       zip: coloradoLocation.zip,
		       country: coloradoLocation.country,
		       location: {
			       lat: coloradoLocation.lat,
			       lon: coloradoLocation.lon,
			       approximate: coloradoLocation.approximate,
			       exact: coloradoLocation.exact,
			       hashPath: coloradoLocation.hashPath,
			       formattedAddress: coloradoLocation.formattedAddress,
			       city: coloradoLocation.city,
			       state: coloradoLocation.state,
			       country: coloradoLocation.country,
			       zip: coloradoLocation.zip,
		       },
		       profilePic: uploadedImages[0]?.url || null,
		       backgroundPic: uploadedImages[1]?.url || null,
		       html: contentHtml,
		       tags: uniqueTags,
	       };
	console.log(`  Raw HTML content size: ${contentHtml.length} chars`);

	// Split HTML content into subsequent payload chunks the same way the UI does
	const subsequentPayload = chunkHtmlByAltPayload(contentHtml, 2000, { uuid });
	console.log(`  Subsequent payload fragments (from HTML chunker): ${subsequentPayload.length}`);

	assert(typeof primaryPayload.uuid === 'string', 'Primary payload has uuid');
	assert(primaryPayload.tags.includes('profile'), 'Primary payload includes profile tag');
	assert(primaryPayload.tags.every((t) => typeof t === 'string' && t === t.toLowerCase()), 'All tags are lowercase');
	assert(typeof primaryPayload.title === 'string', 'Primary payload has title');
	assertEqual(primaryPayload.state, 'CO', 'Primary payload state is Colorado');
	assertEqual(primaryPayload.country, 'USA', 'Primary payload country is USA');
	assert(/^[0-9]{5}$/.test(String(primaryPayload.zip || '')), 'Primary payload zip is 5 digits');
	assert(typeof primaryPayload.address === 'string' && primaryPayload.address.length > 0, 'Primary payload includes address');
	assert(typeof primaryPayload.city === 'string' && primaryPayload.city.length > 0, 'Primary payload includes city');
	assert(/^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/i.test(String(primaryPayload.location?.approximate || '')), 'Primary payload includes /map approximate hash');
	assert(/^[0-9bcdefghjkmnpqrstuvwxyz]{9}$/i.test(String(primaryPayload.location?.exact || '')), 'Primary payload includes /map exact hash');
	assert(
		String(primaryPayload.location?.hashPath || '') ===
			`${primaryPayload.location?.approximate}/${primaryPayload.location?.exact}`,
		'Primary payload includes /map hash path',
	);
	assert(subsequentPayload.length > 0, 'Subsequent payload is non-empty');

	// ─── Step 5: Build combined bundle and verify 4+ chunk entries ───────────
	console.log('\nStep 5: Build combined bundle — verify 4+ chunks required');
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
	}

	assert(chunkEntries.length >= 4, `At least 4 chunks required (got ${chunkEntries.length})`);

	if (chunkEntries.length < 4) {
		console.error('\n  FATAL: Profile is too small to generate 4+ chunks. Increase content size.\n');
		process.exit(1);
	}

	// Verify all chunk alt payloads are within the 2000-char limit
	let allWithinLimit = true;
	for (const entry of chunkEntries) {
		const payloadLen = measureChunkAltPayloadLength(entry.bundleFragment, {
			uuid,
			index: entry.index,
			total: entry.total,
		});
		if (payloadLen > 2000) {
			allWithinLimit = false;
			fail(`Chunk ${entry.index} payload within 2000-char limit`, `${payloadLen} chars`);
		}
	}
	if (allWithinLimit) pass('All chunk alt payloads within 2000-char limit');

	// ─── Step 6: Publish chunk bundle to Bluesky ─────────────────────────────
	console.log('\nStep 6: Publish chunk bundle to Bluesky');
	if (testMode) {
		console.log('\n[TEST MODE] Profile payload that would be published:');
		console.log(JSON.stringify({
			postText: [profileName, profileDescription.slice(0, 80)].filter(Boolean).join('\n').slice(0, 295),
			tags: uniqueTags,
			chunkCount: chunkEntries.length,
			chunkSizes: chunkEntries.map((e) => e.bundleFragment.length),
			primaryPayload,
		}, null, 2));
		process.exit(0);
	}

	const postText = [profileName, profileDescription.slice(0, 80)]
		.filter(Boolean)
		.join('\n')
		.slice(0, 295);
	const locationLeakInPublishText = findLocationLeakInText(postText, coloradoLocation);
	assert(!locationLeakInPublishText, 'Publish text excludes location data', locationLeakInPublishText);

	let publishResult;
	       try {
		       publishResult = await publishChunkBundleToBsky({
			       fetchImpl: fetch,
			       endpoint: `${BASE_URL}/api/post`,
			       uuid,
			       tags: uniqueTags,
			       postText,
			       primaryPayload: { ...primaryPayload, tags: uniqueTags },
			       chunks: chunkEntries,
			       primaryMedia: uploadedImages.map((img) => ({
				       kind: 'image',
				       alt: img.alt,
				       blob: img.blob,
			       })),
			       replyAttachmentPool: [],
			       videoAttachments: [],
		       });
	       } catch (err) {
		fail('publishChunkBundleToBsky', err.message);
		console.error('\n  Publish error:', err);
		process.exit(1);
	}

	const originUri = publishResult?.originResult?.uri || publishResult?.primaryResult?.uri || '';
	assert(typeof originUri === 'string' && originUri.startsWith('at://'), `Origin post URI: ${originUri}`);
	assert(
		Array.isArray(publishResult?.chunkResults) && publishResult.chunkResults.length > 0,
		`Chunk posts created: ${publishResult?.chunkResults?.length}`
	);
	assert(publishResult.chunkCount >= 4, `chunkCount >= 4 (got ${publishResult.chunkCount})`);

	const expectedChunkPosts = Math.ceil(chunkEntries.length / 4);
	assertEqual(
		publishResult.chunkResults.length,
		expectedChunkPosts,
		`Expected ${expectedChunkPosts} chunk post(s) for ${chunkEntries.length} chunk entries`
	);

	console.log('');
	console.log('  Published URIs:');
	console.log(`    Origin : ${originUri}`);
	for (let i = 0; i < publishResult.chunkResults.length; i++) {
		const uri = publishResult.chunkResults[i]?.uri || '(no uri)';
		console.log(`    Chunk post ${i + 1}: ${uri}`);
	}

	// ─── Step 7: Wait for Bluesky indexing ───────────────────────────────────
	console.log(`\nStep 7: Waiting ${INDEX_WAIT_MS / 1000}s before polling public Bluesky...`);
	await sleep(INDEX_WAIT_MS);
	pass(`Waited ${INDEX_WAIT_MS}ms`);

	// ─── Step 8: Download from public Bluesky ────────────────────────────────
	console.log('\nStep 8: Download manifest and chunks from public Bluesky');
	let loaded;
	try {
		loaded = await waitForCompleteProfileBundle({
			fetchImpl: fetch,
			uuid,
			author: AUTHOR,
			expectedChunkCount: chunkEntries.length,
			timeoutMs: Math.max(INDEX_WAIT_MS * 8, 120000),
			intervalMs: 5000,
		});
	} catch (err) {
		fail('loadMostRecentProfileBundleFromPublicBsky', err.message);
		if (err.details) console.error('  Details:', JSON.stringify(err.details, null, 2));
		console.error('\n  Tip: Try increasing --wait or rerun later if public indexing is delayed.\n');
		process.exit(1);
	}

	assert(loaded !== null && typeof loaded === 'object', 'Profile bundle loaded');
	assert(typeof loaded.combinedJson === 'string' && loaded.combinedJson.length > 0, 'combinedJson is non-empty');
	assert(Array.isArray(loaded.fragments) && loaded.fragments.length > 0, 'Fragments list is non-empty');
	assert(Array.isArray(loaded.payloads), 'Payloads list present');

	const reconstructedChunkCount = loaded.payloads.length;
	console.log(`  Payloads recovered   : ${reconstructedChunkCount}`);
	console.log(`  Fragments recovered  : ${loaded.fragments.length}`);
	console.log(`  combinedJson length  : ${loaded.combinedJson.length} chars`);

	const recoveredTexts = (Array.isArray(loaded.posts) ? loaded.posts : [])
		.map((post) => String(post?.record?.text || ''))
		.filter(Boolean);
	const leakedRecoveredText = recoveredTexts.find((text) =>
		Boolean(findLocationLeakInText(text, coloradoLocation))
	);
	assert(!leakedRecoveredText, 'Recovered post texts exclude location data', leakedRecoveredText || '');

	// ─── Step 9: Verify chunk count matches ──────────────────────────────────
	console.log('\nStep 9: Verify chunk count');
	assert(
		reconstructedChunkCount === chunkEntries.length,
		`Recovered ${reconstructedChunkCount} chunk payloads (expected ${chunkEntries.length})`
	);

	// ─── Step 10: Verify reconstructed payload matches original ──────────────
	console.log('\nStep 10: Verify reconstructed payload is whole and complete');

	// Parse both sides
	let originalParsed, reconstructedParsed;
	try {
		originalParsed = JSON.parse(bundle.combinedJson);
	} catch (err) {
		fail('Original bundle.combinedJson is valid JSON', err.message);
		process.exit(1);
	}
	try {
		reconstructedParsed = JSON.parse(loaded.combinedJson);
	} catch (err) {
		fail('Reconstructed combinedJson is valid JSON', err.message);
		process.exit(1);
	}

	pass('Both original and reconstructed are valid JSON');

	// Compare structure
	const origStr = JSON.stringify(originalParsed);
	const reconStr = JSON.stringify(reconstructedParsed);
	assert(origStr === reconStr, 'Reconstructed JSON matches original exactly');

	// Deep-dive field checks on the primary payload
	const recoPrimary = reconstructedParsed?.primary;
	assertEqual(recoPrimary?.uuid, uuid, 'primary.uuid matches');
	assertEqual(recoPrimary?.title, profileName, 'primary.title matches');
	assert(typeof recoPrimary?.description === 'string' && recoPrimary.description.length > 0, 'primary.description present and non-empty');
	assert(recoPrimary?.canonicalurl?.includes(uuid), 'primary.canonicalurl contains UUID');
	assert(Array.isArray(recoPrimary?.tags) && recoPrimary.tags.includes('profile'), 'primary.tags includes profile');
	assertEqual(recoPrimary?.state, 'CO', 'primary.state is Colorado');
	assertEqual(recoPrimary?.country, 'USA', 'primary.country is USA');
	assert(/^[0-9]{5}$/.test(String(recoPrimary?.zip || '')), 'primary.zip is 5 digits');
	assert(typeof recoPrimary?.address === 'string' && recoPrimary.address.length > 0, 'primary.address present');
	assert(typeof recoPrimary?.city === 'string' && recoPrimary.city.length > 0, 'primary.city present');
	assert(/^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/i.test(String(recoPrimary?.location?.approximate || '')), 'primary.location.approximate present');
	assert(/^[0-9bcdefghjkmnpqrstuvwxyz]{9}$/i.test(String(recoPrimary?.location?.exact || '')), 'primary.location.exact present');
	assert(
		String(recoPrimary?.location?.hashPath || '') ===
			`${recoPrimary?.location?.approximate}/${recoPrimary?.location?.exact}`,
		'primary.location.hashPath matches approximate/exact',
	);

	// Verify all subsequent fragments are present and join correctly
	const recoSubsequent = reconstructedParsed?.subsequent;
	assert(Array.isArray(recoSubsequent), 'subsequent is an array');
	assert(
		Array.isArray(recoSubsequent) && recoSubsequent.length === subsequentPayload.length,
		`subsequent has ${recoSubsequent?.length} fragments (expected ${subsequentPayload.length})`
	);

	// Verify the reconstructed HTML round-trips correctly
	if (Array.isArray(recoSubsequent)) {
		const reconstructedHtml = recoSubsequent.join('');
		const originalHtml = subsequentPayload.join('');
		assert(reconstructedHtml === originalHtml, 'Reconstructed HTML content matches original');
		assert(
			!String(reconstructedHtml).includes(String(recoPrimary?.profilePic || '')),
			'Reconstructed HTML excludes profilePic URL',
		);
		assert(
			!String(reconstructedHtml).includes(String(recoPrimary?.backgroundPic || '')),
			'Reconstructed HTML excludes backgroundPic URL',
		);
		// Spot-check: all dog image URLs present in reconstructed HTML
		let allUrlsPresent = true;
		for (const url of dogImageUrls) {
			if (!reconstructedHtml.includes(url)) {
				allUrlsPresent = false;
				fail(`Dog image URL present in reconstructed HTML: ${url.slice(0, 60)}...`);
			}
		}
		if (allUrlsPresent) pass('All dog image URLs present in reconstructed HTML');
	}

	// ─── Summary ─────────────────────────────────────────────────────────────
	console.log('');
	console.log('============================================================');
	if (counts().failed === 0) {
		console.log('ALL TESTS PASSED');
	} else {
		const summary = counts();
		console.log(`${summary.failed} TEST(S) FAILED, ${summary.passed} PASSED`);
	}
	console.log('============================================================');
	console.log('');
	console.log(`  UUID         : ${uuid}`);
	console.log(`  Origin URI   : ${originUri}`);
	console.log(`  Chunks       : ${chunkEntries.length} (across ${publishResult?.chunkResults?.length} post(s))`);
	const summary = counts();
	console.log(`  Total checks : ${summary.total} (${summary.passed} passed, ${summary.failed} failed)`);
	console.log('');

	if (counts().failed > 0) process.exit(1);
}

main().catch((err) => {
	console.error('\nFATAL UNHANDLED ERROR:', err);
	process.exit(1);
});
