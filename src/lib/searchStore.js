import { getSetting, setSetting, removeSetting } from './db.js';

const SEARCH_TERM_KEY = "love4dogs.search-term-v1"

export async function readSearchTerm() {
	return String(await getSetting(SEARCH_TERM_KEY, '')).trim();
}

export async function writeSearchTerm(value = "") {
	try {
		const normalized = String(value || "").trim();
		if (normalized) {
			await setSetting(SEARCH_TERM_KEY, normalized);
		} else {
			await removeSetting(SEARCH_TERM_KEY);
		}
	} catch {
		// Silently fail
	}
}

export async function clearSearchTerm() {
	try {
		await removeSetting(SEARCH_TERM_KEY);
	} catch {
		// Silently fail
	}
}
