
import { generateUuid } from './uuid.js';

import {
	getSetting,
	setSetting,
	removeSetting,
	getProfile,
	setProfile,
	deleteProfile,
	getAllProfiles
} from './db.js';

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
	return generateUuid(8);
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

export async function importStoredProfileFromReconstructedBundle(
	bundle = {},
	options = {},
) {
	const rebuilt = rebuildStoredProfileFromBundle(bundle, options)
	if (!rebuilt) return null

	await writeStoredProfileByUuid(rebuilt.uuid, rebuilt.profile)
	await upsertStoredProfile(rebuilt.profile)
	if (options?.setCurrent !== false) {
		await setCurrentProfileUuid(rebuilt.uuid)
	}

	return rebuilt
}

export async function importStoredProfileFromBskyAltPayload(
	payload = {},
	options = {},
) {
	const rebuilt = rebuildStoredProfileFromBskyAltPayload(payload, options)
	if (!rebuilt) return null

	await writeStoredProfileByUuid(rebuilt.uuid, rebuilt.profile)
	await upsertStoredProfile(rebuilt.profile)
	if (options?.setCurrent !== false) {
		await setCurrentProfileUuid(rebuilt.uuid)
	}

	return rebuilt
}

export async function listStoredProfiles() {
	const parsed = await getSetting(PROFILE_REGISTRY_KEY, [])
	const normalized = Array.isArray(parsed)
		? parsed.map((entry) => normalizeRegistryEntry(entry)).filter((entry) => entry.uuid)
		: []
	return normalized.sort((a, b) => b.savedAt - a.savedAt)
}

export async function hasStoredProfiles() {
	const list = await listStoredProfiles()
	return list.length > 0
}

export async function readStoredProfileByUuid(uuid = "") {
	const key = String(uuid || "").trim()
	if (!key) return null
	return await getProfile(key)
}

export async function writeStoredProfileByUuid(uuid = "", profile = {}) {
	const key = String(uuid || "").trim()
	if (!key) return
	await setProfile(key, profile)
}

export async function getCurrentProfileUuid() {
	const value = String(await getSetting(CURRENT_PROFILE_UUID_KEY, "") || "")
	return value.trim()
}

export async function setCurrentProfileUuid(uuid = "") {
	const next = String(uuid || "").trim()
	if (!next) {
		await removeSetting(CURRENT_PROFILE_UUID_KEY)
		return
	}
	await setSetting(CURRENT_PROFILE_UUID_KEY, next)
}

export async function deleteStoredProfileByUuid(uuid = "") {
	const targetUuid = String(uuid || "").trim()
	if (!targetUuid) return

	await deleteProfile(targetUuid)

	const remaining = (await listStoredProfiles()).filter(
		(entry) => entry.uuid !== targetUuid,
	)
	await setSetting(PROFILE_REGISTRY_KEY, remaining)

	if (await getCurrentProfileUuid() === targetUuid) {
		await setCurrentProfileUuid(remaining[0]?.uuid || "")
	}
}

export async function upsertStoredProfile(profile = {}) {
	const uuid = String(profile?.uuid || "").trim()
	if (!uuid) return
	const entry = {
		uuid,
		name: String(profile?.profileName || profile?.name || "").trim(),
		avatarUrl: String(profile?.avatarUrl || profile?.avatar || ""),
		savedAt: Date.now(),
	}
	const next = (await listStoredProfiles()).filter((item) => item.uuid !== uuid)
	next.unshift(entry)
	await setSetting(PROFILE_REGISTRY_KEY, next)
}
