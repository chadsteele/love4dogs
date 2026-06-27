import { env } from '$env/dynamic/private';
import { AtpAgent } from '@atproto/api';

const BSKY_SERVICE = 'https://bsky.social';
let cachedAgent = null;
let cachedIdentifier = null;
let cachedSecret = null;

async function getAgent(forceRefresh = false) {
	const identifier = env.BSKY_USERNAME || env.BSKY_ADMIN_HANDLE ||
		(typeof process !== 'undefined' && process.env && (process.env.BSKY_USERNAME || process.env.BSKY_ADMIN_HANDLE)) || '';
	const secret = env.BSKY_PASSWORD ||
		(typeof process !== 'undefined' && process.env && process.env.BSKY_PASSWORD) || '';

	if (!identifier || !secret) {
		throw new Error('Missing Bluesky credentials in .env');
	}

	if (
		cachedAgent &&
		!forceRefresh &&
		cachedIdentifier === identifier &&
		cachedSecret === secret
	) {
		return cachedAgent;
	}

	try {
		const agent = new AtpAgent({ service: BSKY_SERVICE });
		await agent.login({ identifier, password: secret });
		cachedAgent = agent;
		cachedIdentifier = identifier;
		cachedSecret = secret;
		return cachedAgent;
	} catch (loginErr) {
		// Clear credentials on login failure so we don't cache bad state
		cachedAgent = null;
		cachedIdentifier = null;
		cachedSecret = null;
		throw loginErr;
	}
}

async function resolveHandle(agent, handle) {
	const res = await agent.com.atproto.identity.resolveHandle({ handle });
	return res.data.did;
}

export async function POST({ request }) {
	let message = '';
	try {
		const body = await request.json().catch(() => ({}));
		
		// If it is a structured JSON payload request, construct the JSON string
		if (
			body.from !== undefined ||
			body.block !== undefined ||
			body.unblock !== undefined ||
			body.report !== undefined
		) {
			const payload = {};
			payload.from = String(body.from || '').trim();
			
			if (body.block !== undefined) {
				payload.block = String(body.block || '').trim();
			} else if (body.unblock !== undefined) {
				payload.unblock = String(body.unblock || '').trim();
			} else if (body.report !== undefined) {
				payload.report = String(body.report || '').trim();
				payload.reason = String(body.reason || '').trim();
				payload.details = String(body.details || '').trim();
			}
			
			// Always add a timestamp if not present (per user requirement)
			payload.timestamp = body.timestamp ? String(body.timestamp).trim() : new Date().toISOString();
			
			message = JSON.stringify(payload);
		} else {
			// Fallback to legacy plain string
			message = String(body.message || '').trim();
		}

		if (!message) {
			return new Response(JSON.stringify({ error: 'Message is required' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		let agent = await getAgent();

		async function attemptSend(activeAgent) {
			const adminHandle = env.BSKY_ADMIN_HANDLE ||
				(typeof process !== 'undefined' && process.env && process.env.BSKY_ADMIN_HANDLE) || '';
			if (!adminHandle) {
				throw new Error('Missing BSKY_ADMIN_HANDLE/ADMIN_HANDLE in environment variables');
			}
			const targetDid = await resolveHandle(activeAgent, adminHandle);

			// Create a proxy instance for the chat service
			const proxy = activeAgent.withProxy('bsky_chat', 'did:web:api.bsky.chat');

			// 1. Get convo or create one
			const convoRes = await proxy.chat.bsky.convo.getConvoForMembers({
				members: [targetDid]
			});

			const convoId = convoRes.data?.convo?.id;
			if (!convoId) {
				throw new Error('Convo ID not returned');
			}

			// 2. Send message
			await proxy.chat.bsky.convo.sendMessage({
				convoId,
				message: {
					text: message
				}
			});
		}

		try {
			await attemptSend(agent);
		} catch (sendErr) {
			// If it failed, it might be due to an expired/invalid session, or updated env credentials.
			// Let's force a new login and retry once.
			console.warn(`[API] DM Send attempt failed: ${sendErr.message || sendErr}. Retrying with fresh login...`);
			agent = await getAgent(true);
			await attemptSend(agent);
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

