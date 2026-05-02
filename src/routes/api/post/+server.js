import { env } from '$env/dynamic/private';

const BSKY_XRPC = 'https://bsky.social/xrpc';

let cachedSession = null;

function getCredentials() {
	const identifier = env.BSKY_USERNAME || env.username;
	const secret = env.BSKY_PASSWORD || env.password;
	return { identifier, secret };
}

function getHashtags(text) {
	const matches = text.match(/(^|\s)#([\p{L}\p{N}_-]+)/gu) || [];
	return matches.map((tag) => tag.replace(/^[\s#]+/, '').toLowerCase());
}

function utf8ByteLength(text) {
	return new TextEncoder().encode(text).length;
}

function buildFacets(text) {
	const facets = [];
	const urlRegex = /https?:\/\/[^\s]+/g;
	const hashtagRegex = /(^|\s)#([\p{L}\p{N}_-]+)/gu;

	for (const match of text.matchAll(urlRegex)) {
		let uri = match[0];
		const start = match.index;
		let end = start + uri.length;

		while (/[),.!?:;]$/.test(uri)) {
			uri = uri.slice(0, -1);
			end -= 1;
		}

		if (!uri) continue;

		facets.push({
			index: {
				byteStart: utf8ByteLength(text.slice(0, start)),
				byteEnd: utf8ByteLength(text.slice(0, end))
			},
			features: [
				{
					$type: 'app.bsky.richtext.facet#link',
					uri
				}
			]
		});
	}

	for (const match of text.matchAll(hashtagRegex)) {
		const prefix = match[1] || '';
		const tag = match[2] || '';
		if (!tag) continue;

		const hashStart = match.index + prefix.length;
		const hashEnd = hashStart + tag.length + 1;

		facets.push({
			index: {
				byteStart: utf8ByteLength(text.slice(0, hashStart)),
				byteEnd: utf8ByteLength(text.slice(0, hashEnd))
			},
			features: [
				{
					$type: 'app.bsky.richtext.facet#tag',
					tag
				}
			]
		});
	}

	return facets;
}

function buildImageEmbed(uploadedImages) {
	if (!uploadedImages.length) return null;

	return {
		$type: 'app.bsky.embed.images',
		images: uploadedImages.map((image) => ({
			alt: image.alt,
			image: image.blob
		}))
	};
}

async function createSession() {
	const { identifier, secret } = getCredentials();

	if (!identifier || !secret) {
		throw new Error('Missing Bluesky credentials in .env');
	}

	const res = await fetch(`${BSKY_XRPC}/com.atproto.server.createSession`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ identifier, password: secret })
	});

	if (!res.ok) {
		throw new Error('Failed to authenticate to Bluesky. Check .env credentials.');
	}

	cachedSession = await res.json();
	return cachedSession;
}

async function getSession() {
	if (cachedSession?.accessJwt && cachedSession?.did) {
		return cachedSession;
	}

	return createSession();
}

async function uploadBlob(accessJwt, file) {
	const res = await fetch(`${BSKY_XRPC}/com.atproto.repo.uploadBlob`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${accessJwt}`,
			'content-type': file.type || 'application/octet-stream'
		},
		body: Buffer.from(await file.arrayBuffer())
	});

	if (!res.ok) {
		throw new Error('Image upload failed.');
	}

	const json = await res.json();
	return json.blob;
}

export async function POST({ request }) {
	try {
		const formData = await request.formData();
		const rawText = String(formData.get('text') || '').trim();
		const images = formData
			.getAll('images')
			.filter((entry) => entry instanceof File && entry.size > 0);

		if (!rawText) {
			return new Response(JSON.stringify({ error: 'Post text is required.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		const textLength = [...rawText].length;
		if (textLength > 300) {
			return new Response(JSON.stringify({ error: 'Post text exceeds 300 character limit.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		if (images.length > 4) {
			return new Response(JSON.stringify({ error: 'You can upload up to 4 photos per post.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		const session = await getSession();
		const uploaded = [];

		for (const image of images) {
			const blob = await uploadBlob(session.accessJwt, image);
			uploaded.push({ blob, alt: image.name || 'Photo' });
		}

		const tags = getHashtags(rawText).slice(0, 20);
		const record = {
			$type: 'app.bsky.feed.post',
			text: rawText,
			createdAt: new Date().toISOString(),
			tags
		};

		const facets = buildFacets(rawText);
		if (facets.length) record.facets = facets;

		const embed = buildImageEmbed(uploaded);
		if (embed) record.embed = embed;

		const createRecordRes = await fetch(`${BSKY_XRPC}/com.atproto.repo.createRecord`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${session.accessJwt}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				repo: session.did,
				collection: 'app.bsky.feed.post',
				record
			})
		});

		if (!createRecordRes.ok) {
			cachedSession = null;
			const errBody = await createRecordRes.json().catch(() => ({}));
			throw new Error(errBody.message || errBody.error || `Bluesky error ${createRecordRes.status}`);
		}

		const result = await createRecordRes.json();
		return new Response(JSON.stringify({ ok: true, result, tags }), {
			headers: { 'content-type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: error.message || 'Unexpected error.' }), {
			status: 500,
			headers: { 'content-type': 'application/json' }
		});
	}
}
