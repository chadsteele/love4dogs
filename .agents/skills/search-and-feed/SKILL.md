---
name: search-and-feed
description: Domain skill defining query parsing, fuzzy fallback search, near-me location expansions, Leaflet map integrations, and feed card displays.
---

# Search & Feed Domain

This domain handles search parsing, geo-expansion, Leaflet mapping integrations, and the post/profile card layout.

## Overview

When modifying search layouts, mapping components, search result cards, or location pickers, refer to the following subsystem specifications:

1. **Search Page & Queries**:
   See [references/search-page.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/search-and-feed/references/search-page.md) for fuzzy query fallbacks (iterative term popping on zero results), location expansions for "near me" using city/state/country configurations, and blocklists.
   
2. **Map View & Geocoding**:
   See [references/map-page.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/search-and-feed/references/map-page.md) for Leaflet map markers, coordinates approximate/exact layouts, geocoder api routes, and address formatters.

3. **OneCard Display UI**:
   See [references/one-card.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/search-and-feed/references/one-card.md) for post/profile cards layout, tag pills, inline action sheets, and custom client-side styling.
