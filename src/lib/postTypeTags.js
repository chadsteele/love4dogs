export function normalizePostType(value = '') {
	const normalized = String(value || '').trim().toLowerCase();
	if (normalized === 'profile') return 'profile';
	return '';
}

export function upsertTypeTag(tags = [], postType = '') {
	void postType;
	const existing = (Array.isArray(tags) ? tags : [])
		.map((entry) => String(entry || '').trim().toLowerCase())
		.filter(Boolean);
	return [...new Set(existing)].slice(0, 20);
}

export function extractPostTypeFromTags(tags = []) {
	for (const tag of Array.isArray(tags) ? tags : []) {
		const value = String(tag || '').trim().toLowerCase();
		if (value === 'profile') return 'profile';
	}
	return '';
}
