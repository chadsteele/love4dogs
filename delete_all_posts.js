#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { AtpAgent } from '@atproto/api';

const BSKY_SERVICE = 'https://bsky.social';
const DEFAULT_COLLECTION = 'app.bsky.feed.post';
const DEFAULT_KEEP_MARKER = '🎞️';
const DEFAULT_DELAY_MS = 20_000;
const DEFAULT_LIMIT = 100;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
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

function parseArgs(argv = process.argv.slice(2)) {
	const args = {
		dryRun: false,
		marker: DEFAULT_KEEP_MARKER,
		delayMs: DEFAULT_DELAY_MS,
		limit: DEFAULT_LIMIT,
		collection: DEFAULT_COLLECTION,
	};

	for (const token of argv) {
		if (token === '--dry-run') {
			args.dryRun = true;
			continue;
		}
		const m = token.match(/^--([^=]+)=(.*)$/);
		if (!m) continue;
		const key = m[1];
		const value = m[2];
		if (key === 'marker') args.marker = value;
		if (key === 'delay-ms') args.delayMs = Math.max(1_000, Number(value) || DEFAULT_DELAY_MS);
		if (key === 'limit') args.limit = Math.max(1, Math.min(100, Number(value) || DEFAULT_LIMIT));
		if (key === 'collection') args.collection = String(value || DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION;
	}

	return args;
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

function getTextFromRecord(record = {}) {
	return String(record?.value?.text || '').trim();
}

function hasKeepMarker(record = {}, marker = DEFAULT_KEEP_MARKER) {
	const text = getTextFromRecord(record);
	return text.includes(marker);
}

async function listAllPosts({ agent, repo, collection, limit }) {
	const records = [];
	let cursor = undefined;

	while (true) {
		const response = await agent.com.atproto.repo.listRecords({
			repo,
			collection,
			limit,
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

async function deleteRecordWithBackoff({ agent, repo, record, collection }) {
	const uri = String(record?.uri || '').trim();
	if (!uri) return { ok: false, error: 'Missing record URI' };

	const rkey = uri.split('/').pop();
	if (!rkey) return { ok: false, error: `Unable to parse rkey from URI: ${uri}` };

	let attempt = 0;
	let delayMs = 5_000;
	while (attempt < 5) {
		attempt += 1;
		try {
			await agent.com.atproto.repo.deleteRecord({
				repo,
				collection,
				rkey,
			});
			return { ok: true };
		} catch (error) {
			const message = String(error?.message || error || 'delete failed');
			const throttled = /429|rate|throttl|too many/i.test(message);
			if (!throttled || attempt >= 5) {
				return { ok: false, error: message };
			}
			await sleep(delayMs + randomInt(0, 2_500));
			delayMs = Math.min(60_000, Math.round(delayMs * 1.8));
		}
	}

	return { ok: false, error: 'Max retries exceeded' };
}

function summarizeTarget(record, marker) {
	const text = getTextFromRecord(record);
	const preview = text.length > 80 ? `${text.slice(0, 77)}...` : text;
	const reason = text.includes(marker) ? 'contains keep marker' : 'missing keep marker';
	return { preview, reason };
}

async function main() {
	const args = parseArgs();
	const startedAt = Date.now();

	console.log('============================================================');
	console.log('Delete Bluesky Posts Without Keep Marker');
	console.log('============================================================');
	console.log(`  Service    : ${BSKY_SERVICE}`);
	console.log(`  Collection : ${args.collection}`);
	console.log(`  Keep marker: ${JSON.stringify(args.marker)}`);
	console.log(`  Delay      : ~${args.delayMs}ms between deletes`);
	console.log(`  Mode       : ${args.dryRun ? 'DRY RUN (no delete)' : 'LIVE DELETE'}`);
	console.log('');

	const { agent, identifier } = await createAgentSession();
	const repoDid = String(agent?.session?.did || '').trim();
	if (!repoDid) throw new Error('Authenticated session missing DID.');

	console.log(`Authenticated as: ${identifier} (${repoDid})`);
	console.log('Loading posts...');

	const allRecords = await listAllPosts({
		agent,
		repo: repoDid,
		collection: args.collection,
		limit: args.limit,
	});

	const targets = allRecords.filter((record) => !hasKeepMarker(record, args.marker));
	const keepers = allRecords.length - targets.length;

	console.log(`Total posts found : ${allRecords.length}`);
	console.log(`Will keep         : ${keepers}`);
	console.log(`Will delete       : ${targets.length}`);
	console.log('');

	if (targets.length === 0) {
		console.log('Nothing to delete.');
		return;
	}

	let deleted = 0;
	let failed = 0;
	for (let i = 0; i < targets.length; i += 1) {
		const record = targets[i];
		const uri = String(record?.uri || '').trim();
		const { preview, reason } = summarizeTarget(record, args.marker);
		const label = `[${i + 1}/${targets.length}]`;

		if (args.dryRun) {
			console.log(`${label} DRY-RUN would delete ${uri}`);
			console.log(`           reason: ${reason}`);
			console.log(`           text  : ${JSON.stringify(preview)}`);
			continue;
		}

		console.log(`${label} deleting ${uri}`);
		const result = await deleteRecordWithBackoff({
			agent,
			repo: repoDid,
			record,
			collection: args.collection,
		});

		if (result.ok) {
			deleted += 1;
			console.log(`           deleted`);
		} else {
			failed += 1;
			console.error(`           failed: ${result.error}`);
		}

		const isLast = i === targets.length - 1;
		if (!isLast) {
			const jitter = randomInt(-3_000, 3_000);
			const waitMs = Math.max(2_000, args.delayMs + jitter);
			console.log(`           waiting ${waitMs}ms before next delete...`);
			await sleep(waitMs);
		}
	}

	const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
	console.log('');
	console.log('============================================================');
	console.log('Done');
	console.log('============================================================');
	console.log(`Deleted : ${deleted}`);
	console.log(`Failed  : ${failed}`);
	console.log(`Elapsed : ${elapsedSec}s`);
}

main().catch((error) => {
	console.error('Fatal:', error?.message || error);
	process.exitCode = 1;
});
