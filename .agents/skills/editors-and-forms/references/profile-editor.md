# Profile Editor Reference

Profile creation and modification pages are defined in [src/routes/profile/edit/+page.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/routes/profile/edit/+page.svelte) and [src/routes/profile/edit/[[uuid]]/[...slug]/+page.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/routes/profile/edit/%5B%5Buuid%5D%5D/%5B...slug%5D/+page.svelte).

## Profile State & Fields
* **Properties**:
  - `profileName`: Required. Non-empty string.
  - `description`: Text area content.
  - `tags`: Tag array.
  - `confirmedLocation`: State, country, and zip are required before confirmation.
  - `profileUploadedMedia` (avatar list) and `backgroundUploadedMedia` (banner list).

## Draft Caching & Recovery
* The profile editor implements automatic draft saving to the `profiles` IndexedDB object store (keyed by the draft profile's UUID).
* When a user loads the page or refreshes, the app queries IndexedDB using the UUID to restore draft details (such as input text, selected tags, and offline images) so progress is not lost.

## Publish and Sync Lifecycle
* If the client is **online**, clicking publish compiles the payload, uploads the images to Bluesky, writes the chunks, and pushes the origin record.
* If **offline**, the client uploads the raw image files to the `offlineImages` store, creates local draft references, writes the publishing instructions to the `syncQueue`, and triggers background uploads when a network connection is re-established.
