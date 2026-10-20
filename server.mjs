import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const requested = decodeURIComponent(url.pathname);
    const filename = path.resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
    const resolved = await realpath(filename);
    if (!resolved.startsWith(root) || path.relative(root, resolved).split(path.sep).some(p => p.startsWith('.')) || !['/index.html', '/styles.css', '/favicon.svg'].includes(requested) && requested !== '/' && !requested.startsWith('/src/')) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const data = await readFile(resolved);
    res.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`SpectraCanvas · http://127.0.0.1:${port}`));
