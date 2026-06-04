import {lookupLocationDetails} from "./utils.js"

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
