#!/usr/bin/env node
/**
 * Debug manifest structure
 */

import { loadMostRecentProfileBundleFromPublicBsky } from './src/lib/bskyChunkStore.js';

const uuid = 'i3b1cx7l2dfw';
const author = 'did:plc:7j7gndbgvrxvtmeqxiesbrgm';

async function debug() {
	console.log(`Loading bundle for UUID ${uuid}...\n`);

	try {
		const result = await loadMostRecentProfileBundleFromPublicBsky({
			fetchImpl: fetch,
			uuid,
			author,
		});

		console.log('Bundle loaded!');
		console.log(`  Combined JSON size: ${result.combinedJson.length} bytes`);
		console.log(`  Payloads: ${result.payloads.length}`);
		console.log(`  Fragments: ${result.fragments.length}`);

		const parsed = JSON.parse(result.combinedJson);
		console.log(`\nReconstructed data:`);
		console.log(`  Primary keys: ${Object.keys(parsed.primary).sort().join(', ')}`);
		console.log(`  Subsequent fragments: ${parsed.subsequent.length}`);
		console.log(`  Primary has HTML: ${parsed.primary.html ? 'YES' : 'NO'}`);

		console.log('\n✓ SUCCESS');
	} catch (err) {
		console.error(`✗ Error: ${err.message}`);
		console.error(err.stack);
	}
}

debug();
