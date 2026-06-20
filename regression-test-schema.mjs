process.env.NODE_ENV = 'test';
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
	classifyPost,
} from './src/lib/postTypeTags.js';
import { setPost, getPost, getAllPosts, deletePost, getSetting, setSetting } from './src/lib/db.js';
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

async function runDatabaseCacheTests() {
	console.log('Running Database Caching regression tests...');
	
	// Start with a clean slate
	const initialPosts = await getAllPosts();
	for (const post of initialPosts) {
		await deletePost(post.uri);
	}

	// 1. Verify that setPost adds a cachedAt timestamp
	const uri1 = 'at://test-post-1';
	const postData1 = {
		uri: uri1,
		title: 'Post 1',
		authorid: 'test-profile-uuid',
		authorName: 'Test Profile',
		authorAvatar: 'https://cdn.bsky.app/avatar.jpg'
	};
	await setPost(uri1, postData1);

	const stored1 = await getPost(uri1);
	assert(stored1 !== null, 'Stored post is not null');
	assert(typeof stored1.cachedAt === 'number', 'Stored post has cachedAt timestamp');

	// 2. Verify 100-post limit capacity pruning
	console.log('  Testing 100-post capacity limit...');
	// We insert 105 posts (since uri1 is already there, we insert 104 more).
	// Let's insert posts with a tiny delay so they have different cachedAt values
	for (let i = 2; i <= 105; i++) {
		const uri = `at://test-post-${i}`;
		await setPost(uri, {
			uri,
			title: `Post ${i}`,
			authorid: 'test-profile-uuid',
			authorName: 'Test Profile',
			authorAvatar: 'https://cdn.bsky.app/avatar.jpg'
		});
		await new Promise(resolve => setTimeout(resolve, 1));
	}

	const allPosts = await getAllPosts();
	assertEqual(allPosts.length, 100, 'Posts cache prunes to max 100 posts');

	// Verify that the oldest post (test-post-1) is pruned, and the newest one (test-post-105) is retained
	const post1 = await getPost(uri1);
	assertEqual(post1, null, 'Oldest post (post 1) was pruned');

	const post105 = await getPost('at://test-post-105');
	assert(post105 !== null, 'Newest post (post 105) is retained');

	// 3. Verify TTL expiration
	console.log('  Testing 7-day TTL expiration...');
	const uriExpired = 'at://test-post-expired';
	const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
	await setPost(uriExpired, {
		uri: uriExpired,
		title: 'Expired Post',
		authorid: 'test-profile-uuid',
		authorName: 'Test Profile',
		authorAvatar: 'https://cdn.bsky.app/avatar.jpg',
		_testCachedAt: eightDaysAgo
	});

	// The post should be immediately filtered out/deleted on getPost
	const retrievedExpired = await getPost(uriExpired);
	assertEqual(retrievedExpired, null, 'Expired post is filtered out and deleted on getPost');

	// And it should not show up in getAllPosts
	await setPost(uriExpired, {
		uri: uriExpired,
		title: 'Expired Post',
		authorid: 'test-profile-uuid',
		authorName: 'Test Profile',
		authorAvatar: 'https://cdn.bsky.app/avatar.jpg',
		_testCachedAt: eightDaysAgo
	});
	const postsWithExpired = await getAllPosts();
	const foundExpired = postsWithExpired.find(p => p.uri === uriExpired);
	assertEqual(foundExpired, undefined, 'Expired post is filtered out from getAllPosts');
	
	// Check that it was actually deleted from database as well
	const retrievedExpiredAgain = await getPost(uriExpired);
	assertEqual(retrievedExpiredAgain, null, 'Expired post was deleted from database');
}

import { cleanWaterPostsFromCaches } from './src/lib/utils.js';

