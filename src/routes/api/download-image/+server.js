export async function GET({url}) {
	try {
		const source = url.searchParams.get("url")
		if (!source) {
			return new Response("Missing image url", {status: 400})
		}

		let parsed
		try {
			parsed = new URL(source)
		} catch {
			return new Response("Invalid image url", {status: 400})
		}

		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return new Response("Unsupported protocol", {status: 400})
		}

		const upstream = await fetch(parsed.toString(), {
			headers: {
				Accept: "image/*,*/*;q=0.8",
				"User-Agent": "Love4Dogs/1.0 (image proxy)",
			},
			signal: AbortSignal.timeout(15000),
		})

		if (!upstream.ok) {
			return new Response("Upstream image fetch failed", {
				status: upstream.status,
			})
		}

		const contentType = upstream.headers.get("content-type") || ""
		if (!contentType.toLowerCase().startsWith("image/")) {
			return new Response("Upstream response was not an image", {
				status: 415,
			})
		}

		const blob = await upstream.blob()
		return new Response(blob, {
			status: 200,
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "private, max-age=600",
			},
		})
	} catch (error) {
		console.error("download-image proxy error:", error)
		return new Response("Image proxy failed", {status: 500})
	}
}
