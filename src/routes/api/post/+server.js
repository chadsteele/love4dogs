import { env } from '$env/dynamic/private';
import { MEDIA_TOKEN_PREFIX } from '$lib/utils.js';
import { createHash } from 'node:crypto';

const BSKY_XRPC = 'https://bsky.social/xrpc';
const MAX_IMAGE_SIZE_BYTES = 2_000_000; // Bluesky's hard limit is 2,000,000 bytes (not 2 MiB)
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const MEDIA_CACHE_PREFIX = MEDIA_TOKEN_PREFIX;
const LEGACY_MEDIA_CACHE_PREFIX = 'L4D_MEDIA_CACHE:';
const DELETE_DELAY_BASE_MIN_MS = 2_000;
const DELETE_DELAY_BASE_MAX_MS = 5_000;
const DELETE_DELAY_MAX_MS = 60_000;

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

function buildVideoEmbed(uploadedVideo) {
	if (!uploadedVideo) return null;

	return {
		$type: 'app.bsky.embed.video',
		video: uploadedVideo.blob,
		alt: uploadedVideo.alt
	};
}

function isAuthLikeFailure(status, message = '') {
	const value = String(message || '');
	return (
		status === 401 ||
		status === 403 ||
		/token\s+has\s+expired|expired\s+token|invalid\s+token|jwt|auth(entication)?\s+required|session\s+expired/i.test(
			value
		)
	);
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function nextDeleteDelayMs(currentDelayMs, outcome = 'success') {
	if (outcome === 'throttled') {
		const raised = Math.max(
			DELETE_DELAY_BASE_MAX_MS,
			Math.min(DELETE_DELAY_MAX_MS, Math.round(currentDelayMs * 2))
		);
		const jitter = Math.max(500, Math.round(raised * 0.2));
		return Math.min(DELETE_DELAY_MAX_MS, raised + randomBetween(0, jitter));
	}

	if (outcome === 'transient-error') {
		const raised = Math.max(
			DELETE_DELAY_BASE_MAX_MS,
			Math.min(DELETE_DELAY_MAX_MS, Math.round(currentDelayMs * 1.5))
		);
		const jitter = Math.max(500, Math.round(raised * 0.15));
		return Math.min(DELETE_DELAY_MAX_MS, raised + randomBetween(0, jitter));
	}

	if (currentDelayMs <= DELETE_DELAY_BASE_MAX_MS) {
		return randomBetween(DELETE_DELAY_BASE_MIN_MS, DELETE_DELAY_BASE_MAX_MS);
	}

	const lowered = Math.max(
		DELETE_DELAY_BASE_MIN_MS,
		Math.round(currentDelayMs * 0.7)
	);
	const jitter = Math.max(250, Math.round(lowered * 0.1));
	return Math.max(
		DELETE_DELAY_BASE_MIN_MS,
		lowered - randomBetween(0, jitter)
	);
}

function classifyDeleteFailure(status, message = '') {
	const value = String(message || '');
	if (status === 429 || /rate|throttl|too many/i.test(value)) {
		return 'throttled';
	}
	if (status >= 500 || /temporar|timeout|unavailable|reset|network/i.test(value)) {
		return 'transient-error';
	}
	return 'permanent-error';
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

async function uploadBlob(accessJwt, file, kindLabel = 'Media') {
	const uploadBody = Buffer.from(await file.arrayBuffer());

	async function doUpload(jwt) {
		return fetch(`${BSKY_XRPC}/com.atproto.repo.uploadBlob`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${jwt}`,
				'content-type': file.type || 'application/octet-stream'
			},
			body: uploadBody
		});
	}

	let res = await doUpload(accessJwt);
	let errBody = null;

	if (!res.ok) {
		errBody = await res.json().catch(() => ({}));
		const errMessage = String(errBody?.message || errBody?.error || '');
		const authLikeError =
			res.status === 401 ||
			res.status === 403 ||
			/token\s+has\s+expired|expired\s+token|invalid\s+token|jwt/i.test(errMessage);

		if (authLikeError) {
			cachedSession = null;
			const refreshed = await createSession();
			res = await doUpload(refreshed.accessJwt);
			if (!res.ok) {
				errBody = await res.json().catch(() => ({}));
			}
		}
	}

	if (!res.ok) {
		throw new Error(errBody?.message || errBody?.error || `${kindLabel} upload failed.`);
	}

	const json = await res.json().catch(() => ({}));
	if (!json?.blob || typeof json.blob !== 'object') {
		throw new Error(`${kindLabel} upload failed.`);
	}
	return json.blob;
}

function parsePostAtUri(uri) {
	const match = String(uri || '').match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/);
	if (!match) return null;
	return {
		repo: match[1],
		rkey: match[2],
		uri: match[0]
	};
}

function getBlobCid(blobRef) {
	if (!blobRef || typeof blobRef !== 'object') return '';
	return String(blobRef.ref?.$link || blobRef.cid || '').trim();
}

function buildImageCdnUrl(did, blobRef) {
	const cid = getBlobCid(blobRef);
	if (!did || !cid) return '';
	return `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`;
}

function parseBskyCdnImageUrl(value = '') {
	const source = String(value || '').trim();
	if (!source) return null;
	let parsed;
	try {
		parsed = new URL(source);
	} catch {
		return null;
	}
	if (!/^cdn\.bsky\.app$/i.test(parsed.hostname)) return null;
	const match = parsed.pathname.match(/^\/img\/[^/]+\/plain\/([^/]+)\/([^@/?#]+)@([^/?#]+)$/i);
	if (!match) return null;
	return {
		did: String(match[1] || '').trim(),
		cid: String(match[2] || '').trim(),
		encoding: String(match[3] || '').trim().toLowerCase(),
	};
}

function mimeTypeFromEncoding(encoding = '') {
	const value = String(encoding || '').toLowerCase();
	if (value.includes('png')) return 'image/png';
	if (value.includes('webp')) return 'image/webp';
	if (value.includes('gif')) return 'image/gif';
	if (value.includes('avif')) return 'image/avif';
	if (value.includes('jpg') || value.includes('jpeg')) return 'image/jpeg';
	return 'image/jpeg';
}

async function buildBlobRefFromCdnImageUrl(url = '') {
	const parsed = parseBskyCdnImageUrl(url);
	if (!parsed) return null;

	let size = 0;
	let mimeType = mimeTypeFromEncoding(parsed.encoding);
	try {
		const headRes = await fetch(String(url), {
			method: 'HEAD',
			cache: 'no-store'
		});
		if (headRes.ok) {
			const headerType = String(headRes.headers.get('content-type') || '').trim();
			const headerLen = Number(headRes.headers.get('content-length') || 0);
			if (headerType) mimeType = headerType;
			if (Number.isFinite(headerLen) && headerLen > 0) size = Math.floor(headerLen);
		}
	} catch {
		// Best effort only; blob refs can still be reconstructed from DID/CID.
	}

	return {
		did: parsed.did,
		cid: parsed.cid,
		blob: {
			$type: 'blob',
			ref: {
				$link: parsed.cid,
			},
			mimeType,
			size,
		},
	};
}

function isHttpUrl(value) {
	return /^https?:\/\//i.test(String(value || '').trim());
}

function isCacheableMediaSource(value) {
	const source = String(value || '').trim();
	if (!source) return false;
	if (isHttpUrl(source)) return true;
	if (source.startsWith(MEDIA_CACHE_PREFIX)) return true;
	if (/^inline:/i.test(source)) return true;
	return false;
}

function buildCachePostPrefix(name, description) {
	const parts = [name, description].filter(Boolean)
	if (!parts.length) return ''
	const combined = parts.join(' — ')
	return combined.length > 200 ? combined.slice(0, 200) : combined
}

function buildMediaCacheToken(sourceUrl) {
	const source = String(sourceUrl || '').trim();
	if (!source.startsWith(MEDIA_CACHE_PREFIX)) {
		throw new Error(`sourceUrl must be a content-hash token, not a URL: ${source}`);
	}
	return source;
}

function mediaTokenFromDigestHex(hex = '') {
	return `${MEDIA_CACHE_PREFIX}${String(hex || '').toLowerCase().slice(0, 12)}`;
}

async function mediaTokenFromFile(file) {
	const bytes = Buffer.from(await file.arrayBuffer());
	const digestHex = createHash('sha256').update(bytes).digest('hex');
	return mediaTokenFromDigestHex(digestHex);
}

async function fetchRemoteImageFile(sourceUrl) {
	const source = String(sourceUrl || '').trim();
	if (!isHttpUrl(source)) {
		throw new Error('A valid source URL or inline source token is required.');
	}

	const res = await fetch(source, {
		method: 'GET',
		cache: 'no-store'
	});
	if (!res.ok) {
		throw new Error(`Unable to fetch image URL: ${source}`);
	}

	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	if (!contentType.startsWith('image/')) {
		throw new Error('Only images are supported for URL caching.');
	}

	const bytes = Buffer.from(await res.arrayBuffer());
	if (bytes.length <= 0) {
		throw new Error('Media file is required.');
	}
	if (bytes.length > MAX_IMAGE_SIZE_BYTES) {
		throw new Error('Each image must be 2 MB or smaller.');
	}

	let fileName = 'remote-image';
	try {
		const parsed = new URL(source);
		fileName = decodeURIComponent(parsed.pathname.split('/').pop() || fileName);
	} catch {
		// Keep fallback file name.
	}

	return new File([bytes], fileName, {
		type: contentType || 'image/jpeg'
	});
}

function extractCacheMarker(text = '') {
	const lines = String(text || '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const line = lines[i];
		if (line.startsWith(MEDIA_CACHE_PREFIX) || line.startsWith(LEGACY_MEDIA_CACHE_PREFIX)) {
			return line;
		}
	}

	return '';
}

function buildMediaCacheMarker(sourceUrl) {
	// The token itself is the full marker (prefix + hash)
	return buildMediaCacheToken(sourceUrl);
}

async function findCachedImageBlobBySourceUrl(session, sourceUrl) {
	const marker = buildMediaCacheMarker(sourceUrl);
	const legacyMarker = `${LEGACY_MEDIA_CACHE_PREFIX}${sourceUrl}`;
	let cursor = '';
	for (let page = 0; page < 5; page += 1) {
		const qs = new URLSearchParams({
			repo: session.did,
			collection: 'app.bsky.feed.post',
			limit: '100',
			reverse: 'true'
		});
		if (cursor) qs.set('cursor', cursor);

		const res = await fetch(`${BSKY_XRPC}/com.atproto.repo.listRecords?${qs.toString()}`, {
			headers: {
				authorization: `Bearer ${session.accessJwt}`,
				accept: 'application/json'
			}
		});

		if (!res.ok) {
			if (res.status === 401 || res.status === 403) cachedSession = null;
			break;
		}

		const json = await res.json().catch(() => ({}));
		const records = Array.isArray(json?.records) ? json.records : [];
		for (const record of records) {
			const text = String(record?.value?.text || '');
			const foundMarker = extractCacheMarker(text);
			if (foundMarker !== marker && foundMarker !== legacyMarker) continue;
			const embed = record?.value?.embed;
			const blob = embed?.images?.[0]?.image || null;
			if (!blob || typeof blob !== 'object') continue;
			return {
				blob,
				uri: String(record?.uri || ''),
				cid: String(record?.cid || '')
			};
		}

		cursor = String(json?.cursor || '');
		if (!cursor) break;
	}

	return null;
}

function mapSinglePostFromThread(threadPost) {
	const post = threadPost?.post;
	if (!post) return null;

	const record = post.record || {};
	const images = [];
	const imageAlts = [];
	let video = null;

	const embedView = post.embed;
	const mediaView =
		embedView?.$type === 'app.bsky.embed.recordWithMedia#view' ? embedView.media : embedView;

	if (mediaView?.$type === 'app.bsky.embed.images#view') {
		for (const image of mediaView.images || []) {
			if (image.fullsize) {
				images.push(image.fullsize);
				imageAlts.push(String(image.alt || ''));
			}
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
		imageAlts,
		video
	};
}

export async function GET({ url }) {
	try {
		const uri = String(url.searchParams.get('uri') || '').trim();
		if (!uri) {
			return new Response(JSON.stringify({ error: 'Post URI is required.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		if (!parsePostAtUri(uri)) {
			return new Response(JSON.stringify({ error: 'Invalid post URI.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		let session = await getSession();
		let res = await fetch(
			`${BSKY_XRPC}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`,
			{
				headers: {
					authorization: `Bearer ${session.accessJwt}`,
					accept: 'application/json'
				}
			}
		);

		if (!res.ok) {
			let errBody = await res.json().catch(() => ({}));
			const errMessage = String(errBody?.message || errBody?.error || '');
			if (isAuthLikeFailure(res.status, errMessage)) {
				cachedSession = null;
				session = await createSession();
				res = await fetch(
					`${BSKY_XRPC}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`,
					{
						headers: {
							authorization: `Bearer ${session.accessJwt}`,
							accept: 'application/json'
						}
					}
				);
				if (!res.ok) {
					errBody = await res.json().catch(() => ({}));
				}
			}

			if (!res.ok) {
				if (res.status === 401 || res.status === 403) cachedSession = null;
				return new Response(
					JSON.stringify({ error: errBody.message || errBody.error || 'Unable to load post.' }),
					{
						status: res.status,
						headers: { 'content-type': 'application/json' }
					}
				);
			}
		}

		const json = await res.json();
		const post = mapSinglePostFromThread(json?.thread);
		if (!post) {
			return new Response(JSON.stringify({ error: 'Post not found.' }), {
				status: 404,
				headers: { 'content-type': 'application/json' }
			});
		}

		return new Response(JSON.stringify({ ok: true, post }), {
			headers: { 'content-type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: error.message || 'Unexpected error.' }), {
			status: 500,
			headers: { 'content-type': 'application/json' }
		});
	}
}

export async function POST({ request }) {
	try {
		const formData = await request.formData();
		const mode = String(formData.get('mode') || '').trim();

		if (mode === 'upload-media') {
			const file = formData.get('file');
			if (!(file instanceof File) || file.size <= 0) {
				return new Response(JSON.stringify({ error: 'Media file is required.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			const isImage = String(file.type || '').startsWith('image/');
			const isVideo = String(file.type || '').startsWith('video/');
			if (!isImage && !isVideo) {
				return new Response(JSON.stringify({ error: 'Only images and videos are supported.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			if (isImage && file.size > MAX_IMAGE_SIZE_BYTES) {
				return new Response(JSON.stringify({ error: 'Each image must be 2 MB or smaller.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			if (isVideo && file.size > MAX_VIDEO_SIZE_BYTES) {
				return new Response(JSON.stringify({ error: 'Video must be 100 MB or smaller.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			const session = await getSession();
			const kindLabel = isImage ? 'Image' : 'Video';
			const blob = await uploadBlob(session.accessJwt, file, kindLabel);
			const cid = String(blob?.ref?.$link || blob?.cid || '');
			const imageUrl =
				isImage && cid && session?.did
					? `https://cdn.bsky.app/img/feed_fullsize/plain/${session.did}/${cid}@jpeg`
					: '';
			return new Response(
				JSON.stringify({
					ok: true,
					kind: isImage ? 'image' : 'video',
					alt: file.name || (isImage ? 'Photo' : 'Video'),
					blob,
					did: session?.did || '',
					url: imageUrl
				}),
				{
					headers: { 'content-type': 'application/json' }
				}
			);
		}

		if (mode === 'cache-media-url') {
			const sourceUrl = String(formData.get('sourceUrl') || '').trim();
			const rawName = String(formData.get('profileName') || '').trim();
			const rawDesc = String(formData.get('profileDescription') || '').trim();
			if (!isCacheableMediaSource(sourceUrl)) {
				return new Response(JSON.stringify({ error: 'A valid source URL or inline source token is required.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			let file = formData.get('file');
			if (!(file instanceof File) || file.size <= 0) {
				if (isHttpUrl(sourceUrl)) {
					file = await fetchRemoteImageFile(sourceUrl);
				}
			}

			let cacheToken = '';
			if (sourceUrl.startsWith(MEDIA_CACHE_PREFIX)) {
				cacheToken = buildMediaCacheToken(sourceUrl);
			} else if (file instanceof File && file.size > 0) {
				cacheToken = await mediaTokenFromFile(file);
			}

			if (!cacheToken) {
				return new Response(JSON.stringify({ error: 'Unable to derive media cache token from source image.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			const marker = buildMediaCacheMarker(cacheToken);
			const prefix = buildCachePostPrefix(rawName, rawDesc);
			const cacheText = prefix ? `${prefix}\n${marker}` : marker;

			const session = await getSession();
			const cached = await findCachedImageBlobBySourceUrl(session, cacheToken);
			if (cached?.blob) {
				return new Response(
					JSON.stringify({
						ok: true,
						cached: true,
						cacheToken,
						kind: 'image',
						alt: file instanceof File ? file.name || 'Photo' : 'Photo',
						blob: cached.blob,
						did: session.did,
						url: buildImageCdnUrl(session.did, cached.blob),
						cacheUri: cached.uri,
						cacheCid: cached.cid
					}),
					{
						headers: { 'content-type': 'application/json' }
					}
				);
			}

			if (!(file instanceof File) || file.size <= 0) {
				return new Response(JSON.stringify({ error: 'Media file is required.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			const isImage = String(file.type || '').startsWith('image/');
			if (!isImage) {
				return new Response(JSON.stringify({ error: 'Only images are supported for URL caching.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			if (file.size > MAX_IMAGE_SIZE_BYTES) {
				return new Response(JSON.stringify({ error: 'Each image must be 2 MB or smaller.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			const blob = await uploadBlob(session.accessJwt, file, 'Image');
			const record = {
				$type: 'app.bsky.feed.post',
				text: cacheText.slice(0, 300),
				createdAt: new Date().toISOString(),
				embed: {
					$type: 'app.bsky.embed.images',
					images: [
						{
							alt: sourceUrl,
							image: blob
						}
					]
				}
			};

			let cacheSession = session;
			let createRes = await fetch(`${BSKY_XRPC}/com.atproto.repo.createRecord`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${cacheSession.accessJwt}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					repo: cacheSession.did,
					collection: 'app.bsky.feed.post',
					record
				})
			});

			if (!createRes.ok) {
				const errBody = await createRes.json().catch(() => ({}));
				const errMessage = String(errBody?.message || errBody?.error || '');
				if (isAuthLikeFailure(createRes.status, errMessage)) {
					cachedSession = null;
					cacheSession = await createSession();
					createRes = await fetch(`${BSKY_XRPC}/com.atproto.repo.createRecord`, {
						method: 'POST',
						headers: {
							authorization: `Bearer ${cacheSession.accessJwt}`,
							'content-type': 'application/json'
						},
						body: JSON.stringify({
							repo: cacheSession.did,
							collection: 'app.bsky.feed.post',
							record
						})
					});
				}
			}

			if (!createRes.ok) {
				const errBody = await createRes.json().catch(() => ({}));
				return new Response(
					JSON.stringify({
						error: errBody.message || errBody.error || 'Failed to create media cache post.'
					}),
					{
						status: 502,
						headers: { 'content-type': 'application/json' }
					}
				);
			}

			const created = await createRes.json().catch(() => ({}));
			return new Response(
				JSON.stringify({
					ok: true,
					cached: false,
					cacheToken,
					kind: 'image',
					alt: file.name || 'Photo',
					blob,
					did: cacheSession.did,
					url: buildImageCdnUrl(cacheSession.did, blob),
					cacheUri: created?.uri || '',
					cacheCid: created?.cid || ''
				}),
				{
					headers: { 'content-type': 'application/json' }
				}
			);
		}

		if (mode === 'resolve-cdn-blob') {
			const sourceUrl = String(formData.get('sourceUrl') || '').trim();
			if (!sourceUrl) {
				return new Response(JSON.stringify({ error: 'sourceUrl is required.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			const resolved = await buildBlobRefFromCdnImageUrl(sourceUrl);
			if (!resolved?.blob) {
				return new Response(JSON.stringify({ error: 'Invalid Bluesky CDN image URL.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			return new Response(
				JSON.stringify({
					ok: true,
					kind: 'image',
					blob: resolved.blob,
					did: resolved.did,
					url: sourceUrl,
				}),
				{
					headers: { 'content-type': 'application/json' }
				}
			);
		}

		if (mode === 'delete-post-uri') {
			const uri = String(formData.get('uri') || '').trim();
			if (!uri) {
				return new Response(JSON.stringify({ error: 'Post URI is required.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			const target = parsePostAtUri(uri);
			if (!target) {
				return new Response(JSON.stringify({ error: 'Invalid post URI.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			let session = await getSession();
			if (session.did && target.repo !== session.did) {
				return new Response(
					JSON.stringify({ error: 'URI does not belong to authenticated repo.' }),
					{
						status: 403,
						headers: { 'content-type': 'application/json' }
					}
				);
			}

			let deleteRes = await fetch(`${BSKY_XRPC}/com.atproto.repo.deleteRecord`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${session.accessJwt}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					repo: session.did,
					collection: 'app.bsky.feed.post',
					rkey: target.rkey
				})
			});

			if (!deleteRes.ok) {
				const errBody = await deleteRes.json().catch(() => ({}));
				const errMessage = String(errBody?.message || errBody?.error || '');
				if (isAuthLikeFailure(deleteRes.status, errMessage)) {
					cachedSession = null;
					session = await createSession();
					deleteRes = await fetch(`${BSKY_XRPC}/com.atproto.repo.deleteRecord`, {
						method: 'POST',
						headers: {
							authorization: `Bearer ${session.accessJwt}`,
							'content-type': 'application/json'
						},
						body: JSON.stringify({
							repo: session.did,
							collection: 'app.bsky.feed.post',
							rkey: target.rkey
						})
					});
				}
			}

			if (!deleteRes.ok) {
				const errBody = await deleteRes.json().catch(() => ({}));
				return new Response(
					JSON.stringify({
						error:
							errBody?.message ||
							errBody?.error ||
							'Failed to delete post URI.'
					}),
					{
						status: 502,
						headers: { 'content-type': 'application/json' }
					}
				);
			}

			return new Response(JSON.stringify({ ok: true, deleted: [target.uri] }), {
				headers: { 'content-type': 'application/json' }
			});
		}

		const rawText = String(formData.get('text') || '').trim();
		const images = formData
			.getAll('images')
			.filter((entry) => entry instanceof File && entry.size > 0);
		const videos = formData
			.getAll('videos')
			.filter((entry) => entry instanceof File && entry.size > 0);
		const uploadedMediaRaw = String(formData.get('uploadedMedia') || '').trim();
		let uploadedMedia = [];
		if (uploadedMediaRaw) {
			try {
				uploadedMedia = JSON.parse(uploadedMediaRaw);
			} catch {
				return new Response(JSON.stringify({ error: 'Invalid uploaded media payload.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}
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

		if (images.length > 0 && videos.length > 0) {
			return new Response(JSON.stringify({ error: 'Choose either photos or one video per post.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		if (videos.length > 1) {
			return new Response(JSON.stringify({ error: 'Only one video is allowed per post.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		if (uploadedMedia.length > 0 && (images.length > 0 || videos.length > 0)) {
			return new Response(JSON.stringify({ error: 'Submit with uploaded media or raw files, not both.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		for (const image of images) {
			if (!String(image.type || '').startsWith('image/')) {
				return new Response(JSON.stringify({ error: 'Unsupported image format.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}
			if (image.size > MAX_IMAGE_SIZE_BYTES) {
				return new Response(JSON.stringify({ error: 'Each image must be 2 MB or smaller.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}
		}

		for (const video of videos) {
			if (!String(video.type || '').startsWith('video/')) {
				return new Response(JSON.stringify({ error: 'Unsupported video format.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}
			if (video.size > MAX_VIDEO_SIZE_BYTES) {
				return new Response(JSON.stringify({ error: 'Video must be 100 MB or smaller.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}
		}

		const session = await getSession();
		const uploaded = [];
		let uploadedVideo = null;

		if (uploadedMedia.length > 0) {
			if (!Array.isArray(uploadedMedia)) {
				return new Response(JSON.stringify({ error: 'Invalid uploaded media payload.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			const uploadedImages = uploadedMedia.filter((entry) => entry?.kind === 'image');
			const uploadedVideos = uploadedMedia.filter((entry) => entry?.kind === 'video');

			if (uploadedImages.length > 0 && uploadedVideos.length > 0) {
				return new Response(JSON.stringify({ error: 'Choose either photos or one video per post.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			if (uploadedImages.length > 4) {
				return new Response(JSON.stringify({ error: 'You can upload up to 4 photos per post.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			if (uploadedVideos.length > 1) {
				return new Response(JSON.stringify({ error: 'Only one video is allowed per post.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			for (const image of uploadedImages) {
				if (!image?.blob || typeof image.blob !== 'object') {
					return new Response(JSON.stringify({ error: 'Invalid uploaded image payload.' }), {
						status: 400,
						headers: { 'content-type': 'application/json' }
					});
				}
				uploaded.push({
					blob: image.blob,
					alt: String(image.alt || 'Photo')
				});
			}

			if (uploadedVideos.length === 1) {
				const video = uploadedVideos[0];
				if (!video?.blob || typeof video.blob !== 'object') {
					return new Response(JSON.stringify({ error: 'Invalid uploaded video payload.' }), {
						status: 400,
						headers: { 'content-type': 'application/json' }
					});
				}
				uploadedVideo = {
					blob: video.blob,
					alt: String(video.alt || 'Video')
				};
			}
		} else {
			for (const image of images) {
				const blob = await uploadBlob(session.accessJwt, image, 'Image');
				uploaded.push({ blob, alt: image.name || 'Photo' });
			}

			if (videos.length === 1) {
				const video = videos[0];
				const blob = await uploadBlob(session.accessJwt, video, 'Video');
				uploadedVideo = { blob, alt: video.name || 'Video' };
			}
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
		if (embed) {
			record.embed = embed;
		} else {
			const videoEmbed = buildVideoEmbed(uploadedVideo);
			if (videoEmbed) record.embed = videoEmbed;
		}

		const replyRaw = String(formData.get('reply') || '').trim();
		if (replyRaw) {
			try {
				const replyRef = JSON.parse(replyRaw);
				const rootUri = replyRef?.root?.uri;
				const rootCid = replyRef?.root?.cid;
				const parentUri = replyRef?.parent?.uri;
				const parentCid = replyRef?.parent?.cid;
				if (rootUri && rootCid && parentUri && parentCid) {
					record.reply = {
						root: { uri: rootUri, cid: rootCid },
						parent: { uri: parentUri, cid: parentCid }
					};
				}
			} catch {
				// invalid reply JSON — post without reply
			}
		}

		let createRecordSession = session;
		let recordToCreate = record;
		let createRecordRes = null;
		let lastErrorMessage = '';
		let retriedAfterAuth = false;
		let retriedWithoutFacets = false;

		while (true) {
			createRecordRes = await fetch(`${BSKY_XRPC}/com.atproto.repo.createRecord`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${createRecordSession.accessJwt}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					repo: createRecordSession.did,
					collection: 'app.bsky.feed.post',
					record: recordToCreate
				})
			});

			if (createRecordRes.ok) break;

			const errBody = await createRecordRes.json().catch(() => ({}));
			const errMessage = String(
				errBody.message || errBody.error || `Bluesky error ${createRecordRes.status}`
			);
			lastErrorMessage = errMessage;

			console.error('Bluesky createRecord failed:', {
				status: createRecordRes.status,
				errBody,
				errMessage,
				textLength: [...rawText].length,
				imageCount: uploaded.length,
				hasVideo: Boolean(uploadedVideo),
				hadFacets: Boolean(recordToCreate.facets?.length),
				retriedAfterAuth,
				retriedWithoutFacets
			});

			if (!retriedAfterAuth && isAuthLikeFailure(createRecordRes.status, errMessage)) {
				cachedSession = null;
				createRecordSession = await createSession();
				retriedAfterAuth = true;
				continue;
			}

			const looksLikeFacetIssue = /facet|richtext|bytestart|byteend|index/i.test(errMessage);
			if (!retriedWithoutFacets && recordToCreate.facets?.length && looksLikeFacetIssue) {
				recordToCreate = { ...recordToCreate };
				delete recordToCreate.facets;
				retriedWithoutFacets = true;
				continue;
			}

			break;
		}

		if (!createRecordRes?.ok) {
			const status = createRecordRes?.status;
			const responseStatus = status >= 400 && status < 500 ? 400 : 502;
			return new Response(JSON.stringify({ error: lastErrorMessage || 'Unable to publish post.' }), {
				status: responseStatus,
				headers: { 'content-type': 'application/json' }
			});
		}

		const result = await createRecordRes.json();
		return new Response(JSON.stringify({ ok: true, result, tags }), {
			headers: { 'content-type': 'application/json' }
		});
	} catch (error) {
		console.error('POST /api/post failed:', error?.message || error, error?.stack || '');
		return new Response(JSON.stringify({ error: error.message || 'Unexpected error.' }), {
			status: 500,
			headers: { 'content-type': 'application/json' }
		});
	}
}

export async function DELETE({ request, url }) {
	try {
		const host = url.hostname;
		const isLocalRequest = host === 'localhost' || host === '127.0.0.1' || host === '::1';
		if (!isLocalRequest) {
			return new Response(JSON.stringify({ error: 'Bulk delete is only enabled on localhost.' }), {
				status: 403,
				headers: { 'content-type': 'application/json' }
			});
		}

		const body = await request.json().catch(() => ({}));
		const uris = Array.isArray(body.uris) ? body.uris : [];
		if (!uris.length) {
			return new Response(JSON.stringify({ error: 'No post URIs were provided.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		let session = await getSession();
		const parsedTargets = uris
			.map((uri) => parsePostAtUri(uri))
			.filter(Boolean)
			.filter((target, index, arr) => arr.findIndex((item) => item.uri === target.uri) === index);

		const deleted = [];
		const failed = [];
		let deleteDelayMs = randomBetween(DELETE_DELAY_BASE_MIN_MS, DELETE_DELAY_BASE_MAX_MS);
		console.log('[DELETE /api/post] starting bulk delete', {
			totalTargets: parsedTargets.length,
			initialDelayMs: deleteDelayMs
		});

		for (let index = 0; index < parsedTargets.length; index += 1) {
			const target = parsedTargets[index];
			console.log('[DELETE /api/post] deleting target', {
				index: index + 1,
				total: parsedTargets.length,
				uri: target.uri,
				currentDelayMs: deleteDelayMs
			});
			if (session.did && target.repo !== session.did) {
				failed.push({ uri: target.uri, error: 'URI does not belong to authenticated repo.' });
				console.warn('[DELETE /api/post] skipped target', {
					uri: target.uri,
					reason: 'URI does not belong to authenticated repo.'
				});
				continue;
			}

			let response = await fetch(`${BSKY_XRPC}/com.atproto.repo.deleteRecord`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${session.accessJwt}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					repo: session.did,
					collection: 'app.bsky.feed.post',
					rkey: target.rkey
				})
			});

			if (!response.ok) {
				const errBody = await response.json().catch(() => ({}));
				const errMessage = String(errBody?.message || errBody?.error || '');
				if (isAuthLikeFailure(response.status, errMessage)) {
					cachedSession = null;
					session = await createSession();
					response = await fetch(`${BSKY_XRPC}/com.atproto.repo.deleteRecord`, {
						method: 'POST',
						headers: {
							authorization: `Bearer ${session.accessJwt}`,
							'content-type': 'application/json'
						},
						body: JSON.stringify({
							repo: session.did,
							collection: 'app.bsky.feed.post',
							rkey: target.rkey
						})
					});
				}
			}

			if (response.ok) {
				deleted.push(target.uri);
				deleteDelayMs = nextDeleteDelayMs(deleteDelayMs, 'success');
				console.log('[DELETE /api/post] deleted target', {
					uri: target.uri,
					nextDelayMs: deleteDelayMs
				});
			} else {
				const errBody = await response.json().catch(() => ({}));
				const errMessage = errBody.message || errBody.error || `Bluesky error ${response.status}`;
				const failureType = classifyDeleteFailure(response.status, errMessage);
				failed.push({
					uri: target.uri,
					error: errMessage
				});

				if (isAuthLikeFailure(response.status, errMessage)) {
					cachedSession = null;
				}

				deleteDelayMs = nextDeleteDelayMs(deleteDelayMs, failureType);
				console.warn('[DELETE /api/post] failed target', {
					uri: target.uri,
					status: response.status,
					error: errMessage,
					failureType,
					nextDelayMs: deleteDelayMs
				});
			}

			if (index < parsedTargets.length - 1) {
				console.log('[DELETE /api/post] waiting before next delete', {
					waitMs: deleteDelayMs,
					nextIndex: index + 2,
					total: parsedTargets.length
				});
				await wait(deleteDelayMs);
			}
		}

		console.log('[DELETE /api/post] bulk delete complete', {
			deletedCount: deleted.length,
			failedCount: failed.length
		});

		if (deleted.length === 0 && failed.length > 0) {
			return new Response(JSON.stringify({ ok: false, error: 'No posts were deleted.', failed }), {
				status: 502,
				headers: { 'content-type': 'application/json' }
			});
		}

		return new Response(JSON.stringify({ ok: true, deleted, failed }), {
			headers: { 'content-type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: error.message || 'Unexpected error.' }), {
			status: 500,
			headers: { 'content-type': 'application/json' }
		});
	}
}
