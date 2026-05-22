const HASHTAG_REGEX = /(^|\s)#([\p{L}\p{N}_-]+)/gu;

export function extractHashtags(text = '') {
	const matches = String(text || '').match(HASHTAG_REGEX) || [];
	return matches.map((tag) => tag.replace(/^[\s#]+/, '').toLowerCase());
}

export function normalizePostType(value = '') {
	const normalized = String(value || '').trim().toLowerCase();
	if (normalized === 'profile') return 'profile';
	if (normalized === 'post') return 'post';
	return '';
}

export function upsertTypeTag(tags = [], postType = '') {
	const type = normalizePostType(postType);
	const existing = (Array.isArray(tags) ? tags : [])
		.map((entry) => String(entry || '').trim().toLowerCase())
		.filter(Boolean)
		.filter((entry) => !entry.startsWith('l4d-type:'));
	if (type) existing.push(`l4d-type:${type}`);
	return [...new Set(existing)].slice(0, 20);
}

export function extractPostTypeFromTags(tags = []) {
	for (const tag of Array.isArray(tags) ? tags : []) {
		const value = String(tag || '').trim().toLowerCase();
		if (value === 'l4d-type:profile') return 'profile';
		if (value === 'l4d-type:post') return 'post';
	}
	return '';
}
