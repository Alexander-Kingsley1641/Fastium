import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

declare const process: {
  cwd(): string;
};

const root = process.cwd();
const required = [
  'package.json',
  'tsconfig.base.json',
  path.join('src', 'index.ts'),
  path.join('src', 'cli', 'index.ts'),
  path.join('src', 'runtime', 'index.ts'),
  path.join('src', 'backend', 'index.ts'),
  path.join('src', 'frontend', 'index.ts'),
  path.join('src', 'discord', 'index.ts'),
  'fast.config.js',
  path.join('examples', 'main.fst')
];

for (const file of required) {
  await access(path.join(root, file));
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { name?: string };
console.log(JSON.stringify({ ok: true, package: packageJson.name ?? 'unknown' }, null, 2));
