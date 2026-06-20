#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { AtpAgent } from '@atproto/api';

const BSKY_SERVICE = 'https://bsky.social';
const DEFAULT_COLLECTION = 'app.bsky.feed.post';
const DEFAULT_DELAY_MS = 2000;
const REGRESSION_PROFILE_SEEDS_PATH = './.regression-profile-seeds.json';

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

	const identifier = process.env.BSKY_USERNAME;
	const password = process.env.BSKY_PASSWORD;

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

// Parse Alt attribute JSON if it exists
function parseAltJson(record) {
	const images = record?.value?.embed?.images || [];
	for (const img of images) {
		const alt = String(img.alt || '').trim();
		if (alt.startsWith('{') || alt.startsWith('[')) {
			try {
				return JSON.parse(alt);
			} catch {}
		}
	}
	return null;
}

function getRecordUuid(record) {
	const parsed = parseAltJson(record);
	if (parsed) {
		return parsed.uuid || parsed.u || parsed.primary?.uuid;
	}
	return '';
}

// Check if a record is a profile
function isProfileRecord(record) {
	const value = record?.value || {};
	// 1. Check tags
	const tags = Array.isArray(value.tags) ? value.tags : [];
	if (tags.map(t => String(t || '').toLowerCase().trim()).includes('profile')) {
		return true;
	}
	// 2. Check alt JSON
	const parsed = parseAltJson(record);
	if (parsed) {
		const hasProfileKeys = (obj) => {
			if (!obj || typeof obj !== 'object') return false;
			return ('profileImage' in obj || obj.profileImage !== undefined || 'profilePic' in obj || obj.profilePic !== undefined);
		};
		if (hasProfileKeys(parsed) || hasProfileKeys(parsed.primary) || hasProfileKeys(parsed.combined?.primary)) {
			return true;
		}
		// Also check if tags in alt JSON contains profile
		const altTags = Array.isArray(parsed.tags) ? parsed.tags : (Array.isArray(parsed.primary?.tags) ? parsed.primary.tags : []);
		if (altTags.map(t => String(t || '').toLowerCase().trim()).includes('profile')) {
			return true;
		}
	}
	return false;
}

// Extract profile name/title from record
function getProfileName(record) {
	const value = record?.value || {};
	// Check alt JSON
	const parsed = parseAltJson(record);
	if (parsed) {
		const name = parsed.primary?.name || parsed.primary?.title || parsed.title || parsed.name || '';
		if (name) return name;
	}
	// Fallback to text
	return String(value.text || '').trim();
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

async function cleanLocalProfileSeeds(uuid) {
	const absolutePath = path.resolve(process.cwd(), REGRESSION_PROFILE_SEEDS_PATH);
	if (!fs.existsSync(absolutePath)) return;
	try {
		const raw = fs.readFileSync(absolutePath, 'utf8');
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			const next = parsed.filter((entry) => String(entry?.uuid || '').trim() !== uuid);
			if (next.length !== parsed.length) {
				fs.writeFileSync(absolutePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
				console.log(`Removed profile ${uuid} from local seeds.`);
			}
		}
	} catch (err) {
		console.warn(`Failed to clean local profile seeds for ${uuid}:`, err.message);
	}
}

async function cleanServerCache(uuid) {
	const serverUrl = process.env.TEST_SERVER_URL || 'http://localhost:5173';
	try {
		const res = await fetch(`${serverUrl}/api/cache?uuid=${encodeURIComponent(uuid)}`, {
			method: 'DELETE',
		});
		if (res.ok) {
			const data = await res.json();
			console.log(`Cleared server cache for ${uuid}:`, data.cleared);
		} else {
			console.log(`Server cache not cleared for ${uuid} (Status: ${res.status})`);
		}
	} catch (err) {
		// Server might not be running, which is fine
		console.log(`Could not reach server to clear cache for ${uuid}: ${err.message}`);
	}
}

async function main() {
	console.log('============================================================');
	console.log('Find and Delete Anonymous Profiles');
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

	// Check each bundle to see if it is a profile and is anonymous
	for (const [uuid, records] of uuidGroups.entries()) {
		let isProfile = false;
		let profileName = '';

		for (const rec of records) {
			if (isProfileRecord(rec)) {
				isProfile = true;
				profileName = getProfileName(rec);
				break;
			}
		}

		if (isProfile) {
			const lowerName = profileName.toLowerCase();
			if (!profileName || lowerName === 'anonymous') {
				console.log(`Found Anonymous Profile Bundle: UUID=${uuid}, Name="${profileName}"`);
				uuidsToDelete.add(uuid);
			} else {
				console.log(`Found Valid Profile Bundle: UUID=${uuid}, Name="${profileName}"`);
			}
		}
	}

	// Collect all records to delete
	const recordsToDelete = [];
	for (const record of allRecords) {
		const uuid = getRecordUuid(record);
		if (uuid && uuidsToDelete.has(uuid)) {
			recordsToDelete.push(record);
		}
	}

	console.log(`Total records to delete: ${recordsToDelete.length}`);

	if (recordsToDelete.length === 0) {
		console.log('No anonymous profiles found. Complete.');
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
			await sleep(DEFAULT_DELAY_MS);
		}
	}

	// Clean DB/cache and local seeds
	for (const uuid of uuidsToDelete) {
		await cleanLocalProfileSeeds(uuid);
		await cleanServerCache(uuid);
	}

	console.log('All anonymous profiles deleted successfully.');
}

main().catch(err => {
	console.error('Fatal error:', err.message);
});
