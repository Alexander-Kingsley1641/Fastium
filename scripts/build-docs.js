import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(root, '../docs');
const outputRoot = path.resolve(docsRoot, 'dist');
const renderMarkdown = (content) => {
    const body = content.split(/\r?\n/).map(line => {
        if (line.startsWith('# ')) {
            return `<h1>${line.slice(2)}</h1>`;
        }
        if (line.startsWith('## ')) {
            return `<h2>${line.slice(3)}</h2>`;
        }
        if (!line.trim()) {
            return '';
        }
        return `<p>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
    }).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Alexium Docs</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.6}</style></head><body>${body}</body></html>`;
};
const emit = async (sourcePath, targetPath) => {
    const content = await readFile(sourcePath, 'utf8');
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath.replace(/\.md$/, '.html'), renderMarkdown(content), 'utf8');
};
await mkdir(outputRoot, { recursive: true });
const queue = [docsRoot];
while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
            if (absolute.includes(`${path.sep}dist`)) {
                continue;
            }
            queue.push(absolute);
            continue;
        }
        if (entry.name.endsWith('.md')) {
            const target = path.join(outputRoot, path.relative(docsRoot, absolute));
            await emit(absolute, target);
        }
    }
}
await writeFile(path.join(outputRoot, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Alexium Docs</title></head><body><h1>Alexium Docs</h1><p>Built documentation is available as HTML files in this folder.</p></body></html>', 'utf8');
