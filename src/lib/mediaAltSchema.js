import { createHash } from 'node:crypto';

export const MAX_MEDIA_ALT_CHARS = 3000;
export const MEDIA_ALT_SCHEMA = 'love4dogs.media.alt.v1';

function countChars(value = '') {
	return [...String(value || '')].length;
}

export function ensureAltLength(alt = '', label = 'Media alt text') {
	const length = countChars(alt);
	if (length > MAX_MEDIA_ALT_CHARS) {
		throw new Error(`${label} exceeds ${MAX_MEDIA_ALT_CHARS} characters.`);
	}
}

function safeParseJson(value = '') {
	try {
		return JSON.parse(String(value || ''));
	} catch {
		return null;
	}
}

function looksLikeAppPayloadAlt(parsed = null) {
	if (!parsed || typeof parsed !== 'object') return false;
	if (parsed?.schema === MEDIA_ALT_SCHEMA) return true;
	if (
		('u' in parsed && 'i' in parsed && 't' in parsed && 'h' in parsed) ||
		('primary' in parsed && 'chunks' in parsed) ||
		('context' in parsed && 'uuid' in parsed)
	) {
		return true;
	}
	return false;
}

function isValidBlobRefObject(blob = null) {
	if (!blob || typeof blob !== 'object') return false;
	const cid = String(blob?.ref?.$link || blob?.cid || '').trim();
	return Boolean(cid);
}

function normalizePathLike(value = '') {
	return String(value || '').trim().replace(/\\/g, '/');
}

function deriveCanonicalMediaUuid({ kind = 'image', path = '', filename = '', blob = null } = {}) {
	const cid = String(blob?.ref?.$link || blob?.cid || '').trim();
	const source = `${String(kind || '')}|${String(path || '')}|${String(filename || '')}|${cid}`;
	return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

function buildCanonicalMediaAlt({ kind = 'image', entry = {}, blob = null } = {}) {
	const fallbackPath = normalizePathLike(entry?.sourceUrl || entry?.path || entry?.origin || '');
	const fallbackFilename = String(entry?.sourceName || entry?.filename || '').trim();
	const parsedAlt = safeParseJson(entry?.alt);
	const rawUuid = String(parsedAlt?.uuid || entry?.uuid || '').trim();

	if (!fallbackPath || !isValidBlobRefObject(blob)) {
		return null;
	}

	const canonical = {
		schema: MEDIA_ALT_SCHEMA,
		uuid: rawUuid || deriveCanonicalMediaUuid({ kind, path: fallbackPath, filename: fallbackFilename, blob }),
		kind: String(kind || 'image'),
		path: fallbackPath,
		filename: fallbackFilename,
		blob,
	};

	if (!canonical.uuid) return null;
	return canonical;
}

function assertCanonicalMediaAltPayload(payload = {}, label = 'Media alt JSON') {
	if (!payload || typeof payload !== 'object') {
		throw new Error(`${label} must be a JSON object.`);
	}
	if (payload.schema !== MEDIA_ALT_SCHEMA) {
		throw new Error(`${label} uses an unsupported schema.`);
	}
	if (!String(payload.uuid || '').trim()) {
		throw new Error(`${label} requires uuid.`);
	}
	if (!String(payload.path || '').trim()) {
		throw new Error(`${label} requires path.`);
	}
	if (!isValidBlobRefObject(payload.blob)) {
		throw new Error(`${label} requires a valid blob reference.`);
	}
}

export function normalizeAltForPublish(entry = {}, { kind = 'image', blob = null } = {}) {
	const rawAlt = String(entry?.alt || (kind === 'video' ? 'Video' : 'Photo'));
	const parsedAlt = safeParseJson(rawAlt);

	if (parsedAlt && looksLikeAppPayloadAlt(parsedAlt) && parsedAlt.schema !== MEDIA_ALT_SCHEMA) {
		ensureAltLength(rawAlt, `${kind} alt text`);
		return rawAlt;
	}

	const hasMediaPathMeta = Boolean(
		String(entry?.sourceUrl || entry?.path || '').trim() ||
		String(entry?.sourceName || entry?.filename || '').trim() ||
		parsedAlt?.schema === MEDIA_ALT_SCHEMA,
	);

	if (hasMediaPathMeta) {
		const canonical =
			parsedAlt?.schema === MEDIA_ALT_SCHEMA
				? {
					...parsedAlt,
					blob: parsedAlt?.blob && typeof parsedAlt.blob === 'object' ? parsedAlt.blob : blob,
				}
				: buildCanonicalMediaAlt({ kind, entry, blob });

		if (!canonical) {
			throw new Error(`${kind} media metadata requires path and blob.`);
		}
		assertCanonicalMediaAltPayload(canonical, `${kind} media alt JSON`);
		const canonicalAlt = JSON.stringify(canonical);
		ensureAltLength(canonicalAlt, `${kind} media alt JSON`);
		return canonicalAlt;
	}

	ensureAltLength(rawAlt, `${kind} alt text`);
	return rawAlt;
}
