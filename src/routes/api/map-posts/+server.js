import { hashToGps } from '$lib/utils';

const BSKY_PUBLIC_XRPC_HOSTS = ['https://api.bsky.app/xrpc', 'https://public.api.bsky.app/xrpc'];
const ACCOUNT_HANDLES = [ 'mylove4dogs.bsky.social'];
const MAP_BASE_URL = 'https://love4dogs.club/map';
const MAX_PAGES = 10;
const PAGE_LIMIT = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_ERROR_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const THROTTLE_COOLDOWN_MS = 90 * 1000;
const approxResponseCache = new Map();
const approxInFlight = new Map();
let upstreamThrottleUntil = 0;
let upstreamThrottleReason = '';

function pruneCache(now = Date.now()) {
	for (const [key, entry] of approxResponseCache.entries()) {
		if (!entry || entry.expiresAt <= now) {
			approxResponseCache.delete(key);
		}
	}

	if (approxResponseCache.size <= MAX_CACHE_ENTRIES) return;
	const sortedByCreatedAt = [...approxResponseCache.entries()].sort(
		(a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0)
	);
	const overage = sortedByCreatedAt.length - MAX_CACHE_ENTRIES;
	for (let i = 0; i < overage; i += 1) {
		approxResponseCache.delete(sortedByCreatedAt[i][0]);
	}
}

function readCache(approximate) {
	const now = Date.now();
	const entry = approxResponseCache.get(approximate);
	if (!entry) return null;
	if (entry.expiresAt <= now) {
		approxResponseCache.delete(approximate);
		return null;
	}
	return entry;
}

function writeCache(approximate, { status, bodyText, ttlMs }) {
	const now = Date.now();
	approxResponseCache.set(approximate, {
		status,
		bodyText,
		createdAt: now,
		expiresAt: now + ttlMs
	});
	pruneCache(now);
}

function mapPath(pathAndQuery = '') {
	return String(pathAndQuery || '').replace(/^\/+/, '');
}

function isThrottleFailure(failure) {
	return failure?.status === 403;
}

function shouldOpenThrottleWindow(failures = []) {
	if (!Array.isArray(failures) || failures.length === 0) return false;
	return failures.some((failure) => isThrottleFailure(failure));
}

function getThrottleRemainingMs(now = Date.now()) {
	return Math.max(upstreamThrottleUntil - now, 0);
}

function buildThrottledPayload({ approximate, remainingMs, upstreamFailures = [] }) {
	return JSON.stringify({
		ok: true,
		throttled: true,
		approximate,
		posts: [],
		account: ACCOUNT_HANDLES[0] || '',
		cooldownMs: remainingMs,
		upstreamFailures,
		reason: upstreamThrottleReason || 'Bluesky temporarily throttled requests.'
	});
}

async function xrpcGet(pathAndQuery) {
	const failures = [];

	for (const host of BSKY_PUBLIC_XRPC_HOSTS) {
		const requestUrl = `${host}/${mapPath(pathAndQuery)}`;
		try {
			const response = await fetch(requestUrl, {
				method: 'GET',
				mode: 'cors',
				credentials: 'omit',
				headers: { Accept: 'application/json' }
			});
			if (response.ok) {
				return { response, failures };
			}

			failures.push({ host, status: response.status, details: await response.text() });
		} catch (error) {
			failures.push({ host, status: 0, details: error.message || 'Network error' });
		}
	}

	return { response: null, failures };
}

function isReplyPost(item) {
	const post = item?.post || item;
	const record = post?.record || {};
	return Boolean(item?.reply || record?.reply?.parent?.uri || record?.reply?.root?.uri);
}

function mapPost(post) {
	const record = post?.record || {};
	const images = [];
	let video = null;

	const embedView = post?.embed;
	const mediaView =
		embedView?.$type === 'app.bsky.embed.recordWithMedia#view' ? embedView.media : embedView;

	if (mediaView?.$type === 'app.bsky.embed.images#view') {
		for (const image of mediaView.images || []) {
			if (image.fullsize) images.push(image.fullsize);
		}
	}

	if (mediaView?.$type === 'app.bsky.embed.video#view') {
		video = {
			playlist: mediaView.playlist || '',
			thumbnail: mediaView.thumbnail || '',
			alt: mediaView.alt || ''
		};
	}

	return {
		uri: post?.uri || '',
		cid: post?.cid || '',
		text: record.text || '',
		facets: Array.isArray(record.facets) ? record.facets : [],
		createdAt: record.createdAt || null,
		images,
		video,
		replyCount: post?.replyCount || 0,
		repostCount: post?.repostCount || 0,
		likeCount: post?.likeCount || 0,
		comments: []
	};
}

function extractExactHash(text = '', approximate = '') {
	const escapedApprox = String(approximate || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`${MAP_BASE_URL}/${escapedApprox}/([0-9bcdefghjkmnpqrstuvwxyz]+)`, 'i');
	const match = String(text || '').match(regex);
	return match ? match[1] : '';
}

