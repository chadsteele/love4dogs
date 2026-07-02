---
name: water-pin-prevention
description: Guidance on preventing pins over water/sea on Leaflet maps by filtering posts during ingestion and retrieval.
---

# Water Pin Prevention

Ensure no post or profile coordinates mapping to a body of water or ocean are rendered on maps.

## Guidelines

1. **Server Ingestion & Feed Check**:
   - Geocoding and post publishing endpoints must validate coordinates using `is-sea` and reject water addresses.
   - The feed endpoint (`/api/feed`) must filter out posts located in water by calling `isPostInWater(post, isSea)` from `$lib/utils.js`.

2. **Database Cleanups**:
   - Run cache water cleanups via `cleanWaterPostsFromCaches()` regularly to keep IndexedDB and cache stores clear of invalid coordinates.
