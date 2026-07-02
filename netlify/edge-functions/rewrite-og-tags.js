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

function getOriginPost(bundle, uuid) {
	if (!bundle || !Array.isArray(bundle.posts)) return null;
	const primary = bundle.combined?.primary || {};
	const mainUri =
		primary.uri ||
		primary.rootUri ||
		primary.atUri ||
		bundle.originPayload?.primary?.uri;
	if (mainUri) {
		const found = bundle.posts.find((p) => p.uri === mainUri);
		if (found) return found;
	}
	return (
		bundle.posts.find((p) => {
			const text = String(p.record?.text || p.text || "");
			return text.includes(uuid);
		}) ||
		bundle.posts[0] ||
		null
	);
}

async function fetchMetadataFromApi(requestUrl, uuid) {
	try {
		const apiUrl = new URL(
			`/api/profile-bundle?uuid=${encodeURIComponent(uuid)}`,
			requestUrl
		);
		const res = await fetch(apiUrl);
		if (!res.ok) return null;
		const bundle = await res.json();
		if (!bundle || !bundle.combined) return null;
		return bundle;
	} catch (err) {
		console.error("Error fetching metadata from API:", err);
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

	const bundle = await fetchMetadataFromApi(request.url, uuid);
	if (!bundle) {
		return response;
	}

	const primary = bundle.combined?.primary || {};
	const name = primary.name || primary.title || "";
	const description = primary.description || "";

	// Image priority: profilePic/profileImage, then first embed image of the origin post, then backgroundPic
	let image = primary.profilePic || primary.profileImage || "";
	if (!image) {
		const originPost = getOriginPost(bundle, uuid);
		const embedImages =
			originPost?.embed?.images || originPost?.record?.embed?.images || [];
		if (embedImages[0]) {
			image = embedImages[0].fullsize || embedImages[0].thumb || "";
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
