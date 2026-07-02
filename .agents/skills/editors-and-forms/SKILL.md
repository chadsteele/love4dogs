---
name: editors-and-forms
description: Domain skill defining the profile creation/editing logic, post composer layout, image upload validations, and CodeMirror/Pell editor integrations.
---

# Editors & Forms Domain

This domain handles the form inputs, rich text editor setups, image compression/uploads, draft management, and validation logic.

## Overview

When modifying page editors, CodeMirror instances, post creation forms, or media attachment rules, refer to the following subsystem specifications:

1. **Profile Creator & Editor**:
   See [references/profile-editor.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/editors-and-forms/references/profile-editor.md) for profile form inputs, handle formatting rules, image storage paths, and automatic draft saving/caching checks.
   
2. **Post Editor & Composer**:
   See [references/post-editor.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/editors-and-forms/references/post-editor.md) for creating and updating posts, tag collections, inline tag toggling, and description word counters.

3. **Rich Text Editor Component**:
   See [references/editor-component.md](file:///Users/chad.steele/code/2026/svelte/love4dogs/.agents/skills/editors-and-forms/references/editor-component.md) for Pell HTML editor styling, CodeMirror configurations, and input lifecycle events.
