# Rich Text Editor Component Reference

The primary rich text editor interface is defined in [Editor.svelte](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/Editor.svelte), supported by [editorMediaInterop.js](file:///Users/chad.steele/code/2026/svelte/love4dogs/src/lib/editorMediaInterop.js).

## Component Architecture

### Pell Editor Wrapper
* Simple Pell WYSIWYG editor implementation wrapping raw HTML inputs.
* Emits standard input and keyup events to parent forms to bubble validation.

### CodeMirror Editor
* CodeMirror basic-setup is used for advanced formatting.
* Configures HTML/Markdown syntax highlighting modes.
* Custom theme integration matching the dark-mode/glassmorphism design language.

### Media Interoperability
* Handles drag-and-drop or file-picker actions to insert images into the editor.
* Converts attachments into custom markdown image/attachment nodes before saving the payload document.
