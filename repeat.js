#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function printUsageAndExit() {
	console.error('Usage: node repeat.js [count] <node-command-args...>');
	console.error('Example: node repeat.js 3 regression-test-posts.mjs --test');
	process.exit(1);
}

function isPositiveInteger(value) {
	return /^[0-9]+$/.test(String(value)) && Number(value) > 0;
}

function runRepeatedNodeCommand(count, nodeArgs) {
	for (let i = 0; i < count; i += 1) {
		const result = spawnSync(process.execPath, nodeArgs, {
			stdio: 'inherit',
			env: process.env,
		});

		if (result.error) {
			console.error(`Run ${i + 1}/${count} failed: ${result.error.message}`);
			process.exit(1);
		}

		if (typeof result.status === 'number' && result.status !== 0) {
			process.exit(result.status);
		}
	}
}

const argv = process.argv.slice(2);

if (argv[0] === '--runner') {
	const count = Number(argv[1]);
	const nodeArgs = argv.slice(2);

	if (!Number.isInteger(count) || count < 1 || nodeArgs.length === 0) {
		printUsageAndExit();
	}

	runRepeatedNodeCommand(count, nodeArgs);
	process.exit(0);
}

if (argv.length === 0) {
	printUsageAndExit();
}

let repeatCount = 1;
let commandStartIndex = 0;

if (isPositiveInteger(argv[0])) {
	repeatCount = Number(argv[0]);
	commandStartIndex = 1;
}

const nodeCommandArgs = argv.slice(commandStartIndex);
if (nodeCommandArgs.length === 0) {
	printUsageAndExit();
}

const scriptPath = fileURLToPath(import.meta.url);
const child = spawn(
	process.execPath,
	[scriptPath, '--runner', String(repeatCount), ...nodeCommandArgs],
	{
		detached: true,
		stdio: 'ignore',
		env: process.env,
	}
);

child.unref();
console.log(`Started background runner (pid: ${child.pid}) with count ${repeatCount}.`);