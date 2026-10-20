// Captures docs/screenshot.png from a running local server once the initial
// render has finished. Usage: npm start, then `node scripts/screenshot.mjs [url]`.
// Needs Google Chrome and Node 22+ (global WebSocket).
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const output = new URL('../docs/screenshot.png', import.meta.url);
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;
const profile = await mkdtemp(path.join(tmpdir(), 'spectracanvas-chrome-'));
const browser = spawn(chrome, [`--headless=new`, '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--window-size=1200,760', '--force-device-scale-factor=2', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const replies = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (replies.has(m.id)) { replies.get(m.id)(m.result); replies.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { replies.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url });
  // Poll the status line until the worker has rendered the first example.
  for (let i = 0; i < 100; i++) {
    const { result } = await send('Runtime.evaluate', { expression: `document.getElementById('result-badge')?.textContent` });
    if (result.value === 'Rendered') break;
    await sleep(200);
  }
  await sleep(300);
  // Crop to the header and editor; the footer text is for search engines, not the README.
  const { result: box } = await send('Runtime.evaluate', { expression: `JSON.stringify(document.querySelector('main').getBoundingClientRect())`, returnByValue: true });
  const { bottom } = JSON.parse(box.value);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: Math.ceil(bottom), scale: 1 } });
  await writeFile(output, Buffer.from(data, 'base64'));
  console.log(`Saved ${output.pathname}`);
} finally {
  ws.close(); browser.kill();
  // Chrome keeps writing to its profile until it has fully exited.
  await new Promise(r => browser.on('exit', r));
  await rm(profile, { recursive: true, force: true });
}
