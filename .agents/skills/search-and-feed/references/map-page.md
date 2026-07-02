# Mapping & Geocoding Reference

The maps, location pins, and geo queries are defined across [MapView.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/MapView.svelte), [LocationPicker.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/LocationPicker.svelte), and [locationUtils.js](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/locationUtils.js).

## Leaflet Map Integration
* The application loads and initializes **Leaflet** to render maps dynamically on the client side.
* In [MapView.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/MapView.svelte), map markers are customized to represent dog posts/profiles.
* Pins support popup triggers containing the dog's picture, tags, and clickable links to view their full pages.

## Location Hashing (Privacy Protection)
To prevent exposing users' exact addresses:
* Coordinates are split into two levels of granularity:
  - **Approximate Location**: A geohash/grid cell representation used on public index pages (e.g. `/map/<approx>`).
  - **Exact Location**: Encrypted or stored within the payload metadata, retrieved only when explicitly authorized or required.
* The location hash paths (e.g., `approximate/exact`) are stored inside the `BlueskySchemaRecord` JSON metadata to construct map links.

## Geocoding and Verification
* All address search and reverse-geocoding (coordinate-to-address) requests route through `/api/geocode`.
* The client performs geocoding lookups via `lookupLocationDetails(lat, lon)` using Nominatim/OpenStreetMap formats.
* Addresses must satisfy the required parts check (`hasRequiredLocationParts`): state, country, and zip code are mandatory before location coordinates can be confirmed.
