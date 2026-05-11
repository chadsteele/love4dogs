import { json } from '@sveltejs/kit'

const BSKY_XRPC = 'https://bsky.social/xrpc'

export async function GET({ url }) {
	const uuid = url.searchParams.get('uuid')

	if (!uuid) {
		return json({ error: 'uuid required' }, { status: 400 })
	}

	try {
		// Search Bluesky for posts with this uuid
		const searchRes = await fetch(
			`${BSKY_XRPC}/app.bsky.feed.searchPosts?q=${encodeURIComponent(uuid)}&limit=100`,
			{
				headers: { accept: 'application/json' }
			}
		)

		if (!searchRes.ok) {
			return json({ error: 'Search failed' }, { status: 500 })
		}

		const searchData = await searchRes.json()
		const posts = searchData?.posts || []

		// Find the post with matching uuid in image alts
		for (const post of posts) {
			if (post.embed?.$type === 'app.bsky.embed.images') {
				for (const img of post.embed.images || []) {
					if (!img.alt) continue

					try {
						const altData = JSON.parse(img.alt)
						if (altData.canonicalurl?.includes(uuid)) {
							// Found it - return the profile JSON as-is
							return json(altData)
						}
					} catch {
						// Not JSON, skip
					}
				}
			}
		}

		return json({ error: 'Profile not found' }, { status: 404 })
	} catch (e) {
		console.error('[profile API] error:', e)
		return json({ error: e.message }, { status: 500 })
	}
}