async function runCacheWaterCleanupTests() {
	console.log('Testing cleanWaterPostsFromCaches()...');

	// Seed the map-approx-posts-cache
	const cacheKey = 'love4dogs.map-approx-posts-cache.v2';
	const testCacheData = {
		'abcde': {
			savedAt: Date.now(),
			posts: [
				{ uri: 'at://land-post', lat: 40.7127281, lon: -74.0060152 },
				{ uri: 'at://water-post', lat: 0.0, lon: 0.0 }
			]
		}
	};
	await setSetting(cacheKey, testCacheData);

	// Seed the posts database store
	await setPost('at://land-post', {
		uri: 'at://land-post',
		lat: 40.7127281,
		lon: -74.0060152,
		authorid: 'test-profile-uuid-land',
		authorName: 'Land Profile',
		authorAvatar: 'https://cdn.bsky.app/avatar-land.jpg'
	});
	await setPost('at://water-post', {
		uri: 'at://water-post',
		lat: 0.0,
		lon: 0.0,
		authorid: 'test-profile-uuid-water',
		authorName: 'Water Profile',
		authorAvatar: 'https://cdn.bsky.app/avatar-water.jpg'
	});

	// Mock globalThis.fetch
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url, options) => {
		const body = JSON.parse(options.body || '{}');
		if (body.lat === 0.0 && body.lon === 0.0) {
			return {
				status: 400,
				json: async () => ({ error: 'Location cannot be in the ocean or water.' }),
				ok: false
			};
		}
		return {
			status: 200,
			json: async () => ({ ok: true }),
			ok: true
		};
	};

	try {
		// Run cleanup
		await cleanWaterPostsFromCaches();

		// Check map-approx-posts-cache
		const updatedCache = await getSetting(cacheKey);
		const postsInCache = updatedCache['abcde'].posts;
		assertEqual(postsInCache.length, 1, 'Water post was removed from map-approx-posts-cache');
		assertEqual(postsInCache[0].uri, 'at://land-post', 'Land post was preserved in map-approx-posts-cache');

		// Check posts database store
		const landPost = await getPost('at://land-post');
		const waterPost = await getPost('at://water-post');
		assert(landPost !== null, 'Land post was preserved in database store');
		assertEqual(waterPost, null, 'Water post was deleted from database store');
	} finally {
		globalThis.fetch = originalFetch;
	}
}

function runPostClassificationTests() {
	console.log('Testing classifyPost()...');

	// 1. Profile classification (profileImage field present in alt json)
	const profilePost = {
		imageAlts: [
			JSON.stringify({
				uuid: 'profile-uuid-123',
				profileImage: 'https://cdn.bsky.app/profile.jpg',
				name: 'Buddy'
			})
		]
	};
	assertEqual(classifyPost(profilePost), 'profile', 'Classifies as profile when profileImage is in imageAlts JSON');

	const profilePostVideo = {
		video: {
			alt: JSON.stringify({
				uuid: 'profile-uuid-456',
				profileImage: 'https://cdn.bsky.app/profile2.jpg'
			})
		}
	};
	assertEqual(classifyPost(profilePostVideo), 'profile', 'Classifies as profile when profileImage is in video.alt JSON');

	// 2. Comment classification (context field present in alt json)
	const commentPost = {
		imageAlts: [
			JSON.stringify({
				uuid: 'comment-uuid-123',
				context: 'post-uuid-789',
				text: 'Cute dog!'
			})
		]
	};
	assertEqual(classifyPost(commentPost), 'comment', 'Classifies as comment when context is in imageAlts JSON');

	const commentPostVideo = {
		video: {
			alt: JSON.stringify({
				uuid: 'comment-uuid-456',
				context: 'profile-uuid-abc'
			})
		}
	};
	assertEqual(classifyPost(commentPostVideo), 'comment', 'Classifies as comment when context is in video.alt JSON');

	// 3. Post classification (alt json present, but no profileImage or context)
	const standardPost = {
		imageAlts: [
			JSON.stringify({
				uuid: 'post-uuid-123',
				title: 'Fun day at the park',
				description: 'Buddy loved chasing frisbees today!'
			})
		]
	};
	assertEqual(classifyPost(standardPost), 'post', 'Classifies as post when other fields present but no profileImage or context');

	// 4. Image only CDN post (no alt json, has exactly one image, contains 🎞️ in text)
	const cdnPost = {
		images: ['https://cdn.bsky.app/some-dog-photo.jpg'],
		text: 'Look at this dog 🎞️ go!'
	};
	assertEqual(classifyPost(cdnPost), 'image_only_cdn', 'Classifies as image_only_cdn when no alt, one image, and includes 🎞️');

	// 5. Normal text post (no alt json, no images)
	const textPost = {
		text: 'Just a text post'
	};
	assertEqual(classifyPost(textPost), 'unknown', 'Classifies text-only post as unknown');

	// 6. Post with normal alt text (not JSON)
	const normalAltPost = {
		imageAlts: ['A cute brown dog playing in grass']
	};
	assertEqual(classifyPost(normalAltPost), 'unknown', 'Classifies post with non-JSON alt as unknown');

	// 7. Multi-image post with 🎞️ but no alt JSON
	const multiImageCdn = {
		images: ['https://cdn.bsky.app/1.jpg', 'https://cdn.bsky.app/2.jpg'],
		text: 'Two dogs 🎞️'
	};
	assertEqual(classifyPost(multiImageCdn), 'unknown', 'Multi-image CDN post classified as unknown (requires exactly 1 image)');
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
	await runDatabaseCacheTests();
	await runCacheWaterCleanupTests();
	runPostClassificationTests();

	const summary = counts();
	console.log('------------------------------------------------------------');
	console.log(`Checks: ${summary.total} (${summary.passed} passed, ${summary.failed} failed)`);
	console.log('============================================================');

	process.exit(summary.failed > 0 ? 1 : 0);
}

main();
