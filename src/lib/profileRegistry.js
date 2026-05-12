const PROFILE_REGISTRY_KEY = "love4dogs.profile-registry-v1"
const CURRENT_PROFILE_UUID_KEY = "love4dogs.current-profile-uuid"
const PROFILE_UUIDS_KEY = "love4dogs.profile-uuids"

function canUseStorage() {
	return typeof localStorage !== "undefined"
}

function uniqueNonEmpty(values = []) {
	const seen = new Set()
	const cleaned = []
	for (const value of values) {
		const next = String(value || "").trim()
		if (!next || seen.has(next)) continue
		seen.add(next)
		cleaned.push(next)
	}
	return cleaned
}

function normalizeProfileEntry(value = {}) {
	const uuid = String(value?.uuid || "").trim()
	if (!uuid) return null
	return {
		uuid,
		name: String(value?.name || "").trim(),
		profilePic: String(value?.profilePic || "").trim(),
		type: String(value?.type || "").trim(),
		canonicalurl: String(value?.canonicalurl || "").trim(),
		updatedAt: Number(value?.updatedAt || Date.now()),
	}
}

function syncLegacyUuidList(profiles = []) {
	if (!canUseStorage()) return
	const uuids = uniqueNonEmpty(profiles.map((entry) => entry?.uuid))
	localStorage.setItem(PROFILE_UUIDS_KEY, JSON.stringify(uuids))
}

function writeRegistry(registry = {}) {
	if (!canUseStorage()) return
	const profiles = Array.isArray(registry?.profiles)
		? registry.profiles
				.map((entry) => normalizeProfileEntry(entry))
				.filter(Boolean)
		: []
	const currentUuid = String(registry?.currentUuid || "").trim()
	localStorage.setItem(
		PROFILE_REGISTRY_KEY,
		JSON.stringify({
			profiles,
			currentUuid,
		}),
	)
	syncLegacyUuidList(profiles)
}

export function readProfileRegistry() {
	if (!canUseStorage()) {
		return {
			profiles: [],
			currentUuid: "",
		}
	}

	try {
		const raw = localStorage.getItem(PROFILE_REGISTRY_KEY)
		const parsed = raw ? JSON.parse(raw) : null
		const profiles = Array.isArray(parsed?.profiles)
			? parsed.profiles
					.map((entry) => normalizeProfileEntry(entry))
					.filter(Boolean)
			: []
		const currentUuid = String(parsed?.currentUuid || "").trim()
		const next = {profiles, currentUuid}
		syncLegacyUuidList(profiles)
		return next
	} catch {
		return {
			profiles: [],
			currentUuid: "",
		}
	}
}

export function listStoredProfiles() {
	const {profiles} = readProfileRegistry()
	return [...profiles].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
}

export function getStoredProfileUuids() {
	return listStoredProfiles().map((entry) => entry.uuid)
}

export function hasStoredProfiles() {
	return getStoredProfileUuids().length > 0
}

export function getCurrentProfileUuid() {
	if (!canUseStorage()) return ""
	const explicit = String(localStorage.getItem(CURRENT_PROFILE_UUID_KEY) || "").trim()
	const profiles = listStoredProfiles()
	const uuids = new Set(profiles.map((entry) => entry.uuid))
	if (explicit && uuids.has(explicit)) return explicit
	const fallback = profiles[0]?.uuid || ""
	if (fallback) {
		localStorage.setItem(CURRENT_PROFILE_UUID_KEY, fallback)
	}
	return fallback
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
	const entry = normalizeProfileEntry(profile)
	if (!entry) return
	const registry = readProfileRegistry()
	const profiles = Array.isArray(registry?.profiles) ? [...registry.profiles] : []
	const existingIndex = profiles.findIndex((item) => item.uuid === entry.uuid)
	if (existingIndex >= 0) {
		profiles[existingIndex] = {
			...profiles[existingIndex],
			...entry,
			updatedAt: Date.now(),
		}
	} else {
		profiles.push({...entry, updatedAt: Date.now()})
	}

	const currentUuid = String(registry?.currentUuid || "").trim() || entry.uuid
	writeRegistry({profiles, currentUuid})
	setCurrentProfileUuid(currentUuid)
}

export function removeStoredProfile(uuid = "") {
	const target = String(uuid || "").trim()
	if (!target) return
	const registry = readProfileRegistry()
	const nextProfiles = (registry?.profiles || []).filter(
		(entry) => entry.uuid !== target,
	)
	const preferredCurrent = String(registry?.currentUuid || "").trim()
	const nextCurrent =
		preferredCurrent && preferredCurrent !== target
			? preferredCurrent
			: nextProfiles[0]?.uuid || ""
	writeRegistry({
		profiles: nextProfiles,
		currentUuid: nextCurrent,
	})
	if (nextCurrent) {
		setCurrentProfileUuid(nextCurrent)
	} else if (canUseStorage()) {
		localStorage.removeItem(CURRENT_PROFILE_UUID_KEY)
	}
}
