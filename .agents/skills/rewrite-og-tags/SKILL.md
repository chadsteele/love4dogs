---
name: rewrite-og-tags
description: Guidance for editing the Netlify Edge Function that rewrites Open Graph tags for dynamic routes in this SvelteKit repo, using Bluesky manifests.
---

# Rewrite OG Tags Edge Function

Use this skill when updating the Netlify Edge Function at netlify/edge-functions/rewrite-og-tags.js, debugging missing social preview metadata, or adding support for a new route pattern.

## Purpose

- This function runs after SvelteKit renders HTML and rewrites Open Graph meta tags for social sharing.
- It only targets HTML responses and preserves the existing response status, headers, and body.

## Current Repository Behavior

- The edge function intercepts requests for dynamic views:
  - Profiles: `/profile/view/<uuid>` (and optional slug)
  - Posts: `/post/view/<uuid>` (and optional slug)
- It extracts the `uuid` from the path and queries the public Bluesky search endpoint to locate the origin/manifest post:
  - Query URL: `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=<uuid>+profile&author=love4dogs.club&limit=1`
- It extracts the manifest payload from the first post's text or image `alt` text (a JSON string containing `{ u: uuid, primary: { ... }, chunks: ... }`).
- **No Dechunking Required**: It only extracts the `primary` metadata directly from this manifest (no need to fetch or parse subsequent chunks).
- It maps the metadata into:
  - `og:url` (the canonical path/slug)
  - `og:title` (`primary.name` for profiles, or post title/name for posts)
  - `og:description` (`primary.description` or text snippet)
  - `og:image` (derived from `primary.profileImage` / `primary.profilePic` / `primary.backgroundPic`, or the first image CDN URL from the post embed).

## Editing Rules

- Keep the logic data-driven where possible and reuse existing route data instead of introducing new hardcoded values.
- Escape user-controlled or route-derived values with `escapeHtml` before inserting them into the HTML.
- Return early for non-HTML responses so the edge function does not interfere with other content types.
- Ensure the author filter on the search request is kept in sync with the configured site domain (`love4dogs.club`).

## Checklist Before Changing Behavior

- Confirm the actual pathname matches the route logic you intend to affect (`/profile/view/[uuid]` and `/post/view/[uuid]`).
- Verify the target meta tags still exist in the rendered HTML.
- Check that rewritten values are properly escaped and valid for meta content.
- Ensure fallback values are available if the Bluesky API fetch fails or returns no posts.

## Common Failure Modes

- Matching the wrong route prefix, such as `/profile/edit` instead of `/profile/view`.
- Failing to parse the alt text JSON safely, leading to uncaught errors.
- Rewriting only one OG tag while leaving the others stale.
- Injecting unescaped HTML characters into meta content.
- Breaking the function for non-HTML responses or existing response headers.
