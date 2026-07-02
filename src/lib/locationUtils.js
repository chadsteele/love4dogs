import {lookupLocationDetails} from "./utils.js"
import { getCurrentProfileUuid, readStoredProfileByUuid, listStoredProfiles } from './profileRegistry.js'


export function hasRequiredLocationParts(location) {
	if (!location || typeof location !== "object") return false
	return [location.state, location.country, location.zip].every(
		(value) => String(value || "").trim().length > 0,
	)
}

export function normalizeAddressPart(value = "") {
	return String(value || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
}

export function buildCompleteAddress(location = {}) {
	const line1 = [location.houseNumber, location.road]
		.map((value) => String(value || "").trim())
		.filter(Boolean)
		.join(" ")
	const line2 = [location.neighbourhood, location.suburb]
		.map((value) => String(value || "").trim())
		.filter(Boolean)
		.join(", ")
	const structured = [
		line1,
		line2,
		location.city,
		location.state,
		location.country,
		location.zip,
	]
		.map((value) => String(value || "").trim())
		.filter(Boolean)
		.join(", ")

	return String(location.formattedAddress || structured).trim()
}

export function addressOkay(newAddress, confirmedLocation) {
	if (!hasRequiredLocationParts(confirmedLocation)) return false
	const neu = normalizeAddressPart(newAddress)
	const required = [
		confirmedLocation?.city,
		confirmedLocation?.state,
		confirmedLocation?.country,
		confirmedLocation?.zip,
	]
		.map((value) => normalizeAddressPart(value))
		.filter(Boolean)

	if (!neu) return false

	if (required.some((part) => !neu.includes(part))) return false

	return true
}

export async function handleLocationModalConfirm(
	modalLocation,
	pinMovedInModal,
	confirmedLocation,
	addressText,
) {
	const locationError = ""
	if (
		modalLocation &&
		(pinMovedInModal || !hasRequiredLocationParts(confirmedLocation))
	) {
		const {location} = await lookupLocationDetails(
			modalLocation.lat,
			modalLocation.lon,
		)
		if (location) {
			confirmedLocation = location
			const parts = [
				location.city,
				location.state,
				location.country,
				location.zip,
			].filter(Boolean)
			if (parts.length) addressText = parts.join(", ")
			modalLocation = {...modalLocation, ...location}
		}
	}

	if (!hasRequiredLocationParts(confirmedLocation)) {
		return {
			locationConfirmed: false,
			locationError:
				"Location must include state, country, and zip before it can be confirmed.",
			addressText,
			confirmedLocation,
			modalLocation,
		}
	}

	const completeAddress = buildCompleteAddress(confirmedLocation)
	if (completeAddress) addressText = completeAddress

	const confirmedAddress = addressText.trim()
	return {
		locationConfirmed: true,
		locationError: "",
		addressText,
		confirmedAddress,
		confirmedLocation,
		modalLocation,
	}
}

export async function processQueryForNearMe(rawQuery) {
	let query = String(rawQuery || "").trim()
	if (/\bnear\s+me\b/gi.test(query)) {
		const currentUuid = await getCurrentProfileUuid()
		let loc = null
		if (currentUuid) {
			const profile = await readStoredProfileByUuid(currentUuid)
			if (profile?.confirmedLocation) {
				loc = profile.confirmedLocation
			}
		}
		if (!loc) {
			const profiles = await listStoredProfiles()
			for (const p of profiles) {
				const profile = await readStoredProfileByUuid(p.uuid)
				if (profile?.confirmedLocation) {
					loc = profile.confirmedLocation
					break
				}
			}
		}

		const city = loc?.city || ""
		const state = loc?.state || ""
		const country = loc?.country || ""
		const locParts = [city, country, state].map(s => String(s || "").trim()).filter(Boolean)

		if (locParts.length > 0) {
			query = query.replace(/\bnear\s+me\b/gi, locParts.join(" "))
		} else {
			query = query.replace(/\bnear\s+me\b/gi, "")
		}
	}
	return query.replace(/\s+/g, " ").trim()
}



