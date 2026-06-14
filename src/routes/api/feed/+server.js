import { env } from '$env/dynamic/private';
import { parseTimestampMs } from '$lib/dateTime.js';
import { getPost, setPost } from '$lib/db.js';

const BSKY_PUBLIC_XRPC_HOSTS = [
	'https://public.api.bsky.app/xrpc',
	'https://api.bsky.app/xrpc'
];
const BSKY_AUTH_XRPC = 'https://bsky.social/xrpc';
const ACCOUNT_HANDLE = 'love4dogs.club';

let cachedSession = null;

async function getSession() {
	if (cachedSession?.accessJwt) return cachedSession;
	const identifier = env.BSKY_USERNAME || env.username || env.BSKY_ADMIN_HANDLE || env.ADMIN_HANDLE || env.admin_handle ||
		(typeof process !== 'undefined' && process.env && (process.env.BSKY_USERNAME || process.env.username || process.env.BSKY_ADMIN_HANDLE || process.env.ADMIN_HANDLE || process.env.admin_handle)) || '';
	const secret = env.BSKY_PASSWORD || env.password ||
		(typeof process !== 'undefined' && process.env && (process.env.BSKY_PASSWORD || process.env.password)) || '';
	if (!identifier || !secret) return null;
	try {
		const res = await fetch(`${BSKY_AUTH_XRPC}/com.atproto.server.createSession`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ identifier, password: secret })
		});
		if (!res.ok) return null;
		cachedSession = await res.json();
		return cachedSession;
	} catch {
		return null;
	}
}

function extractTags(tags = []) {
	const collected = [];

	for (const tag of tags || []) {
		if (typeof tag === 'string' && tag.trim()) {
			collected.push(tag.trim().toLowerCase());
		}
	}

	return collected;
}

function extractTagsFromPostWrapper(postWrapper = {}) {
	const post = postWrapper?.post || postWrapper || {};
	const embed = post.embed;
	const media =
		embed?.$type === 'app.bsky.embed.recordWithMedia#view'
			? embed.media
			: embed;
	const images =
		media?.$type === 'app.bsky.embed.images#view'
			? media.images || []
			: [];

	for (const image of images) {
		const tags = extractTagsFromAlt(image?.alt || '');
		if (tags.length) return tags;
	}

	if (media?.$type === 'app.bsky.embed.video#view') {
		const tags = extractTagsFromAlt(media?.alt || '');
		if (tags.length) return tags;
	}

	return extractTags(Array.isArray(post?.tags) ? post.tags : []);
}

function countTopTags(posts, limit = 20) {
	const counts = new Map();

	for (const item of posts) {
		const tags = extractTagsFromPostWrapper(item);
		for (const tag of tags) {
			counts.set(tag, (counts.get(tag) || 0) + 1);
		}
	}

	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([tag, count]) => ({ tag, count }));
}

