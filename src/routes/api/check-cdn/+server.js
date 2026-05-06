import {json} from "@sveltejs/kit"

const ALLOWED_CDN_HOST = "cdn.bsky.app"

export async function GET({url}) {
	const cdnUrl = url.searchParams.get("url") || ""

	let parsed
	try {
		parsed = new URL(cdnUrl)
	} catch {
		return json({available: false, error: "invalid url"}, {status: 400})
	}

	if (parsed.hostname !== ALLOWED_CDN_HOST) {
		return json({available: false, error: "disallowed host"}, {status: 400})
	}

	try {
		const response = await fetch(cdnUrl, {
			method: "HEAD",
			signal: AbortSignal.timeout(5000),
		})
		return json({available: response.ok, status: response.status})
	} catch {
		return json({available: false})
	}
}
