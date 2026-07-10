import { hashToGps } from '$lib/utils';
import { Bsky, Post } from '$lib/models.js';

const BSKY_PUBLIC_XRPC_HOSTS = ['https://public.api.bsky.app/xrpc'];
const ACCOUNT_HANDLES = [ 'love4dogs.club'];
const MAP_BASE_URL = 'https://love4dogs.club/map';
const MAX_PAGES = 10;
const PAGE_LIMIT = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_ERROR_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const THROTTLE_COOLDOWN_MS = 90 * 1000;
const SEARCH_THROTTLE_COOLDOWN_MS = 90 * 1000;
const AUTHOR_FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const approxResponseCache = new Map();
const approxInFlight = new Map();
// Per-author cache of all mapped posts fetched from the author feed
// { posts: MappedPost[], fetchedAt: number } — used to avoid re-fetching for every hash cell
const authorFeedCache = new Map();
let upstreamThrottleUntil = 0;
let upstreamThrottleReason = '';
let searchThrottleUntil = 0;

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

function hasChatTag(post) {
	if (!post) return false;
	const record = post.record || {};
	const tags = [
		...(Array.isArray(post.tags) ? post.tags : []),
		...(Array.isArray(record.tags) ? record.tags : [])
	].map(t => String(t || '').trim().toLowerCase());
	
	if (tags.includes('chat')) return true;

	const alts = [];

	// 1. Mapped post imageAlts
	if (Array.isArray(post.imageAlts)) {
		for (const alt of post.imageAlts) {
			if (alt) alts.push(String(alt));
		}
	}

	// 2. Mapped post video alt
	if (post.video && typeof post.video === 'object') {
		if (post.video.alt) alts.push(String(post.video.alt));
	}

	// 3. Raw post embeds
	const embed = post.embed || record.embed;
	if (embed) {
		const media = embed.$type === 'app.bsky.embed.recordWithMedia#view' || embed.$type === 'app.bsky.embed.recordWithMedia'
			? embed.media
			: embed;
		const images = media?.$type === 'app.bsky.embed.images#view' || media?.$type === 'app.bsky.embed.images'
			? media.images || []
			: [];
		for (const image of images) {
			if (image?.alt) alts.push(String(image.alt));
		}
		if ((media?.$type === 'app.bsky.embed.video#view' || media?.$type === 'app.bsky.embed.video') && media.alt) {
			alts.push(String(media.alt));
		}
	}

	// 4. Check for JSON serialized payloads containing tags or context
	for (const alt of alts) {
		if (alt.includes('"chat"') || alt.includes('"context"')) {
			try {
				const parsed = JSON.parse(alt);
				if (parsed && (parsed.tags?.includes('chat') || (parsed.context !== undefined && parsed.context !== null))) {
					return true;
				}
			} catch {}
		}
	}

	return false;
}

function mapPost(post) {
	const bsky = Bsky.from(post);
	const record = post?.record || {};
	const images = [];
	const imageAlts = [];
	let video = null;

	const embedView = bsky.embed;
	const mediaView =
		embedView?.$type === 'app.bsky.embed.recordWithMedia#view' ? embedView.media : embedView;

	if (mediaView?.$type === 'app.bsky.embed.images#view') {
		for (const image of mediaView.images || []) {
			if (image.fullsize) images.push(image.fullsize);
			imageAlts.push(String(image?.alt || ''));
		}
	}

	if (mediaView?.$type === 'app.bsky.embed.video#view') {
		video = {
			playlist: mediaView.playlist || '',
			thumbnail: mediaView.thumbnail || '',
			alt: mediaView.alt || ''
		};
	}

	return Post.from({
		uri: bsky.uri,
		cid: bsky.cid,
		text: bsky.record.text,
		author: bsky.author.toJSON(),
		facets: bsky.record.facets,
		createdAt: bsky.record.createdAt,
		images,
		imageAlts,
		video,
		replyCount: bsky.replyCount,
		repostCount: bsky.repostCount,
		likeCount: bsky.likeCount,
		comments: []
	}).toJSON();
}

function isValidHashPart(value = '', expectedLength = 0) {
	const source = String(value || '').trim().toLowerCase();
	if (!source) return false;
	if (expectedLength > 0 && source.length !== expectedLength) return false;
	return /^[0-9bcdefghjkmnpqrstuvwxyz]+$/i.test(source);
}

function normalizeApproximate(value = '') {
	const source = String(value || '').trim().toLowerCase();
	if (!isValidHashPart(source, 5)) return '';
	return source;
}

