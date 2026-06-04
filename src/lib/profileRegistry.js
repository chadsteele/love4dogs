
const PROFILE_STORAGE_PREFIX = "love4dogs.profile-v2"
const PROFILE_REGISTRY_KEY = "love4dogs.profile-registry-v1"
const CURRENT_PROFILE_UUID_KEY = "love4dogs.current-profile-uuid"
const PROFILE_STORAGE_KEY_PREFIX = `${PROFILE_STORAGE_PREFIX}.`
const LEGACY_PROFILE_STORAGE_KEY = PROFILE_STORAGE_PREFIX

function safeParseJson(raw, fallback) {
	try {
		return JSON.parse(String(raw || ""))
	} catch {
		return fallback
	}
}

function canUseStorage() {
	return typeof localStorage !== "undefined"
}

export function generateProfileUuid() {
	if (typeof crypto !== "undefined" && crypto?.randomUUID) {
		return String(crypto.randomUUID())
			.replace(/-/g, "")
			.slice(0, 8)
	}
	return Math.random().toString(36).slice(2, 10)
}

export function buildNewProfileEditPath() {
	return `/profile/edit/${encodeURIComponent(generateProfileUuid())}`
}

export function getProfileStorageKey(uuid = "") {
	return `${PROFILE_STORAGE_PREFIX}.${String(uuid || "").trim()}`
}

function normalizeRegistryEntry(entry = {}) {
	return {
		uuid: String(entry?.uuid || "").trim(),
		name: String(entry?.name || "").trim(),
		avatarUrl: String(entry?.avatarUrl || "").trim(),
		savedAt: Number(entry?.savedAt || Date.now()),
	}
}

function deriveRegistryFieldsFromStoredProfile(profile = {}) {
	if (!profile || typeof profile !== "object") {
		return {name: "", avatarUrl: ""}
	}

	const name = String(profile?.profileName || profile?.name || "").trim()
	const firstImage = Array.isArray(profile?.profileUploadedMedia)
		? profile.profileUploadedMedia.find((entry) => entry && typeof entry === "object")
		: null
	const avatarUrl = String(firstImage?.bskyUrl || firstImage?.url || "").trim()
	return {name, avatarUrl}
}

function buildImportedMediaEntry(value = "", label = "Image") {
	const raw = String(value || "").trim()
	if (!raw) return null
	return {
		kind: "image",
		alt: label,
		blob: null,
		url: raw,
		bskyUrl: raw,
		sourceUrl: raw,
		sourceName: "remote",
	}
}


function normalizeImportedBundle(bundle = {}) {
	if (!bundle || typeof bundle !== "object") return null
	const source =
		bundle?.combined && typeof bundle.combined === "object"
			? bundle.combined
			: bundle
	const primary = source?.primary && typeof source.primary === "object"
		? source.primary
		: {}
	const subsequent = Array.isArray(source?.subsequent)
		? source.subsequent
		: []
	return {primary, subsequent}
}

export function rebuildStoredProfileFromBundle(
	bundle = {},
	{uuid: providedUuid = ""} = {},
) {
	const normalizedBundle = normalizeImportedBundle(bundle)
	if (!normalizedBundle) return null

	const primary = normalizedBundle.primary || {}
	const newUuid = String(providedUuid || generateProfileUuid()).trim() || generateProfileUuid()
	const profileName = String(primary?.name || "").trim()
	const profileDescription = String(primary?.description || "").trim()
	const profilePic = String(primary?.profilePic || "").trim()
	const backgroundPic = String(primary?.backgroundPic || "").trim()
	const profile = {
		uuid: newUuid,
		email: String(primary?.email || "").trim(),
		profileName,
		profileDescription,
		contentHtml: normalizedBundle.subsequent.map((entry) => String(entry || "")).join(""),
		profileUploadedMedia: [buildImportedMediaEntry(profilePic, "Profile image")].filter(Boolean),
		backgroundUploadedMedia: [buildImportedMediaEntry(backgroundPic, "Profile background")].filter(Boolean),
		editorMediaList: [],
	}

	return {
		uuid: newUuid,
		profile,
		registryEntry: {
			uuid: newUuid,
			name: profileName,
			avatarUrl: profilePic,
			savedAt: Date.now(),
		},
		source: {
			uuid: String(primary?.uuid || "").trim(),
			postUrl: String(primary?.postUrl || "").trim(),
		},
	}
}

export function rebuildStoredProfileFromBskyAltPayload(
	payload = {},
	{uuid: providedUuid = ""} = {},
) {
	if (!payload || typeof payload !== "object") return null
	const rawBundle =
		typeof payload?.h === "string"
			? safeParseJson(payload.h, null)
			: payload?.h
	if (!rawBundle || typeof rawBundle !== "object") return null
	return rebuildStoredProfileFromBundle(rawBundle, {uuid: providedUuid})
}

export function importStoredProfileFromReconstructedBundle(
	bundle = {},
	options = {},
) {
	const rebuilt = rebuildStoredProfileFromBundle(bundle, options)
	if (!rebuilt) return null

	if (canUseStorage()) {
		writeStoredProfileByUuid(rebuilt.uuid, rebuilt.profile)
		upsertStoredProfile(rebuilt.profile)
		if (options?.setCurrent !== false) {
			setCurrentProfileUuid(rebuilt.uuid)
		}
	}

	return rebuilt
}

