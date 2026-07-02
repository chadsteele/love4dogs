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

function replaceCanonicalLink(html, newUrl) {
	const regex = /(<link\s+[^>]*?rel=["']canonical["'][^>]*?href=["'])(.*?)(["'][^>]*>)/gi;
	if (regex.test(html)) {
		return html.replace(regex, `$1${escapeHtml(newUrl)}$3`);
	}
	return html;
}

async function fetchMetadata(uuid) {
	try {
		// First try with author filter
		let url = `${BSKY_PUBLIC_XRPC}/app.bsky.feed.searchPosts?q=${encodeURIComponent(
			uuid
		)}&author=love4dogs.club&limit=1`;
		let res = await fetch(url);
		let json = await res.json().catch(() => ({}));
		let post = json?.posts?.[0];

		// Fallback without author filter
		if (!post) {
			url = `${BSKY_PUBLIC_XRPC}/app.bsky.feed.searchPosts?q=${encodeURIComponent(
				uuid
			)}&limit=1`;
			res = await fetch(url);
			json = await res.json().catch(() => ({}));
			post = json?.posts?.[0];
		}

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

	const metaData = await fetchMetadata(uuid);
	if (!metaData) {
		return response;
	}

	const { primary, post } = metaData;
	const name = primary.name || primary.title || "";
	const description = primary.description || "";

	// Image priority: profilePic/profileImage, then first embed image of the post, then backgroundPic
	let image = primary.profilePic || primary.profileImage || "";
	if (!image) {
		const embedImages = post?.embed?.images || post?.record?.embed?.images || [];
		if (embedImages[0]) {
			image = embedImages[0].fullsize || embedImages[0].thumb || "";
			if (!image && embedImages[0].image) {
				const did = post.author?.did || "";
				const cid = embedImages[0].image?.ref?.$link || embedImages[0].image?.cid || "";
				if (did && cid) {
					image = `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`;
				}
			}
		}
	}
	if (!image) {
		image = primary.backgroundPic || "";
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
	html = replaceCanonicalLink(html, request.url);

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
