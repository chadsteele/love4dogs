import { json } from '@sveltejs/kit';
import { getAllPostKeys, clearAllPosts } from '$lib/db.js';

export async function GET() {
	try {
		const keys = await getAllPostKeys();
		return json({ ok: true, keys });
	} catch (error) {
		console.error('[GET /api/cache/all] failed:', error);
		return json({ error: error?.message || 'Internal server error' }, { status: 500 });
	}
}

export async function DELETE() {
	try {
		await clearAllPosts();
		return json({ ok: true, message: 'All cache entries have been cleared.' });
	} catch (error) {
		console.error('[DELETE /api/cache/all] failed:', error);
		return json({ error: error?.message || 'Internal server error' }, { status: 500 });
	}
}
