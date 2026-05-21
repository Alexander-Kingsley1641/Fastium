import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(root, '../docs');
const renderMarkdown = (content) => {
    const html = ['<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Alexium Docs</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.6}</style></head><body>'];
    for (const line of content.split(/\r?\n/)) {
        if (line.startsWith('# ')) {
            html.push(`<h1>${line.slice(2)}</h1>`);
            continue;
        }
        if (line.startsWith('## ')) {
            html.push(`<h2>${line.slice(3)}</h2>`);
            continue;
        }
        if (line.trim()) {
            html.push(`<p>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`);
        }
    }
    html.push('</body></html>');
    return html.join('');
};
const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const targetPath = requestUrl.pathname === '/' ? '/index.md' : requestUrl.pathname;
    const filePath = path.join(docsRoot, targetPath);
    try {
        const content = await readFile(filePath, 'utf8');
        if (filePath.endsWith('.md')) {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(renderMarkdown(content));
            return;
        }
        response.end(content);
    }
    catch {
        response.statusCode = 404;
        response.end('Not found');
    }
});
server.listen(4173, '127.0.0.1', () => {
    console.log('Alexium docs available at http://127.0.0.1:4173');
});
