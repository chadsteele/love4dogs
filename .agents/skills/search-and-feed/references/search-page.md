# Search Page & Query Resolution Reference

The search functionality is defined in [+page.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/routes/search/[...terms]/+page.svelte).

## Query Preprocessing

### 1. Near Me Location Expansion
* Before querying the server, `processQueryForNearMe(rawQuery)` scans for the phrase `near me` (case-insensitive).
* If found, it fetches the current profile's location via `getCurrentProfileUuid()` and `readStoredProfileByUuid(uuid)`.
* If no location is set on the active profile, it scans other local stored profiles for a `confirmedLocation` value.
* It replaces the phrase `near me` with the location tokens (city, state, country) in the query string.

### 2. Search Fallback Mechanics (Popping Retries)
When a user searches:
* **Online Flow**:
  1. The client queries `GET /api/feed?query=...`.
  2. If the API returns zero posts, the search client splits the query by spaces, pops the last word/token, and repeats the fetch request.
  3. This retry loop continues until at least one post is returned or the query string becomes completely empty.
  4. If a popped query succeeds, it sets `searchTermsChanged = true` to inform the UI that fallback results are being displayed.
* **Offline Flow**:
  1. If the browser is offline or a network error occurs, the client loads all cached posts from the local database (`getAllPosts()`).
  2. It performs token filtering (each query token must match text, name, description, or tags in the cached post).
  3. If no posts match, it pops the last token and retries the local filter, continuing until matches are found or tokens run out.

### 3. Blocklists
The search page maintains `blockedUuids` and `blockedAuthors` arrays. If the user searches for `"blocked"`, it displays only the items matching those blocked records from the local cache.
