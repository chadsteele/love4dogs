import { hashToGps } from '$lib/utils';

function parseLatLon(value) {
	const parts = value.split(',').map((part) => Number(part.trim()));
	if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
		return null;
	}

	const [lat, lon] = parts;
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
		return null;
	}

	return { lat, lon };
}

export function load({ params }) {
	const slug = params.slug || '';

	// Try direct lat,lon first.
	const direct = parseLatLon(slug);
	if (direct) {
		const lat = Number(direct.lat.toFixed(5));
		const lon = Number(direct.lon.toFixed(5));
		return {
			slug,
			valid: true,
			lat,
			lon,
			approxHash: null,
			exactHash: null,
			mapUrl: `https://maps.google.com/?q=${lat},${lon}`
		};
	}

	// Decode approx/exact geohash pair (or single hash).
	const decoded = hashToGps(slug);
	if (!decoded) {
		return {
			slug,
			valid: false,
			error: 'Invalid location hash. Use geohash or lat,lon format.'
		};
	}

	// Always use exact coords for the map pin.
	const lat = Number(decoded.exact.lat.toFixed(5));
	const lon = Number(decoded.exact.lon.toFixed(5));

	return {
		slug,
		valid: true,
		lat,
		lon,
		approxHash: decoded.hashes.approx,
		exactHash: decoded.hashes.exact,
		mapUrl: `https://maps.google.com/?q=${lat},${lon}`
	};
}
