import {json} from '@sveltejs/kit'
import {loadMostRecentProfileBundleFromPublicBsky} from '$lib/bskyChunkStore'

export async function GET({url, fetch}) {
	const uuid = String(url.searchParams.get('uuid') || '').trim()
	if (!uuid) {
		return json({error: 'uuid required'}, {status: 400})
	}

	try {
		const bundle = await loadMostRecentProfileBundleFromPublicBsky({
			fetchImpl: fetch,
			uuid,
			author: 'love4dogs.club',
			debug: true,
		})
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
