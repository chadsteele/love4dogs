---
name: data-sync-and-storage
description: Domain skill defining the data storage, schema representation, payload chunking, and network synchronization mechanisms.
---

# Data Sync & Storage Domain

This domain handles local database transactions (IndexedDB), database model definitions, network sync queues for offline resilience, and Bluesky payload serialization/chunking.

## Overview

When working with data persistence, schema rules, chunk storage, or background synchronizations, refer to the following subsystem specifications:

1. **Local Database (IndexedDB & Memory Stores)**:
   See [references/db.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/data-sync-and-storage/references/db.md) for IndexedDB object stores (`settings`, `profiles`, `posts`, `syncQueue`, `offlineImages`), automatic database caching TTLs, 100-post pruning constraints, and the localStorage migration logic.
   
2. **Bluesky Alt Payload Chunk Store**:
   See [references/bsky-chunk-store.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/data-sync-and-storage/references/bsky-chunk-store.md) for how large payloads (such as profiles containing compressed images) are chunked into multiple 2000-character segments, embedded in standard Bluesky post image alt text, and reassembled at fetch-time.

3. **Background Synchronization Queue**:
   See [references/sync.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/data-sync-and-storage/references/sync.md) for how queued operations are managed, how offline mode is handled, and how conflict resolutions are run during background runs.

4. **Schema Definitions**:
   See [references/schema.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/data-sync-and-storage/references/schema.md) for the `BlueskySchemaRecord` model, profile tag requirements (`profile`), post type helpers, and address-formatting specifications.
