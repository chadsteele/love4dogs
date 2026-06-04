export async function POST({request}) {
	try {
		const body = await request.json()
		const query = body?.query?.trim()
		const reverse = body?.reverse === true
		const reverseLat = Number(body?.lat)
		const reverseLon = Number(body?.lon)

		const commonHeaders = {
			'Accept-Language': 'en',
			'User-Agent': 'Love4Dogs/1.0 (geocoding service)',
		}

		if (reverse) {
			if (!Number.isFinite(reverseLat) || !Number.isFinite(reverseLon)) {
				return new Response(
					JSON.stringify({error: 'Valid lat/lon are required for reverse geocoding.'}),
					{status: 400, headers: {'Content-Type': 'application/json'}},
				)
			}

			const reverseUrl = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(String(reverseLat))}&lon=${encodeURIComponent(String(reverseLon))}&format=json&addressdetails=1`

			let reverseRes
			try {
				reverseRes = await fetch(reverseUrl, {
					headers: commonHeaders,
				})
			} catch (fetchError) {
				console.error('Fetch error calling Nominatim reverse:', fetchError.message)
				return new Response(
					JSON.stringify({error: 'Could not reach reverse geocoding service. Please try again.'}),
					{status: 503, headers: {'Content-Type': 'application/json'}},
				)
			}

			if (!reverseRes.ok) {
				const errorText = await reverseRes.text().catch(() => '')
				console.error(`Nominatim reverse returned ${reverseRes.status}:`, errorText)
				return new Response(
					JSON.stringify({error: 'Reverse geocoding service temporarily unavailable. Please try again.'}),
					{status: 503, headers: {'Content-Type': 'application/json'}},
				)
			}

			let data
			try {
				data = await reverseRes.json()
			} catch (parseError) {
				console.error('Failed to parse Nominatim reverse response:', parseError.message)
				return new Response(
					JSON.stringify({error: 'Reverse geocoding service error. Please try again.'}),
					{status: 503, headers: {'Content-Type': 'application/json'}},
				)
			}

			const city =
				data?.address?.city ||
				data?.address?.town ||
				data?.address?.village ||
				data?.address?.hamlet ||
				''
			const state =
				data?.address?.state ||
				data?.address?.province ||
				data?.address?.region ||
				data?.address?.state_district ||
				''
			const country = data?.address?.country || ''
			const zip = data?.address?.postcode || ''
			const houseNumber = data?.address?.house_number || ''
			const road = data?.address?.road || data?.address?.pedestrian || ''
			const neighbourhood = data?.address?.neighbourhood || ''
			const suburb = data?.address?.suburb || ''
			const line1 = [houseNumber, road].filter(Boolean).join(' ')
			const line2 = [neighbourhood, suburb].filter(Boolean).join(', ')
			const fallbackFormatted = [line1, line2, city, state, country, zip]
				.filter(Boolean)
				.join(', ')
			const formattedAddress = String(data?.display_name || fallbackFormatted || '').trim()

			return new Response(
				JSON.stringify({
					ok: true,
					lat: reverseLat,
					lon: reverseLon,
					houseNumber,
					road,
					neighbourhood,
					suburb,
					city,
					state,
					country,
					zip,
					formattedAddress,
				}),
				{status: 200, headers: {'Content-Type': 'application/json'}},
			)
		}

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
				headers: commonHeaders,
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
				JSON.stringify({ok: false, error: `Could not find location: ${query}`}),
				{status: 200, headers: {'Content-Type': 'application/json'}},
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

		return new Response(JSON.stringify({ok: true, lat, lon, city, country, zip}), {
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
