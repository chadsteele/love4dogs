import {json} from '@sveltejs/kit'
import {
	collectChunkPayloadsFromPosts,
	reconstructBundleFromChunkPayloads,
} from '$lib/bskyChunkStore'

const PUBLIC_XRPC = 'https://public.api.bsky.app/xrpc'

function collectThreadPosts(node, posts = [], seenUris = new Set()) {
	if (!node || typeof node !== 'object') return posts

	const post = node?.post && typeof node.post === 'object' ? node.post : null
	if (post) {
		const uri = String(post?.uri || '').trim()
		if (uri && !seenUris.has(uri)) {
			seenUris.add(uri)
			posts.push(post)
		}
	}

	if (Array.isArray(node?.replies)) {
		for (const reply of node.replies) {
			collectThreadPosts(reply, posts, seenUris)
		}
	}

	if (node?.parent && typeof node.parent === 'object') {
		collectThreadPosts(node.parent, posts, seenUris)
	}

	return posts
}

function parsePostUrl(rawUrl = '') {
	const value = String(rawUrl || '').trim()
	if (!value) return null

	if (value.startsWith('at://')) {
		const match = value.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)/)
		if (!match) return null
		return {did: match[1], rkey: match[2], postUri: value}
	}

	let parsed
	try {
		parsed = new URL(value)
	} catch {
		return null
	}

	const host = String(parsed.hostname || '').toLowerCase()
	if (host !== 'bsky.app' && host !== 'www.bsky.app') return null

	const segments = parsed.pathname.split('/').filter(Boolean)
	const profileIndex = segments.indexOf('profile')
	const postIndex = segments.indexOf('post')
	if (profileIndex < 0 || postIndex < 0) return null

	const handle = String(segments[profileIndex + 1] || '').trim()
	const rkey = String(segments[postIndex + 1] || '').trim()
	if (!handle || !rkey) return null

	return {handle, rkey}
}

async function resolveHandleToDid(handle = '') {
	const value = String(handle || '').trim()
	if (!value) throw new Error('Post URL is missing a handle')
	if (value.startsWith('did:')) return value

	const resolveUrl = `${PUBLIC_XRPC}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(value)}`
	const response = await fetch(resolveUrl, {headers: {accept: 'application/json'}})
	if (!response.ok) {
		throw new Error(`Unable to resolve handle ${value}`)
	}
	const jsonBody = await response.json().catch(() => ({}))
	const did = String(jsonBody?.did || '').trim()
	if (!did) throw new Error(`Handle resolution returned no DID for ${value}`)
	return did
}

function findChunkUuid(posts = []) {
	for (const post of Array.isArray(posts) ? posts : []) {
		const embed = post?.embed
		const media =
			embed?.$type === 'app.bsky.embed.recordWithMedia#view'
				? embed.media
				: embed
		const images =
			media?.$type === 'app.bsky.embed.images#view' ? media.images || [] : []
		for (const image of images) {
			const alt = String(image?.alt || '').trim()
			if (!alt) continue
			let parsed
			try {
				parsed = JSON.parse(alt)
			} catch {
				continue
			}
			if (!parsed || typeof parsed !== 'object') continue
			if (!('h' in parsed) || !Number.isFinite(Number(parsed?.i))) continue
			const uuid = String(parsed?.u || parsed?.uuid || '').trim()
			if (uuid) return uuid
		}
	}
	return ''
}

export async function POST({request}) {
	try {
		const body = await request.json().catch(() => ({}))
		const parsed = parsePostUrl(body?.postUrl)
		if (!parsed) {
			return json({error: 'A valid Bsky post URL is required.'}, {status: 400})
		}

		const did = String(parsed.did || '').trim() || await resolveHandleToDid(parsed.handle)
		const postUri = parsed.postUri || `at://${did}/app.bsky.feed.post/${parsed.rkey}`
		const threadUrl = `${PUBLIC_XRPC}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}&depth=100&parentHeight=100`
		const threadRes = await fetch(threadUrl, {headers: {accept: 'application/json'}})
		if (!threadRes.ok) {
			return json({error: 'Unable to load the post thread from Bluesky.'}, {status: 502})
		}

		const threadJson = await threadRes.json().catch(() => ({}))
		const posts = collectThreadPosts(threadJson?.thread, [], new Set())
		const uuid = findChunkUuid(posts)
		if (!uuid) {
			return json({error: 'No profile chunk payload was found in that post thread.'}, {status: 404})
		}

		const payloads = collectChunkPayloadsFromPosts(posts, {uuid})
		const bundle = reconstructBundleFromChunkPayloads(payloads)

		return json({
			source: {
				postUrl: String(body?.postUrl || '').trim(),
				postUri,
				did,
				rkey: parsed.rkey,
				uuid,
				payloadCount: payloads.length,
			},
			bundle,
		})
	} catch (error) {
		return json(
			{error: error?.message || 'Failed to recover profile from post URL.'},
			{status: 500},
		)
	}
}