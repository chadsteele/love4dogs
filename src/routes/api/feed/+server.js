import { env } from '$env/dynamic/private';

const BSKY_PUBLIC_XRPC_HOSTS = ['https://api.bsky.app/xrpc', 'https://public.api.bsky.app/xrpc'];
const BSKY_AUTH_XRPC = 'https://bsky.social/xrpc';
const ACCOUNT_HANDLE = 'love4dogs.club';

let cachedSession = null;

async function getSession() {
	if (cachedSession?.accessJwt) return cachedSession;
	const identifier = env.BSKY_USERNAME || env.username;
	const secret = env.BSKY_PASSWORD || env.password;
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

const hashtagRegex = /(^|\s)#([\p{L}\p{N}_-]+)/gu;

function extractTags(text = '', tags = [], facets = []) {
	const collected = [];

	for (const tag of tags || []) {
		if (typeof tag === 'string' && tag.trim()) {
			collected.push(tag.trim().toLowerCase());
		}
	}

	for (const facet of facets || []) {
		for (const feature of facet.features || []) {
			if (feature.$type === 'app.bsky.richtext.facet#tag' && feature.tag) {
				collected.push(String(feature.tag).trim().toLowerCase());
			}
		}
	}

	for (const match of text.matchAll(hashtagRegex)) {
		if (match[2]) {
			collected.push(match[2].trim().toLowerCase());
		}
	}

	return collected;
}

function countTopTags(posts, limit = 20) {
	const counts = new Map();

	for (const item of posts) {
		const record = item?.post?.record || {};
		const tags = extractTags(record.text, record.tags, record.facets);
		for (const tag of tags) {
			counts.set(tag, (counts.get(tag) || 0) + 1);
		}
	}

	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([tag, count]) => ({ tag, count }));
}

function mapPost(postWrapper) {
	const post = postWrapper.post;
	const record = post.record || {};
	const images = [];
	let video = null;

	const embedView = post.embed;
	const mediaView = embedView?.$type === 'app.bsky.embed.recordWithMedia#view' ? embedView.media : embedView;

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
		uri: post.uri,
		cid: post.cid,
		text: record.text || '',
		facets: Array.isArray(record.facets) ? record.facets : [],
		createdAt: record.createdAt || null,
		images,
		video,
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

async function xrpcGet(pathAndQuery, options) {
	const failures = [];

	for (const host of BSKY_PUBLIC_XRPC_HOSTS) {
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
			.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
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
	const publicFetchOptions = {
		method: 'GET',
		mode: 'cors',
		credentials: 'omit',
		headers: {
			Accept: 'application/json'
		}
	};

	let nextCursor = null;

	if (query) {
		let searchPath = `app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&author=${encodeURIComponent(ACCOUNT_HANDLE)}&limit=${limit}${sort === 'top' ? '&sort=top' : ''}`;
		if (cursor) {
			searchPath += `&cursor=${encodeURIComponent(cursor)}`;
		}
		const { response: searchRes, failures: searchFailures } = await xrpcGet(
			searchPath,
			publicFetchOptions
		);

		if (!searchRes) {
			return new Response(
				JSON.stringify({
					error: 'Search failed using Bluesky public API.',
					upstreamFailures: searchFailures
				}),
				{ status: 502, headers: { 'content-type': 'application/json' } }
			);
		}

		const searchJson = await searchRes.json();
		nextCursor = searchJson.cursor || null;
		let posts = (searchJson.posts || [])
			.filter((post) => !isReplyPost(post))
			.map((post) => mapPost({ post }));
		posts = await hydratePostComments(posts);

		return new Response(
			JSON.stringify({
				account: ACCOUNT_HANDLE,
				posts,
				cursor: nextCursor,
				commonRecentTags: []
			}),
			{ headers: { 'content-type': 'application/json' } }
		);
	}

	let authorFeedPath = `app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(ACCOUNT_HANDLE)}&limit=${limit}`;
	if (cursor) {
		authorFeedPath += `&cursor=${encodeURIComponent(cursor)}`;
	}
	const { response: authorFeedRes, failures: authorFeedFailures } = await xrpcGet(
		authorFeedPath,
		publicFetchOptions
	);

	if (!authorFeedRes) {
		return new Response(
			JSON.stringify({
				error: 'Unable to load author feed from Bluesky public API.',
				upstreamFailures: authorFeedFailures
			}),
			{ status: 502, headers: { 'content-type': 'application/json' } }
		);
	}

	const authorFeedJson = await authorFeedRes.json();
	nextCursor = authorFeedJson.cursor || null;
	const feedItems = (authorFeedJson.feed || []).filter((item) => !isReplyPost(item));
	console.log(
		`[feed] author feed: ${authorFeedJson.feed.length} items, ${feedItems.length} non-replies, cursor: ${nextCursor}`
	);
	const commonRecentTags = countTopTags(feedItems, 20);

	let posts = await hydratePostComments(feedItems.map(mapPost));

	return new Response(
		JSON.stringify({
			account: ACCOUNT_HANDLE,
			posts,
			cursor: nextCursor,
			commonRecentTags
		}),
		{ headers: { 'content-type': 'application/json' } }
	);
}
