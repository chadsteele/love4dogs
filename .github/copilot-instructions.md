# Copilot Instructions

## Minify/Compression Contract
- Do not modify the regex replacement patterns inside `minifyHtml` in `src/lib/utils.js` unless the user explicitly asks.
- Keep these exact replacements as-is for compatibility with stored payloads:
  - `result = result.replace(/<div\s/g, '<d ');`
  - `result = result.replace(/<\/div/g, '</d');`
  - `result = result.replace(/<strong\s/g, '<b ');`
  - `result = result.replace(/<\/strong>/g, '</b');`
  - `result = result.replace(/<em\s/g, '<i ');`
  - `result = result.replace(/<\/em/g, '</i');`
- If asked to change compression behavior, preserve backwards compatibility for already-stored payloads or provide a migration path.

## Bluesky API Endpoint Strategy
- For public, unauthenticated reads (profiles, posts, threads, likes, feed/search reads), prefer the Public API: `https://public.api.bsky.app/xrpc`.
- Use the Authorized API (`https://api.bsky.app` or the user's PDS) only for authenticated or user-scoped operations (create/update/delete content, follows, DMs, lists, mute/private data).
- Do not mix endpoints unnecessarily. Keep public-read flows on the Public API to benefit from caching and higher web-read throughput.

## Rate Limits and Retrieval Approach
- Implement exponential backoff on `429` responses for Bluesky API calls.
- For high-volume analytics/indexing use cases, prefer Firehose (`com.atproto.sync.subscribeRepos`) over polling standard endpoints.
- When refactoring or adding reads, preserve this split:
  - Public API for unauthenticated reads.
  - Authorized API/PDS for writes and user-authenticated actions.