function normalizeExact(value = '') {
	const source = String(value || '').trim().toLowerCase();
	if (!isValidHashPart(source, 9)) return '';
	return source;
}

function extractHashesFromBundleAlt(alt = '') {
	const source = String(alt || '').trim();
	if (!source) return null;

	try {
		const parsed = JSON.parse(source);
		const candidates = [
			parsed,
			parsed?.primary,
			parsed?.combined?.primary,
		];

		if (typeof parsed?.h === 'string' && parsed.h.trim()) {
			try {
				const inner = JSON.parse(parsed.h);
				candidates.push(inner, inner?.primary, inner?.combined?.primary);
			} catch {
				// Ignore malformed nested payloads and keep best-effort parsing.
			}
		}

		for (const candidate of candidates) {
			if (!candidate || typeof candidate !== 'object') continue;

			const location =
				candidate?.location && typeof candidate.location === 'object'
					? candidate.location
					: null;

			const hashPath =
				String(candidate?.hashPath || location?.hashPath || '').trim();
			let approximate = normalizeApproximate(
				candidate?.approximate || candidate?.approx || location?.approximate || location?.approx,
			);
			let exact = normalizeExact(
				candidate?.exact || location?.exact,
			);

			if (hashPath) {
				const parts = hashPath
					.split('/')
					.map((part) => String(part || '').trim().toLowerCase())
					.filter(Boolean);
				if (parts.length >= 2) {
					if (!approximate) approximate = normalizeApproximate(parts[0]);
					if (!exact) exact = normalizeExact(parts[1]);
				}
			}

			if (exact && !approximate) {
				approximate = exact.slice(0, 5);
			}

			if (!approximate || !exact) continue;
			return { approximate, exact };
		}
	} catch {
		return null;
	}

	return null;
}

function extractUuidFromBundleAlt(alt = '') {
	const source = String(alt || '').trim();
	if (!source) return '';

	try {
		const parsed = JSON.parse(source);
		const candidates = [
			parsed,
			parsed?.primary,
			parsed?.combined?.primary,
		];

		if (typeof parsed?.h === 'string' && parsed.h.trim()) {
			try {
				const inner = JSON.parse(parsed.h);
				candidates.push(inner, inner?.primary, inner?.combined?.primary);
			} catch {
				// Ignore malformed nested payloads and keep best-effort parsing.
			}
		}

		for (const candidate of candidates) {
			if (!candidate || typeof candidate !== 'object') continue;
			const uuid = String(candidate?.u || candidate?.uuid || candidate?.id || '').trim();
			if (uuid) return uuid;
		}
	} catch {
		return '';
	}

	return '';
}

function extractHashesFromMappedPost(mapped = {}) {
	const alts = [
		...(Array.isArray(mapped?.imageAlts) ? mapped.imageAlts : []),
		String(mapped?.video?.alt || ''),
	].filter(Boolean);

	for (const alt of alts) {
		const extracted = extractHashesFromBundleAlt(alt);
		if (extracted) return extracted;
	}

	return null;
}

function extractUuidFromMappedPost(mapped = {}) {
	const alts = [
		...(Array.isArray(mapped?.imageAlts) ? mapped.imageAlts : []),
		String(mapped?.video?.alt || ''),
	].filter(Boolean);

	for (const alt of alts) {
		const extracted = extractUuidFromBundleAlt(alt);
		if (extracted) return extracted;
	}

	return '';
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

	const postObj = postLike.post ? postLike.post : postLike;
	if (hasChatTag(postObj)) {
		pageStats.skippedChat = (pageStats.skippedChat || 0) + 1;
		return;
	}

	const mapped = mapPost(postObj);
	const uuid = extractUuidFromMappedPost(mapped);
	if (!uuid) {
		pageStats.skippedNoUuid = (pageStats.skippedNoUuid || 0) + 1;
		return;
	}
	const exactFromText = extractExactHash(mapped.text, approximate);
	const exactFromFacets = extractExactHashFromFacetUris(mapped.facets, approximate);
	const hashesFromAlt = extractHashesFromMappedPost(mapped);
	const exact = exactFromText || exactFromFacets || hashesFromAlt?.exact || '';
	const approxFromAlt = hashesFromAlt?.approximate || '';
	const resolvedApproximate = approximate || approxFromAlt || exact.slice(0, 5);
	if (!exact) {
		pageStats.skippedNoExact += 1;
		return;
	}
	if (resolvedApproximate !== approximate) {
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
		uuid: extractUuidFromMappedPost(mapped),
		approximate: resolvedApproximate,
		exact,
		lat: Number(gps.lat),
		lon: Number(gps.lon)
	});
	seen.add(postLike.uri);
	pageStats.added += 1;
}

