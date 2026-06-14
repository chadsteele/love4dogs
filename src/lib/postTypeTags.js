export function normalizePostType(value = '') {
	const normalized = String(value || '').trim().toLowerCase();
	if (normalized === 'profile') return 'profile';
	return '';
}

export function upsertTypeTag(tags = [], postType = '') {
	const existing = (Array.isArray(tags) ? tags : [])
		.map((entry) => String(entry || '').trim().toLowerCase())
		.filter(Boolean);
	const next = existing.filter((entry) => entry !== 'profile');
	if (normalizePostType(postType) === 'profile') {
		next.push('profile');
	}
	return [...new Set(next)].slice(0, 20);
}

export function extractPostTypeFromTags(tags = []) {
	for (const tag of Array.isArray(tags) ? tags : []) {
		const value = String(tag || '').trim().toLowerCase();
		if (value === 'profile') return 'profile';
	}
	return '';
}

export function classifyPost(post = {}) {
	if (!post || typeof post !== 'object') return 'unknown';

	let altJson = null;
	const candidates = [
		...(Array.isArray(post.imageAlts) ? post.imageAlts : []),
		post.video?.alt
	].filter((val) => typeof val === 'string' && val.trim());

	for (const candidate of candidates) {
		const trimmed = candidate.trim();
		if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
			try {
				const parsed = JSON.parse(trimmed);
				if (parsed && typeof parsed === 'object') {
					altJson = parsed;
					break;
				}
			} catch {
				// Ignore non-JSON
			}
		}
	}

	if (altJson) {
		if ('profileImage' in altJson || altJson.profileImage !== undefined) {
			return 'profile';
		}
		if ('context' in altJson || altJson.context !== undefined) {
			return 'comment';
		}
		return 'post';
	}

	const imageCount = Array.isArray(post.images) ? post.images.length : 0;
	const text = String(post.text || '');
	const hasMediaPrefix = text.includes('🎞️');

	if (!altJson && imageCount === 1 && hasMediaPrefix) {
		return 'image_only_cdn';
	}

	return 'unknown';
}

