import {minify} from "html-minifier-terser"

export async function POST({request}) {
	const body = await request.json().catch(() => ({}))
	const source = String(body?.html || "")
	if (!source.trim()) {
		return new Response(
			JSON.stringify({ok: true, minifiedHtml: ""}),
			{headers: {"content-type": "application/json"}},
		)
	}

	try {
		const minifiedHtml = await minify(source, {
			collapseWhitespace: true,
			removeComments: true,
			removeRedundantAttributes: true,
			removeEmptyAttributes: true,
			minifyCSS: true,
			minifyJS: true,
			continueOnParseError: true,
		})

		return new Response(
			JSON.stringify({ok: true, minifiedHtml}),
			{headers: {"content-type": "application/json"}},
		)
	} catch (error) {
		return new Response(
			JSON.stringify({
				ok: true,
				minifiedHtml: source,
				warning: error?.message || "Unable to minify HTML.",
			}),
			{headers: {"content-type": "application/json"}},
		)
	}
}