async function collectFromSearch({ author, approximate, posts, seen, allFailures }) {
	if (Date.now() < searchThrottleUntil) {
		console.log('[map-posts] skipping search (search throttle active)', {
			approximate,
			remainingMs: searchThrottleUntil - Date.now()
		});
		return false;
	}

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
			if (failures.some((f) => f.status === 403)) {
				searchThrottleUntil = Date.now() + SEARCH_THROTTLE_COOLDOWN_MS;
				console.log('[map-posts] search throttle opened (403 from search)', {
					approximate,
					remainingMs: SEARCH_THROTTLE_COOLDOWN_MS
				});
			}
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
	// Check if we have a fresh author-level post cache to avoid re-fetching
	const cachedFeed = authorFeedCache.get(author);
	if (cachedFeed && Date.now() < cachedFeed.expiresAt) {
		console.log('[map-posts] author feed cache hit', { author, approximate, totalPosts: cachedFeed.allMappedPosts.length });
		let added = 0;
		for (const post of cachedFeed.allMappedPosts) {
			if (post.approximate !== approximate) continue;
			if (!post.uri || seen.has(post.uri)) continue;
			seen.add(post.uri);
			posts.push(post);
			added += 1;
		}
		console.log('[map-posts] author feed cache filtered', { author, approximate, added });
		return true;
	}

	// Fetch all author posts and cache the full mapped list
	let cursor = '';
	let page = 0;
	let hasSuccessfulResponse = false;
	const allMappedPosts = [];
	const allSeenUris = new Set();

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

		for (const item of found) {
			const post = item?.post || item;
			if (!post || !post.uri || allSeenUris.has(post.uri) || isReplyPost(item)) continue;
			if (hasChatTag(post)) continue;
			allSeenUris.add(post.uri);
			// Extract all approximate hashes found in this post's text/facets
			// We store ALL approximate hashes so any hash cell can match
			const mapped = mapPost(post);
			// Find approximate hash from URL in text or facets
			const approxPattern = new RegExp(
				`${MAP_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([0-9bcdefghjkmnpqrstuvwxyz]+)/([0-9bcdefghjkmnpqrstuvwxyz]+)`,
				'gi'
			);
			const textToSearch = [
				mapped.text,
				...mapped.facets.flatMap((f) =>
					(f.features || [])
						.filter((ft) => ft?.$type === 'app.bsky.richtext.facet#link')
						.map((ft) => ft.uri || '')
				)
			].join(' ');
			const addedKeys = new Set();
			const mappedUuid = extractUuidFromMappedPost(mapped);
			if (!mappedUuid) continue;
			const addMapped = (approx = '', exact = '') => {
				const normalizedApprox = normalizeApproximate(approx);
				const normalizedExact = normalizeExact(exact);
				if (!normalizedApprox || !normalizedExact) return;
				const key = `${post.uri}|${normalizedApprox}|${normalizedExact}`;
				if (addedKeys.has(key)) return;
				const gps = hashToGps(normalizedExact);
				if (!gps) return;
				allMappedPosts.push({
					...mapped,
					uuid: mappedUuid,
					approximate: normalizedApprox,
					exact: normalizedExact,
					lat: Number(gps.lat),
					lon: Number(gps.lon)
				});
				addedKeys.add(key);
			};
			let match;
			while ((match = approxPattern.exec(textToSearch)) !== null) {
				addMapped(match[1], match[2]);
			}

			const altHashes = extractHashesFromMappedPost(mapped);
			if (altHashes?.exact) {
				addMapped(altHashes.approximate, altHashes.exact);
			}
		}

		console.log('[map-posts] author feed page summary', {
			author,
			page: page + 1,
			cursorReturned: Boolean(json.cursor),
			fetched: found.length,
			mappedSoFar: allMappedPosts.length
		});

		cursor = String(json.cursor || '').trim();
		page += 1;
		if (!cursor) break;
	}

	if (hasSuccessfulResponse) {
		authorFeedCache.set(author, {
			allMappedPosts,
			expiresAt: Date.now() + AUTHOR_FEED_CACHE_TTL_MS
		});
		console.log('[map-posts] author feed cached', { author, totalMappedPosts: allMappedPosts.length });
		// Filter for the current approximate
		for (const post of allMappedPosts) {
			if (post.approximate !== approximate) continue;
			if (!post.uri || seen.has(post.uri)) continue;
			seen.add(post.uri);
			posts.push(post);
		}
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
				'Received 403 administrative blocks from all public hosts.';
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
			error: 'Unable to search posts using public API.',
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
