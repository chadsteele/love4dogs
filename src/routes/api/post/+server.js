import { env } from '$env/dynamic/private';
import { MEDIA_TOKEN_PREFIX } from '$lib/utils.js';

const BSKY_XRPC = 'https://bsky.social/xrpc';
const MAX_IMAGE_SIZE_BYTES = 2_000_000; // Bluesky's hard limit is 2,000,000 bytes (not 2 MiB)
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const MEDIA_CACHE_PREFIX = MEDIA_TOKEN_PREFIX;
const LEGACY_MEDIA_CACHE_PREFIX = 'L4D_MEDIA_CACHE:';

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
			if (text !== marker && text !== legacyMarker) continue;
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
	let video = null;

	const embedView = post.embed;
	const mediaView =
		embedView?.$type === 'app.bsky.embed.recordWithMedia#view' ? embedView.media : embedView;

	if (mediaView?.$type === 'app.bsky.embed.images#view') {
		for (const image of mediaView.images || []) {
			if (image.fullsize) images.push(image.fullsize);
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

		const session = await getSession();
		const res = await fetch(
			`${BSKY_XRPC}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`,
			{
				headers: {
					authorization: `Bearer ${session.accessJwt}`,
					accept: 'application/json'
				}
			}
		);

		if (!res.ok) {
			if (res.status === 401 || res.status === 403) cachedSession = null;
			const errBody = await res.json().catch(() => ({}));
			return new Response(
				JSON.stringify({ error: errBody.message || errBody.error || 'Unable to load post.' }),
				{
					status: res.status,
					headers: { 'content-type': 'application/json' }
				}
			);
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
			const marker = buildMediaCacheMarker(sourceUrl);
			const prefix = buildCachePostPrefix(rawName, rawDesc);
			const cacheText = prefix ? `${prefix}\n${marker}` : marker;
			const file = formData.get('file');
			if (!isCacheableMediaSource(sourceUrl)) {
				return new Response(JSON.stringify({ error: 'A valid source URL or inline source token is required.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}

			const session = await getSession();
			const cached = await findCachedImageBlobBySourceUrl(session, sourceUrl);
			if (cached?.blob) {
				return new Response(
					JSON.stringify({
						ok: true,
						cached: true,
						cacheToken: buildMediaCacheToken(sourceUrl),
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

			if (!createRes.ok && (createRes.status === 401 || createRes.status === 403)) {
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
					cacheToken: buildMediaCacheToken(sourceUrl),
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

			if (!retriedAfterAuth && (createRecordRes.status === 401 || createRecordRes.status === 403)) {
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

		const session = await getSession();
		const parsedTargets = uris
			.map((uri) => parsePostAtUri(uri))
			.filter(Boolean)
			.filter((target, index, arr) => arr.findIndex((item) => item.uri === target.uri) === index);

		const deleted = [];
		const failed = [];

		for (const target of parsedTargets) {
			if (session.did && target.repo !== session.did) {
				failed.push({ uri: target.uri, error: 'URI does not belong to authenticated repo.' });
				continue;
			}

			const response = await fetch(`${BSKY_XRPC}/com.atproto.repo.deleteRecord`, {
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

			if (response.ok) {
				deleted.push(target.uri);
				continue;
			}

			const errBody = await response.json().catch(() => ({}));
			failed.push({
				uri: target.uri,
				error: errBody.message || errBody.error || `Bluesky error ${response.status}`
			});

			if (response.status === 401 || response.status === 403) {
				cachedSession = null;
			}
		}

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
