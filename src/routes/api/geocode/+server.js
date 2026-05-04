export async function POST({request}) {
	try {
		const body = await request.json()
		const query = body?.query?.trim()

		if (!query) {
			return new Response(
				JSON.stringify({error: 'Location query is required.'}),
				{status: 400, headers: {'Content-Type': 'application/json'}},
			)
		}

		const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`

		let res
		try {
			res = await fetch(url, {
				headers: {
					'Accept-Language': 'en',
					'User-Agent': 'Love4Dogs/1.0 (geocoding service)',
				},
				signal: AbortSignal.timeout(10000),
			})
		} catch (fetchError) {
			console.error('Fetch error calling Nominatim:', fetchError.message)
			return new Response(
				JSON.stringify({error: 'Could not reach geocoding service. Please try again.'}),
				{status: 503, headers: {'Content-Type': 'application/json'}},
			)
		}

		if (!res.ok) {
			const errorText = await res.text().catch(() => '')
			console.error(`Nominatim returned ${res.status}:`, errorText)
			return new Response(
				JSON.stringify({error: 'Geocoding service temporarily unavailable. Please try again.'}),
				{status: 503, headers: {'Content-Type': 'application/json'}},
			)
		}

		let data
		try {
			data = await res.json()
		} catch (parseError) {
			console.error('Failed to parse Nominatim response:', parseError.message)
			return new Response(
				JSON.stringify({error: 'Geocoding service error. Please try again.'}),
				{status: 503, headers: {'Content-Type': 'application/json'}},
			)
		}

		if (!Array.isArray(data) || data.length === 0) {
			return new Response(
				JSON.stringify({error: `Could not find location: ${query}`}),
				{status: 404, headers: {'Content-Type': 'application/json'}},
			)
		}

		const result = data[0]
		const lat = parseFloat(result.lat)
		const lon = parseFloat(result.lon)
		const city =
			result?.address?.city ||
			result?.address?.town ||
			result?.address?.village ||
			result?.address?.hamlet ||
			""
		const country = result?.address?.country || ""
		const zip = result?.address?.postcode || ""

		if (isNaN(lat) || isNaN(lon)) {
			console.error('Invalid coordinates from Nominatim:', result)
			return new Response(
				JSON.stringify({error: 'Geocoding service returned invalid data.'}),
				{status: 503, headers: {'Content-Type': 'application/json'}},
			)
		}

		return new Response(JSON.stringify({lat, lon, city, country, zip}), {
			status: 200,
			headers: {'Content-Type': 'application/json'},
		})
	} catch (error) {
		console.error('Geocoding error:', error.message, error.stack)
		return new Response(
			JSON.stringify({error: 'Geocoding service error. Please try again.'}),
			{status: 500, headers: {'Content-Type': 'application/json'}},
		)
	}
}
