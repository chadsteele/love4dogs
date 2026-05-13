const PROFILE_STORAGE_PREFIX = "love4dogs.profile-v2"
const PROFILE_REGISTRY_KEY = "love4dogs.profile-registry-v1"
const CURRENT_PROFILE_UUID_KEY = "love4dogs.current-profile-uuid"

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

export function getProfileStorageKey(uuid = "") {
	return `${PROFILE_STORAGE_PREFIX}.${String(uuid || "").trim()}`
}

export function listStoredProfiles() {
	if (!canUseStorage()) return []
	const parsed = safeParseJson(localStorage.getItem(PROFILE_REGISTRY_KEY), [])
	if (!Array.isArray(parsed)) return []
	return parsed
		.map((entry) => ({
			uuid: String(entry?.uuid || "").trim(),
			name: String(entry?.name || "").trim(),
			avatarUrl: String(entry?.avatarUrl || "").trim(),
			savedAt: Number(entry?.savedAt || Date.now()),
		}))
		.filter((entry) => entry.uuid)
		.sort((a, b) => b.savedAt - a.savedAt)
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
