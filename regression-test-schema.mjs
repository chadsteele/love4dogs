import {createAssertions} from './regression-test-common.mjs';
import {
	BlueskySchemaRecord,
	getOrCreateSharedAuthorId,
	normalizeSchemaTags,
	isProfileSchemaRecord,
	PROFILE_TAG,
} from './src/lib/schema.js';
import {
	extractPostTypeFromTags,
	upsertTypeTag,
} from './src/lib/postTypeTags.js';
import { setPost, getPost } from './src/lib/db.js';
import { formatDisplayAddress } from './src/lib/addressFormat.js';

const {assert, assertEqual, counts} = createAssertions();

function createLocalStorageStub() {
	const store = new Map();
	return {
		getItem(key) {
			return store.has(key) ? store.get(key) : null;
		},
		setItem(key, value) {
			store.set(String(key), String(value));
		},
		removeItem(key) {
			store.delete(String(key));
		},
		clear() {
			store.clear();
		},
	};
}

function runSchemaTests() {
	const record = new BlueskySchemaRecord({
		uuid: 'abc123',
		authorid: 'shared-author',
		stamp: 'stamp1',
		title: 'Profile Title',
		description: 'Profile description',
		html: '<p>Hello</p>',
		tags: ['profile', 'Urgent', 'profile'],
	});

	assert(record.isProfile(), 'Schema record treats profile tag as profile identity');
	const json = record.toJSON();
	assertEqual(json.title, 'Profile Title', 'Schema JSON preserves title');
	assert(Array.isArray(json.tags), 'Schema JSON includes tags array');
	assert(json.tags.includes(PROFILE_TAG), 'Schema JSON includes profile tag');
	assertEqual(json.name, 'Profile Title', 'Schema JSON includes compatibility name alias');

	const normalized = normalizeSchemaTags(['Profile', 'event']);
	assert(normalized.includes('profile'), 'normalizeSchemaTags normalizes profile tag');
	assert(isProfileSchemaRecord({tags: normalized}), 'isProfileSchemaRecord detects profile tag');
	assert(!isProfileSchemaRecord({tags: ['event']}), 'isProfileSchemaRecord false when no profile tag');
}

function runPostTypeTagCompatibilityTests() {
	const profileTags = upsertTypeTag(['event'], 'profile');
	assert(profileTags.includes('profile'), 'upsertTypeTag(profile) appends profile tag');
	assertEqual(extractPostTypeFromTags(profileTags), 'profile', 'extractPostTypeFromTags recognizes profile tag');

	const postTags = upsertTypeTag(['event'], 'post');
	assertEqual(extractPostTypeFromTags(postTags), '', 'extractPostTypeFromTags returns empty for non-profile tags');
}

function runSharedAuthorIdTests() {
	const originalLocalStorage = globalThis.localStorage;
	globalThis.localStorage = createLocalStorageStub();

	try {
		const first = getOrCreateSharedAuthorId('seed-author');
		const second = getOrCreateSharedAuthorId('different-seed');
		assertEqual(first, 'seed-author', 'First shared author id uses provided seed when empty');
		assertEqual(second, first, 'Shared author id remains stable across calls');
	} finally {
		if (originalLocalStorage === undefined) {
			delete globalThis.localStorage;
		} else {
			globalThis.localStorage = originalLocalStorage;
		}
	}
}

async function runDatabaseProxyTests() {
	// Create a nested target object
	const target = {
		uuid: 'test-uuid-proxy',
		title: 'Proxy Post',
		tags: ['test', 'proxy'],
		nested: {
			value: 'deep-value',
			arr: [1, 2, 3]
		}
	};

	// Create a Proxy wrapping the target, tracking if proxy getters are used
	const handler = {
		get(t, prop) {
			if (prop === '__isProxy') return true;
			if (typeof t[prop] === 'object' && t[prop] !== null) {
				return new Proxy(t[prop], handler);
			}
			return t[prop];
		}
	};
	const proxy = new Proxy(target, handler);

	// Verify that the proxy identifies itself
	assert(proxy.__isProxy, 'Proxy helper identifies as proxy');

	// Store it using the db module
	await setPost('at://test-proxy-post', proxy);

	// Retrieve it
	const stored = await getPost('at://test-proxy-post');

	// Assert it is stored correctly and is no longer a proxy
	assert(stored !== null, 'Stored object is not null');
	assertEqual(stored.uuid, 'test-uuid-proxy', 'Stored object preserves uuid');
	assertEqual(stored.title, 'Proxy Post', 'Stored object preserves title');
	assert(Array.isArray(stored.tags), 'Stored object preserves tags array');
	assertEqual(stored.tags[0], 'test', 'Stored object preserves tag value');
	assertEqual(stored.nested.value, 'deep-value', 'Stored object preserves nested value');
	assert(Array.isArray(stored.nested.arr), 'Stored object preserves nested array');
	assertEqual(stored.nested.arr[1], 2, 'Stored object preserves nested array value');

	// Crucially, assert that the retrieved object is a plain object and NOT a Proxy
	assert(!stored.__isProxy, 'Stored object retrieved is a plain object, not a Proxy');
	assert(!stored.nested.__isProxy, 'Nested retrieved object is a plain object, not a Proxy');
}

function runAddressFormattingTests() {
	// Test case 1: Normal short address with duplicate parts (should deduplicate)
	const deduplicated = formatDisplayAddress({
		address: "Bambous, Bambous VCA, Black River, 91005, Mauritius",
		city: "Bambous VCA",
		state: "Black River",
		zip: "91005",
		country: "Mauritius"
	});
	assertEqual(
		deduplicated,
		"Bambous, Bambous VCA, Black River, 91005, Mauritius",
		"Short address deduplicates city, state, zip, and country"
	);

	// Test case 2: Normal short address without duplicate parts
	const nonDuplicate = formatDisplayAddress({
		address: "123 Aspen St",
		city: "Denver",
		state: "CO",
		zip: "80202",
		country: "USA"
	});
	assertEqual(
		nonDuplicate,
		"123 Aspen St, Denver, CO, 80202, USA",
		"Short address formats correctly by appending parts"
	);

	// Test case 3: Legitimate address over 100 characters (should add line break before zip code)
	const longAddress = formatDisplayAddress({
		address: "123 Aspen Ridge Summit Way, Apartment 405B, South Hillside Neighborhood",
		city: "Denver City Center",
		state: "Colorado State Region",
		zip: "80202-1234",
		country: "United States of America"
	});
	assert(longAddress.includes("\n80202-1234"), "Long address inserts newline before zip code");

	// Test case 4: Legitimate address still over 100 characters after inserting break before zip (should add break before city)
	assert(longAddress.includes("\nDenver City Center"), "Long address inserts newline before city");
}

async function main() {
	console.log('============================================================');
	console.log('Schema Regression Test - love4dogs');
	console.log('============================================================');

	runSchemaTests();
	runPostTypeTagCompatibilityTests();
	runSharedAuthorIdTests();
	runAddressFormattingTests();
	await runDatabaseProxyTests();

	const summary = counts();
	console.log('------------------------------------------------------------');
	console.log(`Checks: ${summary.total} (${summary.passed} passed, ${summary.failed} failed)`);
	console.log('============================================================');

	process.exit(summary.failed > 0 ? 1 : 0);
}

main();
