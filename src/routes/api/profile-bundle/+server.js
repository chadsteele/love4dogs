import {json} from '@sveltejs/kit'
import {loadMostRecentProfileBundleFromPublicBsky} from '$lib/bskyChunkStore'
import {getPost, setPost} from '$lib/db.js'

export async function GET({url, fetch}) {
	const uuid = String(url.searchParams.get('uuid') || '').trim()
	if (!uuid) {
		return json({error: 'uuid required'}, {status: 400})
	}

	const cacheKey = `bsky:profile-bundle:${uuid}`;
	try {
		const cached = await getPost(cacheKey);
		if (cached) {
			return json(cached);
		}

		const bundle = await loadMostRecentProfileBundleFromPublicBsky({
			fetchImpl: fetch,
			uuid,
			author: 'love4dogs.club',
			debug: true,
		})
		await setPost(cacheKey, bundle);
		return json(bundle)
	} catch (error) {
		return json(
			{
				error: error?.message || 'Failed to load profile bundle',
				details: error?.details || null,
			},
			{status: 404},
		)
	}
}

export async function POST({request}) {
	try {
		const {uuid, bundle} = await request.json()
		if (!uuid || !bundle) {
			return json({error: 'uuid and bundle required'}, {status: 400})
		}
		const cacheKey = `bsky:profile-bundle:${uuid}`
		await setPost(cacheKey, bundle)
		return json({ok: true})
	} catch (error) {
		return json({error: error?.message || 'Failed to cache bundle'}, {status: 500})
	}
}


