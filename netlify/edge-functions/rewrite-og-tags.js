const BSKY_PUBLIC_XRPC = "https://public.api.bsky.app/xrpc";

function escapeHtml(str) {
	if (typeof str !== "string") return "";
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function replaceMetaTag(html, property, newContent) {
	const regex = new RegExp(
		`(<meta\\s+[^>]*?(?:property|name)=["']${property}["'][^>]*?content=["'])(.*?)(["'][^>]*>)`,
		"gi"
	);
	if (regex.test(html)) {
		return html.replace(regex, `$1${escapeHtml(newContent)}$3`);
	} else {
		return html.replace(
			"</head>",
			`<meta property="${property}" content="${escapeHtml(newContent)}" />\n</head>`
		);
	}
}

function replaceTitleTag(html, newTitle) {
	const regex = /<title>(.*?)<\/title>/gi;
	if (regex.test(html)) {
		return html.replace(regex, `<title>${escapeHtml(newTitle)}</title>`);
	}
	return html;
}

async function fetchMetadata(uuid) {
	try {
		const url = `${BSKY_PUBLIC_XRPC}/app.bsky.feed.searchPosts?q=${encodeURIComponent(
			uuid + " profile"
		)}&author=love4dogs.club&limit=1`;
		const res = await fetch(url);
		if (!res.ok) return null;
		const json = await res.json();
		const post = json?.posts?.[0];
		if (!post) return null;

		const text = post.record?.text || post.text || "";
		const images = post.embed?.images || post.record?.embed?.images || [];

		const candidates = [text, ...images.map((img) => img.alt || "")].filter(
			Boolean
		);
		for (const cand of candidates) {
			try {
				const parsed = JSON.parse(cand);
				const payloadUuid = parsed.u || parsed.uuid || parsed.primary?.uuid;
				if (payloadUuid === uuid && parsed.primary) {
					return {
						primary: parsed.primary,
						post,
					};
				}
			} catch {
				// Not JSON, ignore
			}
		}
	} catch (err) {
		console.error("Error fetching metadata:", err);
	}
	return null;
}

export default async (request, context) => {
	const url = new URL(request.url);
	const pathname = url.pathname;

	const pathParts = pathname.split("/");
	const isTargetRoute =
		(pathParts[1] === "profile" || pathParts[1] === "post") &&
		pathParts[2] === "view" &&
		pathParts[3];

	if (!isTargetRoute) {
		return context.next();
	}

	const response = await context.next();

	const contentType = response.headers.get("content-type") || "";
	if (!contentType.includes("text/html")) {
		return response;
	}

	const uuid = pathParts[3];
	const type = pathParts[1];

	const metaData = await fetchMetadata(uuid);
	if (!metaData) {
		return response;
	}

	const { primary, post } = metaData;
	const name = primary.name || primary.title || "";
	const description = primary.description || "";

	let image = "";
	if (type === "profile") {
		image =
			primary.profileImage ||
			primary.profilePic ||
			primary.backgroundPic ||
			"";
	} else {
		image = primary.profileImage || primary.profilePic || "";
		if (!image && post?.embed?.images?.[0]) {
			const bskyImg = post.embed.images[0];
			const did = post.author?.did || "";
			const cid = bskyImg.image?.ref?.$link || bskyImg.image?.cid || "";
			if (did && cid) {
				image = `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`;
			}
		}
	}

	let html = await response.text();

	if (name) {
		html = replaceTitleTag(html, `${name} | Love4Dogs`);
		html = replaceMetaTag(html, "og:title", name);
		html = replaceMetaTag(html, "twitter:title", name);
	}
	if (description) {
		html = replaceMetaTag(html, "og:description", description);
		html = replaceMetaTag(html, "twitter:description", description);
	}
	if (image) {
		html = replaceMetaTag(html, "og:image", image);
		html = replaceMetaTag(html, "twitter:image", image);
		html = replaceMetaTag(html, "twitter:card", "summary_large_image");
	}
	html = replaceMetaTag(html, "og:url", request.url);

	const newHeaders = new Headers(response.headers);
	newHeaders.delete("content-length");

	return new Response(html, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	});
};

export const config = {
	path: ["/profile/view/*", "/post/view/*"],
};
