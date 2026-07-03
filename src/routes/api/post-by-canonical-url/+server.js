import { env } from '$env/dynamic/private';
import { getPost, setPost } from '$lib/db.js';

const BSKY_XRPC = 'https://bsky.social/xrpc';
const BSKY_HANDLE = 'love4dogs.club';

let cachedSession = null;
let sessionCreatedAt = 0;
const SESSION_TTL_MS = 90 * 60 * 1000; // 90 minutes — well before Bluesky's ~2hr JWT expiry

function resolveRootUri(post = {}) {
	const root = String(post?.record?.reply?.root?.uri || post?.reply?.root?.uri || '').trim();
	if (root) return root;
	return String(post?.uri || '').trim();
}

function collectImageAlts(post = {}) {
	const embed = post?.embed;
	const media =
		embed?.$type === 'app.bsky.embed.recordWithMedia#view'
			? embed.media
			: embed;
	const images =
		media?.$type === 'app.bsky.embed.images#view'
			? media.images || []
			: media?.$type === 'app.bsky.embed.images'
				? media.images || []
				: [];
	return images.map((img) => String(img?.alt || '').trim()).filter(Boolean);
}

function altMatchesUuid(alt = '', uuid = '') {
	const target = String(uuid || '').trim();
	if (!target) return false;
	const source = String(alt || '').trim();
	if (!source) return false;
	if (source.includes(target)) return true;
	try {
		const parsed = JSON.parse(source);
		const payloadUuid = String(parsed?.u || parsed?.uuid || '').trim();
		if (payloadUuid && payloadUuid === target) return true;
		const canonical = String(parsed?.canonicalurl || parsed?.canonicalUrl || '').trim();
		if (canonical && canonical.includes(target)) return true;
	} catch {
		// Plain text alt values are handled via substring check above.
	}
	return false;
}

function clearSession() {
	cachedSession = null;
	sessionCreatedAt = 0;
}

async function getSession(forceRefresh = false) {
	// Return cached session if still within TTL
	if (!forceRefresh && cachedSession && (Date.now() - sessionCreatedAt < SESSION_TTL_MS)) {
		return cachedSession;
	}

	// Clear stale session
	clearSession();

	const identifier = env.BSKY_USERNAME || env.BSKY_ADMIN_HANDLE ||
		(typeof process !== 'undefined' && process.env && (process.env.BSKY_USERNAME || process.env.BSKY_ADMIN_HANDLE)) || '';
	const secret = env.BSKY_PASSWORD ||
		(typeof process !== 'undefined' && process.env && process.env.BSKY_PASSWORD) || '';

	if (!identifier || !secret) {
		throw new Error('Missing Bluesky credentials in .env');
	}

	const res = await fetch(`${BSKY_XRPC}/com.atproto.server.createSession`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ identifier, password: secret })
	});

	if (!res.ok) {
		throw new Error('Failed to create session');
	}

	cachedSession = await res.json();
	sessionCreatedAt = Date.now();
	return cachedSession;
}

/**
 * Perform an authenticated search, retrying once with a fresh session on auth failure.
 */
async function searchPostsAuthenticated(searchQuery) {
	const searchUrl = `${BSKY_XRPC}/app.bsky.feed.searchPosts?q=${encodeURIComponent(searchQuery)}&author=${encodeURIComponent(BSKY_HANDLE)}&limit=100`;

	for (let attempt = 0; attempt < 2; attempt++) {
		const session = await getSession(attempt > 0);
		const res = await fetch(searchUrl, {
			headers: {
				authorization: `Bearer ${session.accessJwt}`,
				accept: 'application/json'
			}
		});

		if (res.ok) return res;

		// On auth-related failures, clear session and retry once
		if ((res.status === 400 || res.status === 401 || res.status === 403) && attempt === 0) {
			clearSession();
			continue;
		}

		return res; // Non-retryable failure
	}
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

		const cacheKey = `bsky:post-by-canonical-url:${uuid}`;
		const cached = await getPost(cacheKey);
		if (cached) {
			return new Response(
				JSON.stringify(cached),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		}

		const res = await searchPostsAuthenticated(uuid);

		if (!res.ok) {
			return new Response(
				JSON.stringify({ error: 'Search failed' }),
				{ status: res.status, headers: { 'content-type': 'application/json' } }
			);
		}

		const json = await res.json();
		const posts = json?.posts || [];

		// Find the most relevant post with matching bundle payload and return thread root URI.
		for (const post of posts) {
			const imageAlts = collectImageAlts(post);
			for (const alt of imageAlts) {
				if (altMatchesUuid(alt, uuid)) {
					const uri = resolveRootUri(post);
					if (!uri) continue;
					const responseData = { uri };
					await setPost(cacheKey, responseData);
					return new Response(
						JSON.stringify(responseData),
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

