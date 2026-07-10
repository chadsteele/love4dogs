import {lookupLocationDetails} from "./utils.js"
import { getCurrentProfileUuid, readStoredProfileByUuid, listStoredProfiles } from './profileRegistry.js'
import { Location } from './models.js'


export function hasRequiredLocationParts(location) {
	return Boolean(Location.from(location)?.hasRequiredAddressParts())
}

export function normalizeAddressPart(value = "") {
	return String(value || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
}

export function buildCompleteAddress(location = {}) {
	return Location.from(location)?.buildCompleteAddress() || ""
}

export function addressOkay(newAddress, confirmedLocation) {
	return Boolean(Location.from(confirmedLocation)?.matchesAddress(newAddress))
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
			confirmedLocation = Location.from(location)?.toJSON() || location
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

	const completeAddress = Location.from(confirmedLocation)?.buildCompleteAddress() || ""
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



