#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { AtpAgent } from '@atproto/api';

const BSKY_SERVICE = 'https://bsky.social';
const DEFAULT_COLLECTION = 'app.bsky.feed.post';
const DEFAULT_LIMIT = 100;
const DEFAULT_DELAY_MS = 2_000;

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
		execute: false,
		limit: DEFAULT_LIMIT,
		delayMs: DEFAULT_DELAY_MS,
		collection: DEFAULT_COLLECTION,
		uris: [],
	};

	for (const token of argv) {
		if (token === '--execute') {
			args.execute = true;
			continue;
		}

		const m = token.match(/^--([^=]+)=(.*)$/);
		if (!m) continue;
		const key = m[1];
		const value = m[2];
		if (key === 'limit') {
			args.limit = Math.max(1, Math.min(100, Number(value) || DEFAULT_LIMIT));
			continue;
		}
		if (key === 'delay-ms') {
			args.delayMs = Math.max(500, Number(value) || DEFAULT_DELAY_MS);
			continue;
		}
		if (key === 'collection') {
			args.collection = String(value || DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION;
			continue;
		}
		if (key === 'uri' || key === 'uris') {
			const parsed = String(value || '')
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean);
			args.uris.push(...parsed);
			continue;
		}
	}

	args.uris = [...new Set(args.uris)];
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

function extractAltCandidates(alt = '') {
	const source = String(alt || '').trim();
	if (!source) return [];
	try {
		const parsed = JSON.parse(source);
		const candidates = [parsed, parsed?.primary, parsed?.combined?.primary];
		if (typeof parsed?.h === 'string' && parsed.h.trim()) {
			try {
				const inner = JSON.parse(parsed.h);
				candidates.push(inner, inner?.primary, inner?.combined?.primary);
			} catch {
				// Ignore malformed nested payload.
			}
		}
		return candidates.filter((entry) => entry && typeof entry === 'object');
	} catch {
		return [];
	}
}

function findInvalidAuthorPayload(record = {}) {
	const images = Array.isArray(record?.value?.embed?.images) ? record.value.embed.images : [];
	for (const image of images) {
		const alt = String(image?.alt || '').trim();
		if (!alt) continue;
		for (const candidate of extractAltCandidates(alt)) {
			const type = String(candidate?.type || '').trim().toLowerCase();
			const uuid = String(candidate?.uuid || candidate?.u || '').trim();
			const authorid = String(candidate?.authorid || candidate?.authorId || '').trim();
			if (type !== 'post') continue;
			if (!uuid || !authorid) continue;
			if (uuid === authorid) {
				return {
					uuid,
					authorid,
					type,
				};
			}
		}
	}
	return null;
}

function parseRkeyFromUri(uri = '') {
	const source = String(uri || '').trim();
	if (!source) return '';
	const parts = source.split('/').filter(Boolean);
	return parts.length ? parts[parts.length - 1] : '';
}

async function deleteRecordWithBackoff({ agent, repo, collection, uri }) {
	const rkey = parseRkeyFromUri(uri);
	if (!rkey) return { ok: false, error: `Unable to parse rkey from URI: ${uri}` };

	let attempt = 0;
	let delayMs = 2_000;
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
			await sleep(delayMs + randomInt(0, 1_500));
			delayMs = Math.min(30_000, Math.round(delayMs * 1.8));
		}
	}

	return { ok: false, error: 'Max retries exceeded' };
}

function selectRecords({ records, targetUris }) {
	const uriSet = new Set(targetUris.map((uri) => String(uri || '').trim()).filter(Boolean));
	const candidates = [];

	for (const record of records) {
		const uri = String(record?.uri || '').trim();
		if (!uri) continue;

		if (uriSet.size > 0 && !uriSet.has(uri)) {
			continue;
		}

		const invalid = findInvalidAuthorPayload(record);
		if (!invalid) continue;

		candidates.push({
			uri,
			invalid,
			textPreview: String(record?.value?.text || '').trim().slice(0, 90),
		});
	}

	return candidates;
}

async function main() {
	const args = parseArgs();
	const startedAt = Date.now();

	console.log('============================================================');
	console.log('Delete Invalid AuthorId Posts (type=post, authorid===uuid)');
	console.log('============================================================');
	console.log(`  Service    : ${BSKY_SERVICE}`);
	console.log(`  Collection : ${args.collection}`);
	console.log(`  Limit/page : ${args.limit}`);
	console.log(`  Delay      : ~${args.delayMs}ms between deletes`);
	console.log(`  URI filter : ${args.uris.length ? args.uris.length : 'none (scan all posts)'}`);
	console.log(`  Mode       : ${args.execute ? 'LIVE DELETE (--execute)' : 'DRY RUN (default)'}`);
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

	const targets = selectRecords({ records: allRecords, targetUris: args.uris });

	console.log(`Total posts found : ${allRecords.length}`);
	console.log(`Invalid targets   : ${targets.length}`);
	console.log('');

	if (targets.length === 0) {
		console.log('No matching invalid posts found.');
		return;
	}

	for (let i = 0; i < targets.length; i += 1) {
		const target = targets[i];
		const label = `[${i + 1}/${targets.length}]`;
		console.log(`${label} ${target.uri}`);
		console.log(`           type=${target.invalid.type} uuid=${target.invalid.uuid} authorid=${target.invalid.authorid}`);
		if (target.textPreview) {
			console.log(`           text=${JSON.stringify(target.textPreview)}`);
		}
	}
	console.log('');

	if (!args.execute) {
		console.log('Dry run complete. Re-run with --execute to delete these records.');
		return;
	}

	let deleted = 0;
	let failed = 0;
	for (let i = 0; i < targets.length; i += 1) {
		const target = targets[i];
		const label = `[${i + 1}/${targets.length}]`;
		console.log(`${label} deleting ${target.uri}`);
		const result = await deleteRecordWithBackoff({
			agent,
			repo: repoDid,
			collection: args.collection,
			uri: target.uri,
		});
		if (result.ok) {
			deleted += 1;
			console.log('           deleted');
		} else {
			failed += 1;
			console.error(`           failed: ${result.error}`);
		}

		const isLast = i === targets.length - 1;
		if (!isLast) {
			const waitMs = Math.max(500, args.delayMs + randomInt(-500, 500));
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
