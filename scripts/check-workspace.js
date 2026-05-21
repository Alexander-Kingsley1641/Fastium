import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const required = [
    'package.json',
    'tsconfig.base.json',
    path.join('packages', 'core', 'package.json'),
    path.join('packages', 'websocket', 'package.json'),
    path.join('packages', 'backend', 'src', 'index.ts'),
    path.join('packages', 'frontend', 'src', 'index.ts')
];
for (const file of required) {
    await access(path.join(root, file));
}
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
console.log(JSON.stringify({ ok: true, workspaces: packageJson.workspaces ?? [] }, null, 2));
