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
import {
	setPost,
	getPost,
	getAllPosts,
	deletePost,
	getSetting,
	setSetting,
	setProfile,
	getProfile,
	getAllProfiles,
	deleteProfile,
	getOfflineImage,
	setOfflineImage,
	deleteOfflineImage
} from './src/lib/db.js';
import { formatDisplayAddress } from './src/lib/addressFormat.js';
import {
	extractImagesFromPost,
	collectOriginPayloadCandidatesFromPosts,
} from './src/lib/bskyChunkStore.js';
import { processQueryForNearMe } from './src/lib/locationUtils.js';


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

	// 4. Verify Profile TTL expiration (24 hours)
	console.log('  Testing 24-hour Profile TTL expiration...');
	const profileUuidExpired = 'test-profile-expired';
	const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
	await setProfile(profileUuidExpired, {
		cachedAt: twentyFiveHoursAgo,
		data: { uuid: profileUuidExpired, name: 'Expired Profile' }
	});

	// It should be filtered out and deleted on getProfile
	const retrievedExpiredProfile = await getProfile(profileUuidExpired);
	assertEqual(retrievedExpiredProfile, null, 'Expired profile is filtered out and deleted on getProfile');

	// Draft profiles (no cachedAt or data wrapping) should NOT expire
	const profileUuidDraft = 'test-profile-draft';
	await setProfile(profileUuidDraft, { uuid: profileUuidDraft, name: 'Draft Profile' });
	const retrievedDraftProfile = await getProfile(profileUuidDraft);
	assert(retrievedDraftProfile !== null, 'Draft profile (no cachedAt wrapping) does not expire');
	assertEqual(retrievedDraftProfile.name, 'Draft Profile', 'Draft profile content retrieved correctly');

	// 5. Verify Profile 100 cached profile limit
	console.log('  Testing 100 cached profile limit...');
	// Reset profiles first
	const initialProfiles = await getAllProfiles();
	for (const p of initialProfiles) {
		const key = p.data?.uuid || p.uuid;
		await deleteProfile(key);
	}
	// Insert 105 cached profiles
	for (let i = 1; i <= 105; i++) {
		const uuid = `test-profile-cache-${i}`;
		await setProfile(uuid, {
			cachedAt: Date.now() + i,
			data: { uuid, name: `Cached Profile ${i}` }
		});
	}
	// Make sure we also have a draft profile in there, which shouldn't count towards the 100 limit or get pruned
	await setProfile(profileUuidDraft, { uuid: profileUuidDraft, name: 'Draft Profile' });

	const allProfiles = await getAllProfiles();
	const cachedProfiles = allProfiles.filter(p => p.cachedAt && p.data);
	assertEqual(cachedProfiles.length, 100, 'Profiles cache prunes to max 100 cached profiles');

	// Oldest cached profile (test-profile-cache-1) should be pruned
	const prunedProfile = await getProfile('test-profile-cache-1');
	assertEqual(prunedProfile, null, 'Oldest cached profile was pruned');

	// Draft profile is still there
	const draftStillThere = await getProfile(profileUuidDraft);
	assert(draftStillThere !== null, 'Draft profile was not pruned');

	// 6. Verify Offline Images capacity (200) pruning
	console.log('  Testing offline images capacity limit (200)...');
	// Let's set 205 offline images
	for (let i = 1; i <= 205; i++) {
		await setOfflineImage(`img-${i}`, `blob-content-${i}`);
	}
	
	// Check that we can retrieve the newest one and it unwraps the blob
	const newestImg = await getOfflineImage('img-205');
	assertEqual(newestImg, 'blob-content-205', 'Offline image retrieves unwrapped blob value');

	// Check that oldest (img-1) was pruned
	const prunedImg = await getOfflineImage('img-1');
	assertEqual(prunedImg, null, 'Oldest offline image was pruned');

	// Check that we have exactly 200 retrieved when starting from img-6 to img-205
	const firstKeptImg = await getOfflineImage('img-6');
	assert(firstKeptImg !== null, 'First kept image (index 6) is retained');
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
	runChunkStoreUnitTests();
	await runSearchFallbackAndGeocodingTests();

	const summary = counts();
	console.log('------------------------------------------------------------');
	console.log(`Checks: ${summary.total} (${summary.passed} passed, ${summary.failed} failed)`);
	console.log('============================================================');

	process.exit(summary.failed > 0 ? 1 : 0);
}