function extractExactHashFromFacetUris(facets = [], approximate = '') {
	for (const facet of facets || []) {
		for (const feature of facet?.features || []) {
			if (feature?.$type !== 'app.bsky.richtext.facet#link') continue;
			const exact = extractExactHash(feature.uri || '', approximate);
			if (exact) return exact;
		}
	}
	return '';
}

function tryAddMappedPost({ postLike, approximate, posts, seen, pageStats, author }) {
	if (!postLike?.uri) {
		pageStats.skippedNoUri += 1;
		return;
	}
	if (seen.has(postLike.uri)) {
		pageStats.skippedSeen += 1;
		return;
	}
	if (isReplyPost(postLike)) {
		pageStats.skippedReply += 1;
		return;
	}

	const mapped = mapPost(postLike.post ? postLike.post : postLike);
	const exactFromText = extractExactHash(mapped.text, approximate);
	const exactFromFacets = extractExactHashFromFacetUris(mapped.facets, approximate);
	const exact = exactFromText || exactFromFacets;
	if (!exact) {
		pageStats.skippedNoExact += 1;
		return;
	}
	const gps = hashToGps(exact);
	if (!gps) {
		pageStats.skippedBadExact += 1;
		console.log('[map-posts] bad exact hash', {
			author,
			uri: postLike.uri,
			exact
		});
		return;
	}

	posts.push({
		...mapped,
		approximate,
		exact,
		lat: Number(gps.lat),
		lon: Number(gps.lon)
	});
	seen.add(postLike.uri);
	pageStats.added += 1;
}

async function collectFromSearch({ author, approximate, posts, seen, allFailures }) {
	let cursor = '';
	let page = 0;
	let hasSuccessfulResponse = false;

	while (page < MAX_PAGES) {
		const params = new URLSearchParams({
			q: approximate,
			author,
			limit: String(PAGE_LIMIT)
		});
		if (cursor) params.set('cursor', cursor);
		const query = params.toString();
		console.log('[map-posts] fetching search page', {
			author,
			page: page + 1,
			query
		});

		const { response, failures } = await xrpcGet(
			`app.bsky.feed.searchPosts?${query}`
		);
		if (failures.length) {
			console.log('[map-posts] upstream failures', {
				author,
				page: page + 1,
				failures: failures.map((failure) => ({
					host: failure.host,
					status: failure.status,
					details: String(failure.details || '').slice(0, 200)
				}))
			});
			allFailures.push(...failures.map((entry) => ({ ...entry, author })));
		}

		if (!response) {
			console.log('[map-posts] no response for search page', { author, page: page + 1 });
			break;
		}

		hasSuccessfulResponse = true;
		const json = await response.json();
		const found = Array.isArray(json.posts) ? json.posts : [];
		const pageStats = {
			fetched: found.length,
			skippedNoUri: 0,
			skippedSeen: 0,
			skippedReply: 0,
			skippedNoExact: 0,
			skippedBadExact: 0,
			added: 0
		};

		for (const post of found) {
			tryAddMappedPost({
				postLike: post,
				approximate,
				posts,
				seen,
				pageStats,
				author
			});
		}

		console.log('[map-posts] search page summary', {
			author,
			page: page + 1,
			cursorReturned: Boolean(json.cursor),
			...pageStats
		});

		cursor = String(json.cursor || '').trim();
		page += 1;
		if (!cursor) break;
	}

	return hasSuccessfulResponse;
}

async function collectFromAuthorFeed({ author, approximate, posts, seen, allFailures }) {
	let cursor = '';
	let page = 0;
	let hasSuccessfulResponse = false;

	while (page < MAX_PAGES) {
		const params = new URLSearchParams({
			actor: author,
			limit: String(PAGE_LIMIT)
		});
		if (cursor) params.set('cursor', cursor);
		const query = params.toString();
		console.log('[map-posts] fetching author feed page', {
			author,
			page: page + 1,
			query
		});

		const { response, failures } = await xrpcGet(
			`app.bsky.feed.getAuthorFeed?${query}`
		);
		if (failures.length) {
			console.log('[map-posts] author feed upstream failures', {
				author,
				page: page + 1,
				failures: failures.map((failure) => ({
					host: failure.host,
					status: failure.status,
					details: String(failure.details || '').slice(0, 200)
				}))
			});
			allFailures.push(...failures.map((entry) => ({ ...entry, author })));
		}

		if (!response) {
			console.log('[map-posts] no response for author feed page', {
				author,
				page: page + 1
			});
			break;
		}

		hasSuccessfulResponse = true;
		const json = await response.json();
		const found = Array.isArray(json.feed) ? json.feed : [];
		const pageStats = {
			fetched: found.length,
			skippedNoUri: 0,
			skippedSeen: 0,
			skippedReply: 0,
			skippedNoExact: 0,
			skippedBadExact: 0,
			added: 0
		};

		for (const item of found) {
			const post = item?.post;
			if (!post) {
				pageStats.skippedNoUri += 1;
				continue;
			}

			tryAddMappedPost({
					postLike: post,
				approximate,
				posts,
				seen,
				pageStats,
				author
			});
		}

		console.log('[map-posts] author feed page summary', {
			author,
			page: page + 1,
			cursorReturned: Boolean(json.cursor),
			...pageStats
		});

		cursor = String(json.cursor || '').trim();
		page += 1;
		if (!cursor) break;
	}

	return hasSuccessfulResponse;
}

