import { createAssertions } from "./regression-test-common.mjs";
import rewriteOgTags from "./netlify/edge-functions/rewrite-og-tags.js";

async function runTests() {
	const assertions = createAssertions();
	console.log("Running OG Tags Edge Function Regression Tests...");

	// Test 1: Non-matching path (should pass through)
	{
		const mockRequest = {
			url: "http://localhost:5173/about",
		};
		const mockResponse = new Response("<html><body>About page</body></html>", {
			headers: { "content-type": "text/html" },
		});
		const mockContext = {
			next: async () => mockResponse,
		};

		const result = await rewriteOgTags(mockRequest, mockContext);
		const text = await result.text();
		assertions.assertEqual(
			text,
			"<html><body>About page</body></html>",
			"Non-matching route returns original HTML"
		);
	}

	// Test 2: Matching path but non-HTML response
	{
		const mockRequest = {
			url: "http://localhost:5173/profile/view/test-uuid",
		};
		const mockResponse = new Response(JSON.stringify({ data: 1 }), {
			headers: { "content-type": "application/json" },
		});
		const mockContext = {
			next: async () => mockResponse,
		};

		const result = await rewriteOgTags(mockRequest, mockContext);
		const json = await result.json();
		assertions.assertEqual(
			json.data,
			1,
			"Non-HTML content returns original response"
		);
	}

	// Test 3: Matching profile route (should rewrite tags from bsky search result)
	{
		const mockRequest = {
			url: "http://localhost:5173/profile/view/test-profile-uuid",
		};
		const originalHtml = `
      <html>
        <head>
          <title>Original Title</title>
          <meta property="og:title" content="Original OG Title" />
          <meta property="og:description" content="Original Description" />
          <meta property="og:image" content="http://orig.img" />
          <meta property="og:url" content="http://orig.url" />
        </head>
        <body>Profile content</body>
      </html>
    `;
		const mockResponse = new Response(originalHtml, {
			headers: { "content-type": "text/html" },
		});
		const mockContext = {
			next: async () => mockResponse,
		};

		// Mock global fetch to return manifest payload
		const originalFetch = globalThis.fetch;
		const testManifest = {
			u: "test-profile-uuid",
			primary: {
				uuid: "test-profile-uuid",
				name: "Spotty Dog",
				description: "A very friendly spotty dog.",
				profileImage: "https://cdn.bsky.app/some-dog-pic.jpg",
			},
			chunks: "1. at://did:plc:123/app.bsky.feed.post/456",
		};

		globalThis.fetch = async (url) => {
			if (url.includes("app.bsky.feed.searchPosts")) {
				return new Response(
					JSON.stringify({
						posts: [
							{
								uri: "at://did:plc:123/app.bsky.feed.post/456",
								record: {
									text: JSON.stringify(testManifest),
								},
							},
						],
					})
				);
			}
			return new Response(null, { status: 404 });
		};

		try {
			const result = await rewriteOgTags(mockRequest, mockContext);
			const text = await result.text();

			assertions.assert(
				text.includes("<title>Spotty Dog | Love4Dogs</title>"),
				"Title tag updated"
			);
			assertions.assert(
				text.includes('<meta property="og:title" content="Spotty Dog" />'),
				"og:title updated"
			);
			assertions.assert(
				text.includes(
					'<meta property="og:description" content="A very friendly spotty dog." />'
				),
				"og:description updated"
			);
			assertions.assert(
				text.includes(
					'<meta property="og:image" content="https://cdn.bsky.app/some-dog-pic.jpg" />'
				),
				"og:image updated"
			);
			assertions.assert(
				text.includes(
					'<meta property="og:url" content="http://localhost:5173/profile/view/test-profile-uuid" />'
				),
				"og:url updated"
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	}

	// Summary
	const { passed, failed, total } = assertions.counts();
	console.log(
		`\nTests completed. Passed: ${passed}, Failed: ${failed}, Total: ${total}`
	);
	if (failed > 0) {
		process.exit(1);
	}
}

runTests();
