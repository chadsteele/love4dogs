import { hashToGps } from '$lib/utils';

export function load({ params }) {
	const approximate = params.approximate || '';
	const exact = params.exact || '';

	if (!exact) {
		return {
			approximate,
			exact,
			valid: false,
			error: 'Missing exact hash in URL.'
		};
	}

	// Decode coordinates from the exact hash.
	const decoded = hashToGps(exact);
	if (!decoded) {
		return {
			approximate,
			exact,
			valid: false,
			error: 'Invalid exact hash. Expected /map/[approximate]/[exact].'
		};
	}

	const lat = Number(decoded.lat.toFixed(5));
	const lon = Number(decoded.lon.toFixed(5));

	return {
		approximate,
		exact,
		valid: true,
		lat,
		lon,
		mapUrl: `https://maps.google.com/?q=${lat},${lon}`,
		mapEmbedUrl: `https://maps.google.com/maps?q=${lat},${lon}&z=15&output=embed`
	};
}


function openDirections(lat, lng) {
  const isiOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  if (isiOS) {
    // Apple Maps: 'saddr' is start (empty means 'here'), 'daddr' is destination
    window.location.href = `http://apple.com/?q=${lat},${lng}&dirflg=d`;
  } else if (isAndroid) {
    // Android: google.navigation:q triggers turn-by-turn navigation from current location
    window.location.href = `google.navigation:q=${lat},${lng}`;
  } else {
    // Desktop/Default: Google Maps Universal URL
    window.open(`https://google.com/?q=${lat},${lng}`, '_blank');
  }
}
