import {
	BskyManifest,
	PROFILE_TAG,
	normalizeSchemaTags,
	isProfileSchemaRecord,
} from "./models.js"

const SHARED_AUTHOR_ID_KEY = "love4dogs.authorid"

function normalizeString(value = "") {
	return String(value || "").trim()
}

function randomId(length = 12) {
	const source = "abcdefghijklmnopqrstuvwxyz0123456789"
	let out = ""
	for (let i = 0; i < length; i += 1) {
		out += source[Math.floor(Math.random() * source.length)]
	}
	return out
}

let cachedAuthorId = '';

export function getOrCreateSharedAuthorId(fallback = "") {
	const fallbackValue = normalizeString(fallback);
	if (cachedAuthorId) return cachedAuthorId;

	let existing = '';
	if (typeof localStorage !== 'undefined') {
		existing = normalizeString(localStorage.getItem(SHARED_AUTHOR_ID_KEY));
	}

	if (existing) {
		cachedAuthorId = existing;
		// Async cache to IndexedDB
		import('./db.js').then(({ setSetting }) => {
			setSetting(SHARED_AUTHOR_ID_KEY, existing).catch(() => {});
		}).catch(() => {});
		return existing;
	}

	const created = fallbackValue || randomId();
	cachedAuthorId = created;

	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.setItem(SHARED_AUTHOR_ID_KEY, created);
		} catch {}
	}

	import('./db.js').then(({ setSetting }) => {
		setSetting(SHARED_AUTHOR_ID_KEY, created).catch(() => {});
	}).catch(() => {});

	return created;
}

if (typeof window !== 'undefined') {
	import('./db.js').then(({ getSetting }) => {
		getSetting(SHARED_AUTHOR_ID_KEY).then((val) => {
			if (val) cachedAuthorId = val;
		}).catch(() => {});
	}).catch(() => {});
}

export class BlueskySchemaRecord extends BskyManifest {
	constructor(value = {}) {
		super({
			...value,
			name: value?.title || value?.name,
		})
		this.canonicalurl = normalizeString(
			value?.canonicalurl || value?.canonicalUrl,
		)
		this.html = String(value?.html || "")
		this.title = this.name
	}

	toJSON({includeCompatAliases = true} = {}) {
		const next = super.toJSON({includeCompatAliases})
		next.title = this.name
		next.html = this.html
		if (this.canonicalurl) {
			next.canonicalurl = this.canonicalurl
		}
		return next
	}

	static from(value = {}) {
		return new BlueskySchemaRecord(value)
	}
}

export {PROFILE_TAG}
