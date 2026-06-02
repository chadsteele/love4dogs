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
		canonicalurl: 'https://love4dogs.club/profile/view/abc123',
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

function main() {
	console.log('============================================================');
	console.log('Schema Regression Test - love4dogs');
	console.log('============================================================');

	runSchemaTests();
	runPostTypeTagCompatibilityTests();
	runSharedAuthorIdTests();

	const summary = counts();
	console.log('------------------------------------------------------------');
	console.log(`Checks: ${summary.total} (${summary.passed} passed, ${summary.failed} failed)`);
	console.log('============================================================');

	process.exit(summary.failed > 0 ? 1 : 0);
}

main();