function extractIdentityFromCanonicalUrl(canonicalUrl = '') {
	const source = String(canonicalUrl || '').trim();
	if (!source) return '';
	const match = source.match(/\/profile\/view\/([^/?#]+)/i);
	if (match?.[1]) return match[1].trim().toLowerCase();
	return source.toLowerCase();
}

function extractIdentityFromAlt(alt = '') {
	const source = String(alt || '').trim();
	if (!source) return '';

	try {
		const parsed = JSON.parse(source);
		const directUuid = String(parsed?.u || parsed?.uuid || '').trim();
		if (directUuid) return directUuid.toLowerCase();

		const canonicalUrl = String(
			parsed?.canonicalurl || parsed?.canonicalUrl || '',
		).trim();
		if (canonicalUrl) {
			const identity = extractIdentityFromCanonicalUrl(canonicalUrl);
			if (identity) return identity;
		}
	} catch {
		// Fall through to plain-text matching below.
	}

	const textMatch = source.match(/\/profile\/view\/([^/?#]+)/i);
	if (textMatch?.[1]) return textMatch[1].trim().toLowerCase();

	return '';
}

function extractTagsFromAlt(alt = '') {
	const source = String(alt || '').trim();
	if (!source) return [];

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
				// Ignore malformed nested payloads.
			}
		}

		for (const candidate of candidates) {
			if (!candidate || typeof candidate !== 'object') continue;
			const rawTags = Array.isArray(candidate?.tags)
					? candidate.tags
					: [];
			if (rawTags.length) {
				return rawTags
					.map((tag) => String(tag || '').trim().toLowerCase())
					.filter(Boolean);
			}
		}
	} catch {
		return [];
	}

	return [];
}

function extractPostIdentity(postWrapper) {
	const post = postWrapper?.post || postWrapper || {};
	const record = post.record || {};
	const imageIdentity = [];
	const embed = post.embed;
	const media =
		embed?.$type === 'app.bsky.embed.recordWithMedia#view'
			? embed.media
			: embed;
	const images =
		media?.$type === 'app.bsky.embed.images#view'
			? media.images || []
			: [];

	for (const image of images) {
		const identity = extractIdentityFromAlt(image?.alt || '');
		if (identity) imageIdentity.push(identity);
	}

	const videoIdentity = extractIdentityFromAlt(media?.alt || '');
	return imageIdentity[0] || videoIdentity || '';
}

function dedupePosts(posts = []) {
	const byIdentity = new Map();
	const order = [];

	for (const post of posts) {
		const identity = String(post?.displayKey || post?.uri || '').trim();
		if (!identity) continue;

		if (!byIdentity.has(identity)) {
			byIdentity.set(identity, post);
			order.push(identity);
			continue;
		}

		const existing = byIdentity.get(identity);

		// Check if existing or candidate post has the "profile" tag
		const existingTags = (existing?.tags || []).map(t => String(t || '').trim().toLowerCase());
		const candidateTags = (post?.tags || []).map(t => String(t || '').trim().toLowerCase());
		const existingIsProfile = existingTags.includes('profile');
		const candidateIsProfile = candidateTags.includes('profile');

		if (!existingIsProfile && candidateIsProfile) {
			console.log('[feed] collapsed duplicate identity', {
				identity,
				keptUri: post.uri,
				droppedUri: existing?.uri || '',
				keptType: candidateIsProfile ? 'profile' : 'post',
				droppedType: existingIsProfile ? 'profile' : 'post',
			});
			byIdentity.set(identity, post);
		} else {
			console.log('[feed] skipped duplicate identity', {
				identity,
				keptUri: existing?.uri || '',
				droppedUri: post.uri,
				keptType: existingIsProfile ? 'profile' : 'post',
				droppedType: candidateIsProfile ? 'profile' : 'post',
			});
		}
	}

	return order.map((identity) => byIdentity.get(identity)).filter(Boolean);
}

function mapPost(postWrapper) {
	const post = postWrapper.post;
	const record = post.record || {};
	const images = [];
	const imageAlts = [];
	let video = null;
	let altTags = [];

	const embedView = post.embed;
	const mediaView = embedView?.$type === 'app.bsky.embed.recordWithMedia#view' ? embedView.media : embedView;

	if (mediaView?.$type === 'app.bsky.embed.images#view') {
		for (const image of mediaView.images || []) {
			if (image.fullsize) {
				images.push(image.fullsize);
				const alt = String(image.alt || '');
				imageAlts.push(alt);
				if (!altTags.length) {
					altTags = extractTagsFromAlt(alt);
				}
			}
		}
	}

	if (mediaView?.$type === 'app.bsky.embed.video#view') {
		video = {
			playlist: mediaView.playlist || '',
			thumbnail: mediaView.thumbnail || '',
			alt: mediaView.alt || ''
		};
		if (!altTags.length) {
			altTags = extractTagsFromAlt(String(mediaView.alt || ''));
		}
	}

	const identityKey = extractPostIdentity(postWrapper) || post.uri || '';

	const tagsArray = [...new Set([
		...(Array.isArray(post?.tags) ? post.tags : []),
		...(Array.isArray(record?.tags) ? record.tags : []),
		...altTags,
	]
		.map((tag) => String(tag || '').trim().toLowerCase())
		.filter(Boolean))];

	return {
		uri: post.uri,
		displayKey: identityKey,
		cid: post.cid,
		text: record.text || '',
		author: {
			did: String(post?.author?.did || '').trim(),
			handle: String(post?.author?.handle || '').trim(),
			displayName: String(post?.author?.displayName || '').trim(),
			avatar: String(post?.author?.avatar || '').trim(),
		},
		facets: Array.isArray(record.facets) ? record.facets : [],
		createdAt: record.createdAt || null,
		images,
		imageAlts,
		video,
		tags: tagsArray,
		record: {
			tags: tagsArray,
			createdAt: record.createdAt || null,
		},
		replyCount: post.replyCount || 0,
		repostCount: post.repostCount || 0,
		likeCount: post.likeCount || 0,
		comments: []
	};
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

async function xrpcGet(pathAndQuery, options) {
	const preferredHost = String(options?.preferredHost || '').trim();
	const hostOrder = preferredHost
		? [
			preferredHost,
			...BSKY_PUBLIC_XRPC_HOSTS.filter((host) => host !== preferredHost)
		]
		: BSKY_PUBLIC_XRPC_HOSTS;
	const failures = [];

	for (const host of hostOrder) {
		const requestUrl = `${host}/${pathAndQuery}`;
		try {
			const response = await fetch(requestUrl, options);
			if (response.ok) {
				return { response, host };
			}

			failures.push({ host, status: response.status, details: await response.text() });
		} catch (error) {
			failures.push({ host, status: 0, details: error.message || 'Network error' });
		}
	}

	return { response: null, host: null, failures };
}

async function xrpcGetAuthorized(pathAndQuery, options = {}) {
	const session = await getSession();
	if (!session?.accessJwt) {
		return {
			response: null,
			host: null,
			failures: [
				{
					host: BSKY_AUTH_XRPC,
					status: 0,
					details: 'No authenticated session available for fallback.'
				}
			]
		};
	}

	const requestUrl = `${BSKY_AUTH_XRPC}/${pathAndQuery}`;
	try {
		const response = await fetch(requestUrl, {
			...options,
			headers: {
				...(options?.headers || {}),
				Accept: 'application/json',
				Authorization: `Bearer ${session.accessJwt}`
			}
		});
		if (response.ok) {
			return { response, host: BSKY_AUTH_XRPC, failures: [] };
		}

		return {
			response: null,
			host: null,
			failures: [
				{
					host: BSKY_AUTH_XRPC,
					status: response.status,
					details: await response.text()
				}
			]
		};
	} catch (error) {
		return {
			response: null,
			host: null,
			failures: [
				{
					host: BSKY_AUTH_XRPC,
					status: 0,
					details: error.message || 'Network error'
				}
			]
		};
	}
}

async function fetchComments(uri) {
	try {
		const session = await getSession();
		const threadUrl = `${BSKY_AUTH_XRPC}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=1`;
		const headers = { Accept: 'application/json' };
		if (session?.accessJwt) headers['Authorization'] = `Bearer ${session.accessJwt}`;
		const res = await fetch(threadUrl, { headers });
		if (!res.ok) return [];
		const json = await res.json();
		const replies = json?.thread?.replies || [];
		return replies
			.filter(r => r.$type === 'app.bsky.feed.defs#threadViewPost' && r.post?.record?.text)
			.map(r => ({
				handle: r.post.author?.handle || 'unknown',
				displayName: r.post.author?.displayName || r.post.author?.handle || 'unknown',
				avatar: r.post.author?.avatar || '',
				text: r.post.record.text,
				createdAt: r.post.record.createdAt || ''
			}))
			.sort((a, b) => parseTimestampMs(b.createdAt) - parseTimestampMs(a.createdAt))
			.slice(0, 3);
	} catch {
		return [];
	}
}

async function hydratePostComments(posts = []) {
	const postsWithReplies = posts.filter((p) => p.replyCount > 0);
	if (postsWithReplies.length === 0) return posts;

	const results = await Promise.allSettled(postsWithReplies.map((p) => fetchComments(p.uri)));
	results.forEach((result, i) => {
		if (result.status === 'fulfilled') {
			postsWithReplies[i].comments = result.value;
		}
	});

	return posts;
}

export async function GET({ url }) {
	const query = url.searchParams.get('query')?.trim() || '';
	const sort = url.searchParams.get('sort') === 'top' ? 'top' : 'latest';
	const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit')) || 20), 100);
	const cursor = url.searchParams.get('cursor')?.trim() || '';
	const cursorHost = url.searchParams.get('cursorHost')?.trim() || '';
	const forceRefresh = url.searchParams.get('refresh') === '1';
	const chatParam = url.searchParams.get('chat') || '0';

	const cleanedQuery = query.replace(/\bnear\s+me\b/gi, '').trim().replace(/\s+/g, ' ');
	const cacheKey = `bsky:feed:${cleanedQuery}:${sort}:${limit}:${cursor}:${cursorHost}:${chatParam}`;

	const cached = await getPost(cacheKey);
	if (cached && !forceRefresh) {
		return new Response(JSON.stringify(cached), {
			headers: { 'content-type': 'application/json' }
		});
	}

	const cacheBuster = forceRefresh ? Date.now() : null;
	const publicFetchOptions = {
		method: 'GET',
		mode: 'cors',
		credentials: 'omit',
		cache: forceRefresh ? 'no-store' : 'default',
		headers: {
			Accept: 'application/json',
			...(forceRefresh
				? {
					'Cache-Control': 'no-cache, no-store, max-age=0',
					Pragma: 'no-cache'
				}
				: {})
		}
	};

	let nextCursor = null;

	if (cleanedQuery) {
		let searchPath = `app.bsky.feed.searchPosts?q=${encodeURIComponent(cleanedQuery)}&author=${encodeURIComponent(ACCOUNT_HANDLE)}&limit=${limit}${sort === 'top' ? '&sort=top' : ''}`;
		if (cursor) {
			searchPath += `&cursor=${encodeURIComponent(cursor)}`;
		}
		if (cacheBuster) {
			searchPath += `&_=${cacheBuster}`;
		}
		let { response: searchRes, host: searchHost, failures: searchFailures } = await xrpcGet(
			searchPath,
			{
				...publicFetchOptions,
				preferredHost: cursor ? cursorHost : ''
			}
		);
		if (!searchRes) {
			const authFallback = await xrpcGetAuthorized(searchPath, publicFetchOptions);
			searchFailures = [...(searchFailures || []), ...(authFallback.failures || [])];
			if (authFallback.response) {
				searchRes = authFallback.response;
				searchHost = authFallback.host;
			}
		}

		if (!searchRes) {
			if (cursor) {
				console.warn('[feed] cursor pagination failed; ending search pagination', {
					query: cleanedQuery,
					cursor,
					upstreamFailures: searchFailures,
				});
				const responseData = {
					account: ACCOUNT_HANDLE,
					posts: [],
					cursor: null,
					commonRecentTags: []
				};
				await setPost(cacheKey, responseData);
				return new Response(
					JSON.stringify(responseData),
					{ headers: { 'content-type': 'application/json' } }
				);
			}
			return new Response(
				JSON.stringify({
					error: 'Search failed using public API.',
					upstreamFailures: searchFailures
				}),
				{ status: 502, headers: { 'content-type': 'application/json' } }
			);
		}

		const searchJson = await searchRes.json();
		nextCursor = searchJson.cursor || null;
		let posts = (searchJson.posts || [])
			.filter((post) => !isReplyPost(post) && extractPostIdentity({ post }))
			.map((post) => mapPost({ post }));

		if (chatParam === '1') {
			posts = posts.filter(post => hasChatTag(post));
		} else if (chatParam !== 'all') {
			posts = posts.filter(post => !hasChatTag(post));
		}

		posts = dedupePosts(posts);
		posts = await hydratePostComments(posts);

		const responseData = {
			account: ACCOUNT_HANDLE,
			posts,
			cursor: nextCursor,
			cursorHost: searchHost || cursorHost || null,
			commonRecentTags: []
		};
		await setPost(cacheKey, responseData);

		return new Response(
			JSON.stringify(responseData),
			{ headers: { 'content-type': 'application/json' } }
		);
	}

	let authorFeedPath = `app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(ACCOUNT_HANDLE)}&limit=${limit}`;
	if (cursor) {
		authorFeedPath += `&cursor=${encodeURIComponent(cursor)}`;
	}
	if (cacheBuster) {
		authorFeedPath += `&_=${cacheBuster}`;
	}
	let { response: authorFeedRes, host: authorFeedHost, failures: authorFeedFailures } = await xrpcGet(
		authorFeedPath,
		{
			...publicFetchOptions,
			preferredHost: cursor ? cursorHost : ''
		}
	);
	if (!authorFeedRes) {
		const authFallback = await xrpcGetAuthorized(authorFeedPath, publicFetchOptions);
		authorFeedFailures = [...(authorFeedFailures || []), ...(authFallback.failures || [])];
		if (authFallback.response) {
			authorFeedRes = authFallback.response;
			authorFeedHost = authFallback.host;
		}
	}

	if (!authorFeedRes) {
		return new Response(
			JSON.stringify({
				error: 'Unable to load author feed from public API.',
				upstreamFailures: authorFeedFailures
			}),
			{ status: 502, headers: { 'content-type': 'application/json' } }
		);
	}

	const authorFeedJson = await authorFeedRes.json();
	nextCursor = authorFeedJson.cursor || null;
	const feedItems = (authorFeedJson.feed || []).filter((item) => !isReplyPost(item) && extractPostIdentity(item));
	console.log(
		`[feed] author feed: ${authorFeedJson.feed.length} items, ${feedItems.length} non-replies, cursor: ${nextCursor}`
	);
	const commonRecentTags = countTopTags(feedItems, 20);

	let posts = feedItems.map(mapPost);
	if (chatParam === '1') {
		posts = posts.filter(post => hasChatTag(post));
	} else if (chatParam !== 'all') {
		posts = posts.filter(post => !hasChatTag(post));
	}
	posts = dedupePosts(posts);
	posts = await hydratePostComments(posts);

	const responseData = {
		account: ACCOUNT_HANDLE,
		posts,
		cursor: nextCursor,
		cursorHost: authorFeedHost || cursorHost || null,
		commonRecentTags
	};
	await setPost(cacheKey, responseData);

	return new Response(
		JSON.stringify(responseData),
		{ headers: { 'content-type': 'application/json' } }
	);
}
