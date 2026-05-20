import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		host: 'localhost',
		port: 5173,
		hmr: {
			host: 'localhost',
			protocol: 'ws'
		}
	},
	resolve: {
		dedupe: ["@codemirror/state", "@codemirror/view"],
	},
});
