#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { AtpAgent } from '@atproto/api';

const BSKY_SERVICE = 'https://bsky.social';
const DEFAULT_COLLECTION = 'app.bsky.feed.post';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDotEnv(filePath = '.env') {
	const absolute = path.resolve(process.cwd(), filePath);
	if (!fs.existsSync(absolute)) return;
	const contents = fs.readFileSync(absolute, 'utf8');
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (!(key in process.env)) process.env[key] = value;
	}
}

async function createAgentSession() {
	loadDotEnv('.env');

	const identifier = process.env.BSKY_USERNAME || process.env.username;
	const password = process.env.BSKY_PASSWORD || process.env.password;

	if (!identifier || !password) {
		throw new Error('Missing BSKY credentials. Set BSKY_USERNAME and BSKY_PASSWORD in env/.env.');
	}

	const agent = new AtpAgent({ service: BSKY_SERVICE });
	await agent.login({ identifier, password });
	return { agent, identifier };
}

async function listAllPosts({ agent, repo, collection }) {
	const records = [];
	let cursor = undefined;

	while (true) {
		const response = await agent.com.atproto.repo.listRecords({
			repo,
			collection,
			limit: 100,
			cursor,
			reverse: true,
		});
		const page = Array.isArray(response?.data?.records) ? response.data.records : [];
		records.push(...page);
		cursor = response?.data?.cursor;
		if (!cursor || page.length === 0) break;
	}

	return records;
}

// Geohash decoding helper
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_INDEX = Object.fromEntries([...BASE32].map((char, index) => [char, index]));

function hashToGps(exactHash) {
	const s = String(exactHash || '').trim().toLowerCase();
	if (!s || s.length !== 9) return null;

	const latRange = [-90, 90];
	const lonRange = [-180, 180];
	let useLon = true;

	for (const c of s) {
		const v = BASE32_INDEX[c];
		if (v === undefined) return null;
		for (let mask = 16; mask > 0; mask >>= 1) {
			const upper = (v & mask) !== 0;
			if (useLon) { if (upper) lonRange[0] = (lonRange[0]+lonRange[1])/2; else lonRange[1] = (lonRange[0]+lonRange[1])/2; }
			else        { if (upper) latRange[0] = (latRange[0]+latRange[1])/2; else latRange[1] = (latRange[0]+latRange[1])/2; }
			useLon = !useLon;
		}
	}

	return { lat: (latRange[0]+latRange[1])/2, lon: (lonRange[0]+lonRange[1])/2 };
}

// Parse location link from text
function extractExactHash(text = '') {
	const regex = /love4dogs\.club\/map\/[0-9bcdefghjkmnpqrstuvwxyz]{5}\/([0-9bcdefghjkmnpqrstuvwxyz]{9})/i;
	const match = String(text || '').match(regex);
	return match ? match[1] : '';
}

function extractExactHashFromAlt(record) {
	const images = record?.value?.embed?.images || [];
	for (const img of images) {
		const alt = String(img.alt || '').trim();
		if (alt.startsWith('{')) {
			try {
				const parsed = JSON.parse(alt);
				const exact = parsed.exact || parsed.location?.exact || parsed.primary?.location?.exact;
				if (exact) return exact;
			} catch {}
		}
	}
	return '';
}

function getRecordUuid(record) {
	const value = record?.value || {};
	const images = value.embed?.images || [];
	for (const img of images) {
		const alt = String(img.alt || '').trim();
		if (alt.startsWith('{')) {
			try {
				const parsed = JSON.parse(alt);
				const uuid = parsed.uuid || parsed.u || parsed.primary?.uuid;
				if (uuid) return uuid;
			} catch {}
		}
	}
	return '';
}

