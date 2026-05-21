#!/usr/bin/env node
import { runTests } from '../dist/src/testing/index.js';
import '../testing-lab/hmr-test.js';

const summary = await runTests();
if (summary.failed > 0) {
  process.exit(1);
}
