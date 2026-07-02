# Post Editor & Composer Reference

Creating and editing feed posts is handled in [src/routes/post/edit/[[uuid]]/[...slug]/+page.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/routes/post/edit/%5B%5Buuid%5D%5D/%5B...slug%5D/+page.svelte).

## Post Composition Fields
* **Properties**:
  - `postText`: Main text description or Markdown content.
  - `tags`: Selected categories (e.g. `Urgent`, `Adoptable`, `Foster`).
  - `primaryMedia`: Array of uploaded images.

## Toggleable Tag Feature
* **Behavior**: Toggleable tags are displayed between the title and description fields in post forms.
* **Appending to Description**: Toggling a tag appends it to the end of the description field as a hashtag (e.g. `#urgent`).
* **Word Count Correlation**: Editing the description text area directly or toggling tags automatically updates the current post description word counter to remain in sync.
* **Validation**: Restricts posting if the total text count exceeds standard limits.
