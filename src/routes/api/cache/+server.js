import { json } from '@sveltejs/kit';
import { deletePost } from '$lib/db.js';

export async function DELETE({ request, url }) {
	try {
		// Try parsing request body for JSON (optional)
		let body = {};
		try {
			body = await request.json();
		} catch {
			// Body is empty or not JSON
		}

		// Resolve key/uri/uuid from query parameters or body
		const uri = (url.searchParams.get('uri') || body.uri || '').trim();
		const uuid = (url.searchParams.get('uuid') || body.uuid || '').trim();
		const key = (url.searchParams.get('key') || body.key || '').trim();

		const cleared = [];

		if (uri) {
			const cacheKey = `bsky:post:thread:${uri}`;
			await deletePost(cacheKey);
			cleared.push(cacheKey);
		}

		if (uuid) {
			const bundleKey = `bsky:profile-bundle:${uuid}`;
			const canonicalKey = `bsky:post-by-canonical-url:${uuid}`;
			await deletePost(bundleKey);
			await deletePost(canonicalKey);
			cleared.push(bundleKey, canonicalKey);
		}

		if (key) {
			await deletePost(key);
			cleared.push(key);
		}

		if (cleared.length === 0) {
			return json({ error: 'No cache key, post URI, or profile UUID provided.' }, { status: 400 });
		}

		return json({ ok: true, cleared });
	} catch (error) {
		console.error('[DELETE /api/cache] failed:', error);
		return json({ error: error?.message || 'Internal server error' }, { status: 500 });
	}
}
