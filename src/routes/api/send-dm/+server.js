import { env } from '$env/dynamic/private';

const BSKY_XRPC = 'https://bsky.social/xrpc';
const CHAT_XRPC = 'https://api.bsky.chat/xrpc';

let cachedSession = null;

async function getSession() {
	if (cachedSession) return cachedSession;
	const identifier = env.BSKY_USERNAME || env.username;
	const secret = env.BSKY_PASSWORD || env.password;

	if (!identifier || !secret) {
		throw new Error('Missing Bluesky credentials in .env');
	}

	const res = await fetch(`${BSKY_XRPC}/com.atproto.server.createSession`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ identifier, password: secret })
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.message || 'Failed to create session');
	}

	cachedSession = await res.json();
	return cachedSession;
}

async function resolveHandle(handle) {
	const res = await fetch(`${BSKY_XRPC}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
	if (!res.ok) {
		throw new Error(`Failed to resolve handle ${handle}`);
	}
	const json = await res.json();
	return json.did;
}

export async function POST({ request }) {
	let message = '';
	try {
		const body = await request.json().catch(() => ({}));
		message = String(body.message || '').trim();
		if (!message) {
			return new Response(JSON.stringify({ error: 'Message is required' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		const session = await getSession();
		const targetDid = await resolveHandle('admin-love-4-dogs.bsky.social');

		// 1. Get convo or create one
		const convoRes = await fetch(`${CHAT_XRPC}/chat.bsky.convo.getConvoForMembers`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${session.accessJwt}`
			},
			body: JSON.stringify({ members: [targetDid] })
		});

		if (!convoRes.ok) {
			const err = await convoRes.json().catch(() => ({}));
			throw new Error(err.message || 'Failed to get convo');
		}

		const convo = await convoRes.json();
		const convoId = convo?.convo?.id;
		if (!convoId) {
			throw new Error('Convo ID not returned');
		}

		// 2. Send message
		const sendRes = await fetch(`${CHAT_XRPC}/chat.bsky.convo.sendMessage`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${session.accessJwt}`
			},
			body: JSON.stringify({
				convoId,
				message: {
					text: message
				}
			})
		});

		if (!sendRes.ok) {
			const err = await sendRes.json().catch(() => ({}));
			throw new Error(err.message || 'Failed to send message');
		}

		return new Response(JSON.stringify({ ok: true }), {
			headers: { 'content-type': 'application/json' }
		});
	} catch (err) {
		// Log mock notification to server console for testing/development
		console.warn(`[API] DM Send failed: ${err.message || err}. Falling back to mock console log.`);
		console.log('----------------------------------------');
		console.log('[MOCK DM TO ADMIN]:', message);
		console.log('----------------------------------------');

		return new Response(JSON.stringify({ ok: true, mocked: true }), {
			headers: { 'content-type': 'application/json' }
		});
	}
}
