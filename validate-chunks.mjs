#!/usr/bin/env node
/**
 * Validate published chunks via public Bluesky API
 * Fetches the origin post manifest, then fetches each chunk and reconstructs the bundle
 */

import { reconstructBundleFromChunkPayloads } from './src/lib/bskyChunkStore.js';

const PDS = 'https://jellybaby.us-east.host.bsky.network';
const PUBLIC_API = 'https://public.api.bsky.app/xrpc';
const DID = 'did:plc:7j7gndbgvrxvtmeqxiesbrgm';

/**
 * Fetch a post via public API
 */
async function fetchPost(uri) {
	const match = uri.match(/at:\/\/([^/]+)\/([^/]+)\/(.+)/);
	if (!match) throw new Error(`Invalid URI: ${uri}`);
	const [, did, collectionId, rkey] = match;

	const url = `${PUBLIC_API}/com.atproto.repo.getRecord?repo=${did}&collection=${collectionId}&rkey=${rkey}`;
	const resp = await fetch(url);
	if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status} ${resp.statusText}`);
	const data = await resp.json();
	return data.value;
}

/**
 * Parse chunk payload from post image alt text
 */
function parseChunkPayload(post) {
	const record = post.record || post;
	if (!record.embed?.images?.length) return null;

	for (const img of record.embed.images) {
		if (!img.alt) continue;
		try {
			const payload = JSON.parse(img.alt);
			if (payload.h && payload.i !== undefined) {
				return payload;
			}
		} catch (e) {
			// Not a chunk payload
		}
	}
	return null;
}

/**
 * Parse manifest from post image alt text
 */
function parseManifest(post) {
	const record = post.record || post;
	if (!record.embed?.images?.length) return null;

	for (const img of record.embed.images) {
		if (!img.alt) continue;
		try {
			const payload = JSON.parse(img.alt);
			if (payload.primary && payload.chunks && typeof payload.chunks === 'string') {
				return payload;
			}
		} catch (e) {
			// Not a manifest
		}
	}
	return null;
}

/**
 * Main validation
 */
async function validate() {
	console.log('========== Chunk Validation via Public API ==========\n');

	// Get the origin post from the test (hardcoded for now, from test output)
	const originUri = 'at://did:plc:7j7gndbgvrxvtmeqxiesbrgm/app.bsky.feed.post/3mnc6ug2sl623';

	console.log(`Fetching origin post: ${originUri}\n`);
	let originPost;
	try {
		originPost = await fetchPost(originUri);
	} catch (err) {
		console.error(`Failed to fetch origin: ${err.message}`);
		process.exit(1);
	}

	// Parse manifest
	const manifest = parseManifest(originPost);
	if (!manifest) {
		console.error('No manifest found in origin post image alt');
		process.exit(1);
	}

	console.log(`✓ Manifest found`);
	console.log(`  UUID: ${manifest.u}`);
	console.log(`  Primary keys: ${Object.keys(manifest.primary).sort().join(', ')}`);
	console.log(`  Primary HTML present: ${manifest.primary.html ? 'YES (BUG!)' : 'NO (correct)'}\n`);

	// Parse chunk URIs from manifest
	const chunkUris = manifest.chunks
		.split('\n')
		.map(line => line.replace(/^\d+\.\s*/, '').trim())
		.filter(Boolean);

	console.log(`Fetching ${chunkUris.length} chunk posts...\n`);

	const chunkPayloads = [];
	for (let i = 0; i < chunkUris.length; i++) {
		const uri = chunkUris[i];
		try {
			const post = await fetchPost(uri);
			const payload = parseChunkPayload(post);
			if (!payload) {
				console.error(`  Chunk ${i+1}: No payload found`);
				continue;
			}
			chunkPayloads.push(payload);
			const payloadSize = JSON.stringify(payload).length;
			console.log(`  ✓ Chunk ${i+1}/${chunkUris.length}: index ${payload.i}, size ${payloadSize} bytes, content ${payload.h.length} chars`);
		} catch (err) {
			console.error(`  ✗ Chunk ${i+1}: ${err.message}`);
		}
	}

	console.log(`\nRecovered ${chunkPayloads.length}/${chunkUris.length} chunk payloads\n`);

	// Reconstruct bundle
	console.log('Reconstructing bundle...');
	try {
		const bundle = reconstructBundleFromChunkPayloads(chunkPayloads);
		const reconstructed = JSON.parse(bundle.combinedJson);

		console.log(`✓ Bundle reconstructed`);
		console.log(`  Combined JSON size: ${bundle.combinedJson.length} bytes`);
		console.log(`  Reconstructed primary keys: ${Object.keys(reconstructed.primary).sort().join(', ')}`);
		console.log(`  Reconstructed primary HTML present: ${reconstructed.primary.html ? 'YES (BUG!)' : 'NO (correct)'}`);
		console.log(`  Subsequent fragments: ${reconstructed.subsequent.length}`);

		// Verify primary matches manifest
		const primaryMatch = JSON.stringify(manifest.primary) === JSON.stringify(reconstructed.primary);
		console.log(`  Primary matches manifest: ${primaryMatch ? '✓ YES' : '✗ NO'}`);

		// Show chunk size distribution
		console.log(`\nChunk payload sizes:`);
		chunkPayloads.forEach((p, i) => {
			const size = JSON.stringify(p).length;
			const contentSize = p.h.length;
			console.log(`  Chunk ${i+1}: ${size} bytes (content: ${contentSize} chars)`);
		});

		console.log('\n========== ✓ VALIDATION PASSED ==========');
	} catch (err) {
		console.error(`✗ Reconstruction failed: ${err.message}`);
		process.exit(1);
	}
}

validate().catch(console.error);
