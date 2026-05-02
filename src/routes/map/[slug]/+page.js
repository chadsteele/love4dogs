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

function decodeSlug(slug) {
	const direct = parseLatLon(slug);
	if (direct) return direct;
	return hashToGps(slug);
}

export function load({ params }) {
	const slug = params.slug || '';
	const decoded = decodeSlug(slug);

	if (!decoded) {
		return {
			slug,
			valid: false,
			error: 'Invalid location hash. Use geohash or lat,lon format.'
		};
	}

	const lat = Number(decoded.lat.toFixed(5));
	const lon = Number(decoded.lon.toFixed(5));

	return {
		slug,
		valid: true,
		lat,
		lon,
		mapUrl: `https://maps.google.com/?q=${lat},${lon}`
	};
}
