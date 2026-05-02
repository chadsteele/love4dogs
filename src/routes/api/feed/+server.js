const BSKY_PUBLIC_XRPC_HOSTS = ['https://api.bsky.app/xrpc', 'https://public.api.bsky.app/xrpc'];
const ACCOUNT_HANDLE = 'mylove4dogs.bsky.social';

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

	if (post.embed?.$type === 'app.bsky.embed.images#view') {
		for (const image of post.embed.images || []) {
			if (image.fullsize) images.push(image.fullsize);
		}
	}

	return {
		uri: post.uri,
		cid: post.cid,
		text: record.text || '',
		createdAt: record.createdAt || null,
		images,
		replyCount: post.replyCount || 0,
		repostCount: post.repostCount || 0,
		likeCount: post.likeCount || 0
	};
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

export async function GET({ url }) {
	const query = url.searchParams.get('query')?.trim() || '';
	const publicFetchOptions = {
		method: 'GET',
		mode: 'cors',
		credentials: 'omit',
		headers: {
			Accept: 'application/json'
		}
	};

	const authorFeedPath = `app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(ACCOUNT_HANDLE)}&limit=20`;
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
	const feedItems = authorFeedJson.feed || [];
	const commonRecentTags = countTopTags(feedItems, 20);

	let posts = feedItems.map(mapPost);

	if (query) {
		const searchPath = `app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&author=${encodeURIComponent(ACCOUNT_HANDLE)}&limit=30`;
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
		posts = (searchJson.posts || []).map((post) => mapPost({ post }));
	}

	return new Response(
		JSON.stringify({
			account: ACCOUNT_HANDLE,
			posts,
			commonRecentTags
		}),
		{ headers: { 'content-type': 'application/json' } }
	);
}
