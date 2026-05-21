#!/usr/bin/env node
'use strict';

const candidates = [
	'../dist/src/cli/index.js',
	'../src/cli/index.js'
];

for (const candidate of candidates) {
	try {
		const module = await import(candidate);
		if (typeof module.runCli === 'function') {
			await module.runCli();
			break;
		}
	} catch {
		continue;
	}
}
