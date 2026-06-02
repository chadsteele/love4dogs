import { writable } from 'svelte/store';

/**
 * Search term persistence using localStorage.
 * Keeps search state across page navigation.
 */

const SEARCH_TERM_KEY = "love4dogs.search-term-v1"

export function readSearchTerm() {
	if (typeof window === "undefined") return ""
	try {
		return String(localStorage.getItem(SEARCH_TERM_KEY) || "").trim()
	} catch {
		return ""
	}
}

export function writeSearchTerm(value = "") {
	if (typeof window === "undefined") return
	try {
		const normalized = String(value || "").trim()
		if (normalized) {
			localStorage.setItem(SEARCH_TERM_KEY, normalized)
		} else {
			localStorage.removeItem(SEARCH_TERM_KEY)
		}
	} catch {
		// Silently fail on localStorage write error
	}
}

export function clearSearchTerm() {
	if (typeof window === "undefined") return
	try {
		localStorage.removeItem(SEARCH_TERM_KEY)
	} catch {
		// Silently fail
	}
}

