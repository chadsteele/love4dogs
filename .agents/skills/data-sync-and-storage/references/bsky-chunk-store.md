# Bluesky Alt Payload Chunk Store Reference

All operations involving encoding large HTML / profile configurations into Bluesky posts are defined in [bskyChunkStore.js](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/bskyChunkStore.js).

## The Alt-Text Chunking Protocol

Since Bluesky posts have a 300-character limit and image alt-texts have a 2000-character limit, this application embeds larger JSON payloads in the alt text of dummy post images.

### 1. Fragmentation
* A JSON payload is assembled (containing the HTML profile content, location information, and compressed image data).
* If the payload is too large, it is split into chunks.
* Each chunk's alt text is carefully measured (`measureChunkAltPayloadLength`) to stay strictly below the **2000-character limit** (typically ~1900 characters of raw JSON fragment).

### 2. Manifest & Origin Post
* An **Origin Post** is published first. Its alt text contains a manifest identifying:
  - `uuid`: The unique record UUID.
  - `chunkCount`: The number of chunks.
  - `chunkUris`: Initially empty, updated with references to subsequent chunk posts once published.
* A dummy transparent pixel image (or custom dog photo) is uploaded to host the alt-text metadata.

### 3. Reconstruction
To load a chunked profile/post:
* The client fetches the origin post (manifest) and parses its alt text to find the manifest.
* It extracts the `chunkUris` from the manifest.
* It fetches each chunk post, concurrently, but without triggering bsky's throttle, extracts the fragment JSON from the image alt text, and joins them in sequence.
* The combined string is parsed back into the original payload object.
