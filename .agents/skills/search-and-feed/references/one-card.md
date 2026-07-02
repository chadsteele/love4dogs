# OneCard UI Component Reference

The primary feed card component is defined in [OneCard.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/OneCard.svelte).

## Design & Aesthetics
* **Glassmorphism**: Uses backdrop filters and transparent overlays for a premium modern feel.
* **Responsive Layouts**: Designed to adapt gracefully between mobile grids and multi-column desktop displays.
* **Micro-animations**: Smooth hover scaling, tag transitions, and button highlight states.

## Card Structures
1. **Header Row**: Renders [AuthorRow.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/AuthorRow.svelte) (showing the publisher's Bluesky avatar and display name) alongside tag flags (such as "Urgent" or "Foster").
2. **Media Section**: Displays single or carousel image layout templates. Uses [ImageLayout.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/ImageLayout.svelte) to aspect-fit dog pictures.
3. **Content Description**: Links text content dynamically using [Linkify.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/Linkify.svelte).
4. **Action Bar**:
   - Favorite/Star toggles (using [Stars.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/Stars.svelte)).
   - Share sheets ([Shares.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/Shares.svelte)).
   - Location mapping navigation button (deep links to the map route).