export function importStoredProfileFromBskyAltPayload(
	payload = {},
	options = {},
) {
	const rebuilt = rebuildStoredProfileFromBskyAltPayload(payload, options)
	if (!rebuilt) return null

	if (canUseStorage()) {
		writeStoredProfileByUuid(rebuilt.uuid, rebuilt.profile)
		upsertStoredProfile(rebuilt.profile)
		if (options?.setCurrent !== false) {
			setCurrentProfileUuid(rebuilt.uuid)
		}
	}

	return rebuilt
}

export function listStoredProfiles() {
	if (!canUseStorage()) return []
	const parsed = safeParseJson(localStorage.getItem(PROFILE_REGISTRY_KEY), [])
	const normalized = Array.isArray(parsed)
		? parsed.map((entry) => normalizeRegistryEntry(entry)).filter((entry) => entry.uuid)
		: []

	const byUuid = new Map(normalized.map((entry) => [entry.uuid, entry]))
	let changed = !Array.isArray(parsed)

	const legacyProfile = safeParseJson(
		localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY),
		null,
	)
	if (legacyProfile && typeof legacyProfile === "object") {
		const legacyUuid = String(legacyProfile?.uuid || "").trim()
		if (legacyUuid && !byUuid.has(legacyUuid)) {
			const derived = deriveRegistryFieldsFromStoredProfile(legacyProfile)
			const legacySavedAt = Number(legacyProfile?.savedAt || Date.now())
			byUuid.set(legacyUuid, {
				uuid: legacyUuid,
				name: derived.name,
				avatarUrl: derived.avatarUrl,
				savedAt: Number.isFinite(legacySavedAt)
					? legacySavedAt
					: Date.now(),
			})
			changed = true
		}
	}

	for (let i = 0; i < localStorage.length; i += 1) {
		const key = String(localStorage.key(i) || "")
		if (!key.startsWith(PROFILE_STORAGE_KEY_PREFIX)) continue

		const uuid = key.slice(PROFILE_STORAGE_KEY_PREFIX.length).trim()
		if (!uuid) continue

		const storedProfile = safeParseJson(localStorage.getItem(key), null)
		const derived = deriveRegistryFieldsFromStoredProfile(storedProfile)
		const existing = byUuid.get(uuid)

		if (!existing) {
			byUuid.set(uuid, {
				uuid,
				name: derived.name,
				avatarUrl: derived.avatarUrl,
				savedAt: Date.now(),
			})
			changed = true
			continue
		}

		let nextExisting = existing
		if (!existing.name && derived.name) {
			nextExisting = {...nextExisting, name: derived.name}
			changed = true
		}
		if (!existing.avatarUrl && derived.avatarUrl) {
			nextExisting = {...nextExisting, avatarUrl: derived.avatarUrl}
			changed = true
		}
		if (nextExisting !== existing) {
			byUuid.set(uuid, nextExisting)
		}
	}

	const result = Array.from(byUuid.values()).sort((a, b) => b.savedAt - a.savedAt)
	if (changed) {
		localStorage.setItem(PROFILE_REGISTRY_KEY, JSON.stringify(result))
	}
	return result
}

export function hasStoredProfiles() {
	return listStoredProfiles().length > 0
}

export function readStoredProfileByUuid(uuid = "") {
	if (!canUseStorage()) return null
	const key = getProfileStorageKey(uuid)
	if (!key) return null
	const raw = localStorage.getItem(key)
	if (!raw) return null
	const parsed = safeParseJson(raw, null)
	return parsed && typeof parsed === "object" ? parsed : null
}

export function writeStoredProfileByUuid(uuid = "", profile = {}) {
	if (!canUseStorage()) return
	const key = getProfileStorageKey(uuid)
	if (!key || !uuid) return
	localStorage.setItem(key, JSON.stringify(profile))
}

export function getCurrentProfileUuid() {
	if (!canUseStorage()) return ""
	const value = String(localStorage.getItem(CURRENT_PROFILE_UUID_KEY) || "")
	return value.trim()
}

export function setCurrentProfileUuid(uuid = "") {
	if (!canUseStorage()) return
	const next = String(uuid || "").trim()
	if (!next) {
		localStorage.removeItem(CURRENT_PROFILE_UUID_KEY)
		return
	}
	localStorage.setItem(CURRENT_PROFILE_UUID_KEY, next)
}

export function deleteStoredProfileByUuid(uuid = "") {
	if (!canUseStorage()) return
	const targetUuid = String(uuid || "").trim()
	if (!targetUuid) return

	localStorage.removeItem(getProfileStorageKey(targetUuid))

	const legacyProfile = safeParseJson(
		localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY),
		null,
	)
	if (
		legacyProfile &&
		typeof legacyProfile === "object" &&
		String(legacyProfile?.uuid || "").trim() === targetUuid
	) {
		localStorage.removeItem(LEGACY_PROFILE_STORAGE_KEY)
	}

	const remaining = listStoredProfiles().filter(
		(entry) => entry.uuid !== targetUuid,
	)
	localStorage.setItem(PROFILE_REGISTRY_KEY, JSON.stringify(remaining))

	if (getCurrentProfileUuid() === targetUuid) {
		setCurrentProfileUuid(remaining[0]?.uuid || "")
	}
}

export function upsertStoredProfile(profile = {}) {
	if (!canUseStorage()) return
	const uuid = String(profile?.uuid || "").trim()
	if (!uuid) return
	const entry = {
		uuid,
		name: String(profile?.profileName || profile?.name || "").trim(),
		avatarUrl: String(profile?.avatarUrl || "").trim(),
		savedAt: Date.now(),
	}
	const next = listStoredProfiles().filter((item) => item.uuid !== uuid)
	next.unshift(entry)
	localStorage.setItem(PROFILE_REGISTRY_KEY, JSON.stringify(next))
}
