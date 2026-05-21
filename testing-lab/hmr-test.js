import path from 'node:path';
import { test, expect } from '../dist/src/testing/index.js';
import { createBundler } from '../dist/src/bundler/index.js';
import { createGraph } from '../dist/src/graph/index.js';
import { encodeHmrBatch, decodeHmrPackets } from '../dist/src/hmr/packet.js';

const projectRoot = process.cwd();

const bundler = createBundler({ rootDir: projectRoot });

test('bundler.rebuildModule returns a valid HMR update packet', async () => {
  const packets = await bundler.rebuildModule('examples/main.fst');
  expect(packets.length).toBe(1);
  const packet = packets[0];
  expect(packet.type).toBe('update');
  expect(packet.moduleId).toBe('examples/main.fst');
  expect(typeof packet.payload?.code).toBe('string');
});

test('HMR packet encoder and decoder roundtrip', () => {
  const packet = { type: 'update', moduleId: 'examples/main.fst', payload: { code: 'console.log(1)' }, timestamp: Date.now() };
  const batch = encodeHmrBatch([packet]);
  const decoded = decodeHmrPackets(batch);
  expect(decoded.length).toBe(1);
  expect(decoded[0].moduleId).toBe(packet.moduleId);
  expect(decoded[0].payload.code).toBe(packet.payload.code);
});

test('module graph invalidation propagates dependents', () => {
  const graph = createGraph();
  graph.addModule('src/a.ts');
  graph.addModule('src/b.ts');
  graph.linkModule('src/a.ts', 'src/b.ts');
  graph.invalidate('src/b.ts');
  const dependents = graph.getDependents('src/b.ts');
  expect(dependents).toContain(path.resolve('src/a.ts'));
});
