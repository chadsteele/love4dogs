const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_INDEX = Object.fromEntries([...BASE32].map((char, index) => [char, index]));

function isValidCoordinate(lat, lon) {
	return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function splitRange(range, takeUpperHalf) {
	const mid = (range[0] + range[1]) / 2;
	if (takeUpperHalf) range[0] = mid;
	else range[1] = mid;
}

export function gpsToHash(lat, lon, precision = 9) {
	if (!isValidCoordinate(lat, lon)) return null;
	if (!Number.isInteger(precision) || precision < 1 || precision > 12) {
		return null;
	}

	const latRange = [-90, 90];
	const lonRange = [-180, 180];
	let hash = '';
	let bits = 0;
	let value = 0;
	let useLon = true;

	while (hash.length < precision) {
		const mid = useLon ? (lonRange[0] + lonRange[1]) / 2 : (latRange[0] + latRange[1]) / 2;
		const takeUpperHalf = useLon ? lon >= mid : lat >= mid;

		value = (value << 1) | (takeUpperHalf ? 1 : 0);
		splitRange(useLon ? lonRange : latRange, takeUpperHalf);
		useLon = !useLon;
		bits += 1;

		if (bits === 5) {
			hash += BASE32[value];
			bits = 0;
			value = 0;
		}
	}

	return hash;
}

export function hashToGps(hash) {
	const normalized = String(hash || '').trim().toLowerCase();
	if (!normalized) return null;

	const latRange = [-90, 90];
	const lonRange = [-180, 180];
	let useLon = true;

	for (const char of normalized) {
		const value = BASE32_INDEX[char];
		if (value === undefined) return null;

		for (let mask = 16; mask > 0; mask >>= 1) {
			splitRange(useLon ? lonRange : latRange, (value & mask) !== 0);
			useLon = !useLon;
		}
	}

	return {
		lat: (latRange[0] + latRange[1]) / 2,
		lon: (lonRange[0] + lonRange[1]) / 2
	};
}