export async function GET({ url }) {
	const approximate = String(url.searchParams.get('approximate') || '').trim().toLowerCase();
	console.log('[map-posts] request', { approximate });
	if (!approximate) {
		return new Response(JSON.stringify({ error: 'Missing approximate hash.' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	const cached = readCache(approximate);
	if (cached) {
		console.log('[map-posts] cache hit', { approximate, status: cached.status });
		return new Response(cached.bodyText, {
			status: cached.status,
			headers: { 'content-type': 'application/json' }
		});
	}

	const throttleRemainingMs = getThrottleRemainingMs();
	if (throttleRemainingMs > 0) {
		console.log('[map-posts] throttle cooldown hit', {
			approximate,
			remainingMs: throttleRemainingMs,
			reason: upstreamThrottleReason
		});
		const payload = buildThrottledPayload({
			approximate,
			remainingMs: throttleRemainingMs
		});
		writeCache(approximate, {
			status: 200,
			bodyText: payload,
			ttlMs: Math.min(CACHE_ERROR_TTL_MS, throttleRemainingMs)
		});
		return new Response(payload, {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}

	if (approxInFlight.has(approximate)) {
		console.log('[map-posts] in-flight hit', { approximate });
		const inFlight = await approxInFlight.get(approximate);
		return new Response(inFlight.bodyText, {
			status: inFlight.status,
			headers: { 'content-type': 'application/json' }
		});
	}

	const computePromise = (async () => {

	const posts = [];
	const seen = new Set();
	const allFailures = [];
	let searchedAuthor = '';

	for (const author of ACCOUNT_HANDLES) {
		console.log('[map-posts] trying author', { author });
		const hadSearchResponse = await collectFromSearch({
			author,
			approximate,
			posts,
			seen,
			allFailures
		});

		if (posts.length === 0) {
			console.log('[map-posts] search yielded no posts, falling back to author feed scan', {
				author,
				approximate
			});
		}

		const hadAuthorFeedResponse = await collectFromAuthorFeed({
			author,
			approximate,
			posts,
			seen,
			allFailures
		});

		if (hadSearchResponse || hadAuthorFeedResponse) {
			searchedAuthor = author;
			console.log('[map-posts] selected author', { author });
			break;
		}
	}

	if (!searchedAuthor) {
		if (shouldOpenThrottleWindow(allFailures)) {
			upstreamThrottleUntil = Date.now() + THROTTLE_COOLDOWN_MS;
			upstreamThrottleReason =
				'Received 403 administrative blocks from all Bluesky public hosts.';
			const remainingMs = getThrottleRemainingMs();
			console.log('[map-posts] opening throttle cooldown window', {
				approximate,
				remainingMs,
				failureCount: allFailures.length
			});
			const throttledPayload = buildThrottledPayload({
				approximate,
				remainingMs,
				upstreamFailures: allFailures
			});
			writeCache(approximate, {
				status: 200,
				bodyText: throttledPayload,
				ttlMs: Math.min(CACHE_ERROR_TTL_MS, remainingMs)
			});
			return {
				status: 200,
				bodyText: throttledPayload
			};
		}

		console.log('[map-posts] search failed', { approximate, failureCount: allFailures.length });
		const errorPayload = JSON.stringify({
			error: 'Unable to search Bluesky posts.',
			upstreamFailures: allFailures
		});
		writeCache(approximate, {
			status: 502,
			bodyText: errorPayload,
			ttlMs: CACHE_ERROR_TTL_MS
		});
		return {
			status: 502,
			bodyText: errorPayload
		};
	}

	console.log('[map-posts] final summary', {
		approximate,
		searchedAuthor,
		postCount: posts.length,
		failureCount: allFailures.length
	});

	const successPayload = JSON.stringify({
		ok: true,
		account: searchedAuthor,
		approximate,
		posts,
		upstreamFailures: allFailures
	});
	writeCache(approximate, {
		status: 200,
		bodyText: successPayload,
		ttlMs: CACHE_TTL_MS
	});

	return {
		status: 200,
		bodyText: successPayload
	};
	})();

	approxInFlight.set(approximate, computePromise);
	let result;
	try {
		result = await computePromise;
	} finally {
		approxInFlight.delete(approximate);
	}

	return new Response(result.bodyText, {
		status: result.status,
		headers: { 'content-type': 'application/json' }
	});
}