function runChunkStoreUnitTests() {
	console.log('Testing extractImagesFromPost()...');

	// Test case 1: standard post.embed with view type
	const post1 = {
		embed: {
			$type: 'app.bsky.embed.images#view',
			images: [{ url: 'https://test.com/1.jpg', alt: 'Test 1' }]
		}
	};
	const images1 = extractImagesFromPost(post1);
	assertEqual(images1.length, 1, 'Extracts standard view images');
	assertEqual(images1[0].alt, 'Test 1', 'Standard image alt matches');

	// Test case 2: post.record.embed with raw type
	const post2 = {
		record: {
			embed: {
				$type: 'app.bsky.embed.images',
				images: [{ url: 'https://test.com/2.jpg', alt: 'Test 2' }]
			}
		}
	};
	const images2 = extractImagesFromPost(post2);
	assertEqual(images2.length, 1, 'Extracts raw record embed images');
	assertEqual(images2[0].alt, 'Test 2', 'Raw image alt matches');

	// Test case 3: post.embed with recordWithMedia type
	const post3 = {
		embed: {
			$type: 'app.bsky.embed.recordWithMedia#view',
			media: {
				$type: 'app.bsky.embed.images#view',
				images: [{ url: 'https://test.com/3.jpg', alt: 'Test 3' }]
			}
		}
	};
	const images3 = extractImagesFromPost(post3);
	assertEqual(images3.length, 1, 'Extracts recordWithMedia view images');
	assertEqual(images3[0].alt, 'Test 3', 'recordWithMedia image alt matches');

	console.log('Testing collectOriginPayloadCandidatesFromPosts()...');
	const mockManifestPost = {
		uri: 'at://did:plc:test/app.bsky.feed.post/manifest',
		embed: {
			$type: 'app.bsky.embed.images#view',
			images: [{
				alt: JSON.stringify({
					u: 'j092e0ob',
					primary: { name: 'Alpha' },
					chunks: ['at://did:plc:test/app.bsky.feed.post/chunk1']
				})
			}]
		}
	};
	const candidates = collectOriginPayloadCandidatesFromPosts([mockManifestPost], { uuid: 'j092e0ob' });
	assertEqual(candidates.length, 1, 'Finds manifest candidate');
	assertEqual(candidates[0].originUri, 'at://did:plc:test/app.bsky.feed.post/manifest', 'Candidate origin URI matches');
	assertEqual(candidates[0].chunkUris.length, 1, 'Candidate chunk URIs count matches');
	assertEqual(candidates[0].chunkUris[0], 'at://did:plc:test/app.bsky.feed.post/chunk1', 'Candidate chunk URI matches');
}

async function runSearchFallbackAndGeocodingTests() {
	console.log('Testing search fallback & geocoding near me expansion...');

	// 1. Test processQueryForNearMe with active profile location
	await setSetting('love4dogs.current-profile-uuid', 'active-dog-uuid');
	await setProfile('active-dog-uuid', {
		uuid: 'active-dog-uuid',
		confirmedLocation: {
			city: 'San Francisco',
			state: 'CA',
			country: 'US',
			zip: '94103'
		}
	});

	const expanded1 = await processQueryForNearMe('adoptable retrievers near me');
	assertEqual(expanded1, 'adoptable retrievers San Francisco US CA', 'Expands near me using active profile confirmedLocation');

	// 2. Test processQueryForNearMe fallback when no active profile location is set
	await setSetting('love4dogs.current-profile-uuid', 'no-loc-uuid');
	await setProfile('no-loc-uuid', { uuid: 'no-loc-uuid' });
	
	// Seed a registry entry and profile with location
	await setSetting('love4dogs.profile-registry-v1', [{ uuid: 'other-dog-uuid' }]);
	await setProfile('other-dog-uuid', {
		uuid: 'other-dog-uuid',
		confirmedLocation: {
			city: 'Austin',
			state: 'TX',
			country: 'US',
			zip: '78701'
		}
	});

	const expanded2 = await processQueryForNearMe('adoptable retrievers near me');
	assertEqual(expanded2, 'adoptable retrievers Austin US TX', 'Expands near me using fallback profile from registry');

	// 3. Test processQueryForNearMe when no location is found at all
	await setSetting('love4dogs.profile-registry-v1', []);
	const expanded3 = await processQueryForNearMe('adoptable retrievers near me');
	assertEqual(expanded3, 'adoptable retrievers', 'Removes near me if no location context is available');

	// 4. Test Query token popping sequence (fuzzy fallback logic)
	const querySequence = [];
	let activeQuery = 'urgent foster adopt me';
	while (activeQuery) {
		querySequence.push(activeQuery);
		const words = activeQuery.split(/\s+/).filter(Boolean);
		if (words.length > 0) {
			words.pop();
			activeQuery = words.join(" ");
		} else {
			activeQuery = "";
		}
	}
	assertEqual(querySequence[0], 'urgent foster adopt me', 'Sequence starts with full query');
	assertEqual(querySequence[1], 'urgent foster adopt', 'Popped last token');
	assertEqual(querySequence[2], 'urgent foster', 'Popped second last token');
	assertEqual(querySequence[3], 'urgent', 'Popped down to first token');
	assertEqual(querySequence.length, 4, 'Correct number of fallback query retries');
}

main();
