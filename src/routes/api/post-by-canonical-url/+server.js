import { env } from '$env/dynamic/private';

const BSKY_XRPC = 'https://bsky.social/xrpc';
const BSKY_HANDLE = 'love4dogs.club';

let cachedSession = null;

async function getSession() {
	if (cachedSession) return cachedSession;

	const identifier = env.BSKY_USERNAME || env.username;
	const secret = env.BSKY_PASSWORD || env.password;

	const res = await fetch(`${BSKY_XRPC}/com.atproto.server.createSession`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ identifier, password: secret })
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.message || 'Failed to create session');
	}

	cachedSession = await res.json();
	return cachedSession;
}

export async function GET({ url }) {
	try {
		const uuid = String(url.searchParams.get('uuid') || '').trim();

		if (!uuid) {
			return new Response(
				JSON.stringify({ error: 'UUID is required.' }),
				{ status: 400, headers: { 'content-type': 'application/json' } }
			);
		}

		const session = await getSession();

		// Search for posts with canonicalurl + uuid
		const searchQuery = `${uuid} canonicalurl`;
		const res = await fetch(
			`${BSKY_XRPC}/app.bsky.feed.searchPosts?q=${encodeURIComponent(searchQuery)}&limit=10`,
			{
				headers: {
					authorization: `Bearer ${session.accessJwt}`,
					accept: 'application/json'
				}
			}
		);

		if (!res.ok) {
			if (res.status === 401 || res.status === 403) cachedSession = null;
			return new Response(
				JSON.stringify({ error: 'Search failed' }),
				{ status: res.status, headers: { 'content-type': 'application/json' } }
			);
		}

		const json = await res.json();
		const posts = json?.posts || [];

		// Find the post with matching canonical URL in image alts
		for (const post of posts) {
			const imageAlts = [];
			if (post.embed?.$type === 'app.bsky.embed.images') {
				for (const img of post.embed.images || []) {
					if (img.alt) imageAlts.push(img.alt);
				}
			}

			// Check if any alt contains UUID
			for (const alt of imageAlts) {
				if (alt.includes(uuid)) {
					return new Response(
						JSON.stringify({ uri: post.uri }),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
			}
		}

		return new Response(
			JSON.stringify({ error: 'Post not found' }),
			{ status: 404, headers: { 'content-type': 'application/json' } }
		);
	} catch (err) {
		console.error('[post-by-canonical-url] Error:', err);
		return new Response(
			JSON.stringify({ error: err.message || 'Internal server error' }),
			{ status: 500, headers: { 'content-type': 'application/json' } }
		);
	}
}

