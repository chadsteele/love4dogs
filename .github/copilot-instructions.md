# Copilot Instructions

## Minify/Compression Contract
- Do not modify the regex replacement patterns inside `minifyHtml` in `src/lib/utils.js` unless the user explicitly asks.
- Keep these exact replacements as-is for compatibility with stored payloads:
  - `result = result.replace(/<div\s/g, '<d ');`
  - `result = result.replace(/<\/div/g, '</d');`
  - `result = result.replace(/<strong\s/g, '<b ');`
  - `result = result.replace(/<\/strong>/g, '</b');`
  - `result = result.replace(/<em\s/g, '<i ');`
  - `result = result.replace(/<\/em/g, '</i');`
- If asked to change compression behavior, preserve backwards compatibility for already-stored payloads or provide a migration path.
