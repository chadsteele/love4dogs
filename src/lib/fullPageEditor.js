import { writable } from 'svelte/store';
// Store to track if the editor is in full page mode
export const fullPageEditor = writable(false);