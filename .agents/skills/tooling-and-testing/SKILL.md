---
name: tooling-and-testing
description: Guidelines for running regression tests, schema checks, and database cleanup scripts in the love4dogs project.
---

# Project Tooling & Testing

This project includes custom Node.js scripts for schema checks, regression testing of chunk publishing/loading to public Bluesky, and local data cleanup.

## Regression Test Suite

You can run the regression tests using the following package scripts:

* Run all regression tests:
  ```bash
  npm run test:regression
  ```
* Run specific regression test suites:
  - **Schema & Database Caching Tests**: `npm run test:regression:schema` (executes [regression-test-schema.mjs](file:///Users/chad.steele/code/2026/svelte/love4dogs/regression-test-schema.mjs))
  - **Post Chunking/Reconstruction Tests**: `npm run test:regression:posts` (executes [regression-test-posts.mjs](file:///Users/chad.steele/code/2026/svelte/love4dogs/regression-test-posts.mjs))
  - **Profile Chunking/Reconstruction Tests**: `npm run test:regression:chunks` (executes [regression-test-profiles.mjs](file:///Users/chad.steele/code/2026/svelte/love4dogs/regression-test-profiles.mjs))

### Custom Test Arguments
The post and profile regression tests support the following options:
* `--author=<handle>`: The Bluesky handle or DID of the publishing account (defaults to `BSKY_AUTHOR` or `'love4dogs.club'`).
* `--server=<url>`: Base URL of the local dev server (defaults to `TEST_SERVER_URL` or `'http://localhost:5173'`).
* `--wait=<ms>`: Wait time for public Bluesky indexing in milliseconds (defaults to `15000`).
* `--location=<query>`: Test location parameters.

## Maintenance and Cleanup Scripts

Several utility scripts are available in the root folder for database pruning and cleanup:

1. **Delete water posts**:
   ```bash
   npm run delete-water-posts
   ```
   (executes [delete_water_posts.js](file:///Users/chad.steele/code/2026/svelte/love4dogs/delete_water_posts.js)) to remove posts with coordinates over bodies of water.
2. **Delete anonymous profiles**:
   `node delete_anonymous_profiles.js` to purge profiles lacking valid ownership or links.
3. **Delete all posts**:
   `node delete_all_posts.js` to delete all locally cached posts.
4. **Inspect posts cache**:
   `node inspect_posts.js` to print out statistics about the active post cache.