async function isLikelyWaterAddress(lat, lon) {
	try {
		console.log(`Querying Nominatim for coordinates: ${lat}, ${lon}...`);
		const res = await fetch(
			`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
			{
				headers: {
					'Accept-Language': 'en',
					'User-Agent': 'Love4Dogs-Cleanup/1.0',
				}
			}
		);
		if (!res.ok) {
			console.log(`Nominatim request returned status ${res.status}`);
			return false; // Safely skip if API is down
		}
		const data = await res.json();
		if (!data || typeof data !== 'object') return false;
		
		const address = data.address || {};
		
		// If there is no country, it's probably not a valid addressable land location
		if (!address.country) {
			console.log(`Location has no country: ${data.display_name}`);
			return true;
		}

		const formattedAddress = String(data.display_name || '').toLowerCase();
		const road = String(address.road || '').toLowerCase();
		const city = String(address.city || address.town || address.village || address.hamlet || '').toLowerCase();
		const suburb = String(address.suburb || '').toLowerCase();
		const neighbourhood = String(address.neighbourhood || '').toLowerCase();
		
		const source = [formattedAddress, road, city, suburb, neighbourhood].join(' ');
		const waterHints = [
			'ocean',
			'sea',
			'gulf',
			'bay',
			'channel',
			'offshore',
			'lagoon',
			'reef',
			'harbor',
			'harbour',
			'marina',
		];
		
		const isWater = waterHints.some((token) => new RegExp('\\b' + token + '\\b').test(source));
		if (isWater) {
			console.log(`Detected water address: ${data.display_name}`);
		}
		return isWater;
	} catch (err) {
		console.error('Error reverse geocoding:', err.message);
		return false;
	}
}

async function deleteRecord({ agent, repo, record }) {
	const uri = String(record?.uri || '').trim();
	if (!uri) return { ok: false };
	const rkey = uri.split('/').pop();
	try {
		await agent.com.atproto.repo.deleteRecord({
			repo,
			collection: DEFAULT_COLLECTION,
			rkey,
		});
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error.message };
	}
}

async function main() {
	console.log('============================================================');
	console.log('Find and Delete Water/Ocean Posts on Bluesky');
	console.log('============================================================');
	
	const { agent, identifier } = await createAgentSession();
	const repoDid = String(agent?.session?.did || '').trim();
	console.log(`Authenticated as: ${identifier} (${repoDid})`);

	console.log('Fetching all posts...');
	const allRecords = await listAllPosts({ agent, repo: repoDid, collection: DEFAULT_COLLECTION });
	console.log(`Found ${allRecords.length} posts.`);

	// Group posts by UUID to find primary and chunk posts together
	const uuidGroups = new Map(); // uuid -> list of records
	const ungroupedRecords = [];

	for (const record of allRecords) {
		const uuid = getRecordUuid(record);
		if (uuid) {
			if (!uuidGroups.has(uuid)) {
				uuidGroups.set(uuid, []);
			}
			uuidGroups.get(uuid).push(record);
		} else {
			ungroupedRecords.push(record);
		}
	}

	console.log(`Grouped into ${uuidGroups.size} bundles. ${ungroupedRecords.length} ungrouped posts.`);

	const uuidsToDelete = new Set();
	const singleUrisToDelete = [];

	// 1. Process Grouped Bundles
	for (const [uuid, records] of uuidGroups.entries()) {
		// Find any record in the bundle that has an exact hash
		let exactHash = '';
		for (const rec of records) {
			const text = String(rec.value?.text || '');
			exactHash = extractExactHash(text) || extractExactHashFromAlt(rec);
			if (exactHash) break;
		}

		if (exactHash) {
			const gps = hashToGps(exactHash);
			if (gps) {
				// Sleep to respect Nominatim policy
				await sleep(1500);
				const isWater = await isLikelyWaterAddress(gps.lat, gps.lon);
				if (isWater) {
					console.log(`Bundle ${uuid} is located in water/ocean.`);
					uuidsToDelete.add(uuid);
				}
			}
		}
	}

	// 2. Process Ungrouped Posts
	for (const record of ungroupedRecords) {
		const text = String(record.value?.text || '');
		const exactHash = extractExactHash(text) || extractExactHashFromAlt(record);
		if (exactHash) {
			const gps = hashToGps(exactHash);
			if (gps) {
				await sleep(1500);
				const isWater = await isLikelyWaterAddress(gps.lat, gps.lon);
				if (isWater) {
					console.log(`Ungrouped post ${record.uri} is located in water/ocean.`);
					singleUrisToDelete.push(record.uri);
				}
			}
		}
	}

	// Collect all records to delete
	const recordsToDelete = [];
	for (const record of allRecords) {
		const uuid = getRecordUuid(record);
		if (uuid && uuidsToDelete.has(uuid)) {
			recordsToDelete.push(record);
		} else if (singleUrisToDelete.includes(record.uri)) {
			recordsToDelete.push(record);
		}
	}

	console.log(`Total records to delete: ${recordsToDelete.length}`);

	if (recordsToDelete.length === 0) {
		console.log('No water/ocean posts found. Complete.');
		return;
	}

	// Perform Deletions
	for (let i = 0; i < recordsToDelete.length; i++) {
		const record = recordsToDelete[i];
		console.log(`[${i + 1}/${recordsToDelete.length}] Deleting post: ${record.uri}...`);
		const res = await deleteRecord({ agent, repo: repoDid, record });
		if (res.ok) {
			console.log('Deleted successfully.');
		} else {
			console.error(`Failed to delete: ${res.error}`);
		}
		if (i < recordsToDelete.length - 1) {
			await sleep(2000);
		}
	}

	console.log('All water/ocean posts deleted successfully.');
}

main().catch(err => {
	console.error('Fatal error:', err.message);
});
