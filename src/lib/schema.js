const SHARED_AUTHOR_ID_KEY = "love4dogs.authorid"
const PROFILE_TAG = "profile"

function normalizeString(value = "") {
	return String(value || "").trim()
}

function normalizeTags(tags = []) {
	const out = []
	for (const raw of Array.isArray(tags) ? tags : []) {
		const value = normalizeString(raw).toLowerCase()
		if (!value) continue
		if (!out.includes(value)) out.push(value)
	}
	return out.slice(0, 50)
}

function hasProfileTag(tags = []) {
	return normalizeTags(tags).includes(PROFILE_TAG)
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

export function normalizeSchemaTags(tags = []) {
	return normalizeTags(tags)
}

export function isProfileSchemaRecord(value = {}) {
	return hasProfileTag(value?.tags)
}

export class BlueskySchemaRecord {
	constructor(value = {}) {
		const uuid = normalizeString(value?.uuid)
		const title = normalizeString(value?.title || value?.name)
		const description = normalizeString(value?.description)
		const tags = normalizeTags(value?.tags)

		this.uuid = uuid
		this.authorid = normalizeString(value?.authorid)
		this.stamp = normalizeString(value?.stamp)
		this.canonicalurl = normalizeString(value?.canonicalurl || value?.canonicalUrl)
		this.title = title
		this.profilePic = normalizeString(value?.profilePic)
		this.backgroundPic = normalizeString(value?.backgroundPic)
		this.description = description
		this.html = String(value?.html || "")
		this.tags = tags
	}

	isProfile() {
		return hasProfileTag(this.tags)
	}

	toJSON({includeCompatAliases = true} = {}) {
		const next = {
			uuid: this.uuid,
			authorid: this.authorid,
			stamp: this.stamp,
			title: this.title,
			profilePic: this.profilePic || null,
			backgroundPic: this.backgroundPic || null,
			description: this.description,
			html: this.html,
			tags: this.tags,
		}

		if (includeCompatAliases) {
			next.name = this.title
		}

		return next
	}

	static from(value = {}) {
		return new BlueskySchemaRecord(value)
	}
}

export {PROFILE_TAG}
