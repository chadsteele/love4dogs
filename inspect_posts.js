import { getAllPosts } from './src/lib/db.js';

async function main() {
	const posts = await getAllPosts();
	console.log(`Found ${posts.length} posts in DB`);
	for (const p of posts) {
		if (p.uuid === 'ot2qu3m2' || p.uri?.includes('ot2qu3m2')) {
			console.log(JSON.stringify(p, null, 2));
		}
	}
}

main();
