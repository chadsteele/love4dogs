# Schema Definitions Reference

Data records are validated, normalized, and classified according to [schema.js](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/schema.js) and [postTypeTags.js](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/postTypeTags.js).

## BlueskySchemaRecord Model

The `BlueskySchemaRecord` represents the base structured format:
* **Properties**:
  - `uuid` (unique ID string)
  - `authorid` (linked local author ID)
  - `stamp` (ISO timestamp)
  - `canonicalurl` (canonical search mapping URL)
  - `title` / `name` (dog name or title)
  - `profilePic` (URL to avatar)
  - `backgroundPic` (URL to banner)
  - `description` (short post/profile summary)
  - `html` (serialized block format content)
  - `tags` (string array of categories)
* **Methods**:
  - `isProfile()`: Checks if the tag collection contains `'profile'`.
  - `toJSON()`: Exports the normalized properties, including name/compat aliases.

## Post and Record Classification

Posts are classified into type categories by `classifyPost(post)`:
1. **`profile`**: If image alt text JSON contains profile keys (`profileImage` or `profilePic`).
2. **`comment`**: If image alt text JSON contains `context`.
3. **`post`**: Standard chunk JSON format.
4. **`image_only_cdn`**: If no alt text is present, has exactly 1 image, and the text content includes the `🎞️` emoji.
5. **`unknown`**: Any standard text post without chunking meta.
