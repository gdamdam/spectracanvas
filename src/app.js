import { WIDTH as W, HEIGHT as H, SAMPLE_RATE, encodeWav, frequencyAtRow, validateSettings } from './dsp.js';
import { serializeProject, parseProject, imageToPixels } from './project.js';

const $ = id => document.getElementById(id);
const canvas = $('drawing'), drawContext = canvas.getContext('2d');
const resultContext = $('result').getContext('2d'), waveContext = $('waveform').getContext('2d');
const STORE = 'spectracanvas.project.v1';
let pixels = new Uint8ClampedArray(W * H);
let revision = 0, cached = null, pending = null, audio = null, gain = null, source = null;
let playbackStarted = 0, animation = 0, tool = 'draw', drawing = false, previous = null, strokeBefore = null;
let keyboardPoint = { x: W / 2, y: H / 2 }, saveTimer = 0;
const undoStack = [], redoStack = [];
const settings = () => ({ duration: +$('duration').value, low: +$('low').value, high: +$('high').value });
const formatHz = f => f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : `${Math.round(f)}`;
const formatTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const message = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const aborted = () => new DOMException('Rendering cancelled', 'AbortError');

function snapshot() { return { pixels: pixels.slice(), settings: settings() }; }
function remember(before = snapshot()) { undoStack.push(before); if (undoStack.length > 30) undoStack.shift(); redoStack.length = 0; historyButtons(); }
function historyButtons() { $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length; }
function restoreSnapshot(value) {
  pixels = value.pixels.slice();
  for (const [key, setting] of Object.entries(value.settings)) $(key).value = setting;
  invalidate(); updateLabels(); draw(); scheduleSave();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restoreSnapshot(undoStack.pop()); historyButtons(); message('Undone.'); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restoreSnapshot(redoStack.pop()); historyButtons(); message('Redone.'); }

function updateLabels() {
  $('brush-value').value = `${$('brush').value} px`;
  $('strength-value').value = `${$('strength').value}%`;
  $('duration-value').value = `${(+$('duration').value).toFixed(1)} s`;
  $('volume-value').value = `${$('volume').value}%`;
  $('total-time').textContent = formatTime(settings().duration);
  const { low, high, duration } = settings();
  for (const id of ['draw-axis', 'result-axis']) {
    $(id).replaceChildren(...Array.from({ length: 5 }, (_, i) => {
      const span = document.createElement('span'); span.style.top = `${i * 25}%`;
      span.textContent = formatHz(frequencyAtRow(i, 5, low, high)); return span;
    }));
  }
  for (const id of ['draw-times', 'result-times']) $(id).replaceChildren(...Array.from({ length: 5 }, (_, i) => {
    const span = document.createElement('span'); span.textContent = `${+(duration * i / 4).toFixed(2)}s`; return span;
  }));
}

function draw() {
  const image = drawContext.createImageData(W, H);
  for (let i = 0; i < pixels.length; i++) {
    const a = pixels[i] / 255, j = i * 4;
    image.data[j] = 7 + 219 * a; image.data[j + 1] = 10 + 230 * a; image.data[j + 2] = 12 + 221 * a; image.data[j + 3] = 255;
  }
  drawContext.putImageData(image, 0, 0);
}

function paintPoint(x, y, radius, strength, erase = false) {
  for (let yy = Math.max(0, Math.floor(y - radius)); yy <= Math.min(H - 1, Math.ceil(y + radius)); yy++) {
    for (let xx = Math.max(0, Math.floor(x - radius)); xx <= Math.min(W - 1, Math.ceil(x + radius)); xx++) {
      const distance = Math.hypot(xx - x, yy - y), amount = Math.max(0, 1 - distance / (radius + 0.5));
      const index = yy * W + xx;
      pixels[index] = erase ? pixels[index] * (1 - amount) : Math.max(pixels[index], amount * strength);
    }
  }
}
function stroke(a, b, radius, strength, erase = false) {
  const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  for (let i = 0; i <= count; i++) paintPoint(a.x + (b.x - a.x) * i / count, a.y + (b.y - a.y) * i / count, radius, strength, erase);
}
function fromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(W - 1, (e.clientX - rect.left) / rect.width * (W - 1))), y: Math.max(0, Math.min(H - 1, (e.clientY - rect.top) / rect.height * (H - 1))) };
}
function cursor(point) {
  const rect = canvas.getBoundingClientRect(), r = +$('brush').value;
  $('brush-cursor').hidden = false;
  Object.assign($('brush-cursor').style, { left: `${point.x / (W - 1) * 100}%`, top: `${point.y / (H - 1) * 100}%`, width: `${(r * 2 + 1) / W * rect.width}px`, height: `${(r * 2 + 1) / H * rect.height}px` });
  const { duration, low, high } = settings();
  $('coordinate').textContent = `${(point.x / (W - 1) * duration).toFixed(2)} s · ${Math.round(frequencyAtRow(point.y, H, low, high))} Hz`;
}
function setTool(next) {
  tool = next;
  $('draw-tool').classList.toggle('active', next === 'draw'); $('draw-tool').setAttribute('aria-pressed', next === 'draw');
  $('erase-tool').classList.toggle('active', next === 'erase'); $('erase-tool').setAttribute('aria-pressed', next === 'erase');
}
function paintEvent(e) {
  const point = fromEvent(e), pressure = e.pointerType === 'pen' ? Math.max(0.1, e.pressure) : 1;
  stroke(previous || point, point, +$('brush').value, +$('strength').value * 2.55 * pressure, tool === 'erase');
  previous = point; keyboardPoint = point; cursor(point); draw();
}
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  canvas.focus({ preventScroll: true }); drawing = true; previous = null; strokeBefore = snapshot(); invalidate();
  canvas.setPointerCapture(e.pointerId); paintEvent(e);
});
canvas.addEventListener('pointermove', e => { if (drawing) paintEvent(e); else cursor(fromEvent(e)); });
function finishStroke() {
  if (!drawing) return; drawing = false; previous = null;
  if (strokeBefore && pixels.some((v, i) => v !== strokeBefore.pixels[i])) remember(strokeBefore);
  strokeBefore = null; scheduleSave(); message('Drawing changed.');
}
canvas.addEventListener('pointerup', finishStroke); canvas.addEventListener('pointercancel', finishStroke); canvas.addEventListener('lostpointercapture', finishStroke);
canvas.addEventListener('pointerleave', () => { if (!drawing) $('brush-cursor').hidden = true; });
canvas.addEventListener('blur', () => { $('brush-cursor').hidden = true; });
canvas.addEventListener('keydown', e => {
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (!moves[e.key]) return;
  e.preventDefault(); const [dx, dy] = moves[e.key], before = { ...keyboardPoint };
  keyboardPoint = { x: Math.max(0, Math.min(W - 1, before.x + dx * 2)), y: Math.max(0, Math.min(H - 1, before.y + dy * 2)) };
  if (e.shiftKey) { remember(); invalidate(); stroke(before, keyboardPoint, +$('brush').value, +$('strength').value * 2.55, tool === 'erase'); draw(); scheduleSave(); }
  cursor(keyboardPoint);
});

function example(name, record = true) {
  if (record) remember(); invalidate(); pixels.fill(0);
  const line = (x0, y0, x1, y1, r = 1.2, amp = 230) => stroke({ x: x0 * (W - 1), y: y0 * (H - 1) }, { x: x1 * (W - 1), y: y1 * (H - 1) }, r, amp);
  if (name === 'spiral') {
    // Three turns growing out from the centre, getting louder as they widen.
    // The canvas is wider than tall, so the x radius is kept smaller to look round on screen.
    const turns = 3, n = 480, rx = .30, ry = .42;
    const at = i => { const t = i / n, a = t * turns * 2 * Math.PI; return [.5 + rx * t * Math.cos(a), .5 + ry * t * Math.sin(a)]; };
    for (let i = 1; i <= n; i++) line(...at(i - 1), ...at(i), 1.2, 110 + 130 * i / n);
  } else if (name === 'glide') {
    for (let x = 1; x < W; x++) for (let k = 0; k < 3; k++) {
      const a = (x - 1) / (W - 1), b = x / (W - 1), fn = t => .48 + .22 * Math.sin(t * Math.PI * 2 + k * .7);
      line(a, fn(a) + k * .07, b, fn(b) + k * .07, .8, 230 - k * 40);
    }
  } else if (name === 'chord') {
    const { low, high } = settings();
    for (const f of [261.63, 329.63, 392]) for (let h = 1; h <= 4; h++) {
      const y = 1 - Math.log(f * h / low) / Math.log(high / low);
      if (y >= 0 && y <= 1) line(.08 + h * .01, y, .90 - h * .01, y, .65, 245 / h);
    }
  }
  draw(); scheduleSave(); message('Example loaded.');
}

function cancelRender() {
  if (!pending) return;
  const current = pending; pending = null; current.worker.terminate(); current.reject(aborted());
  $('render-progress').hidden = true; $('play-label').textContent = 'Play'; $('export').disabled = false; $('render').disabled = false;
}
function invalidate() {
  revision++; cancelRender(); stop(); cached = null;
  $('result-badge').textContent = 'Out of date'; $('result-badge').classList.remove('current');
  $('result').parentElement.classList.add('stale');
  $('waveform').style.opacity = '.25';
}
const colors = [[0, [7,10,12]], [.16,[24,30,65]], [.40,[93,54,126]], [.65,[185,79,106]], [.83,[233,148,99]], [1,[255,235,167]]];
function heat(value) {
  for (let i = 1; i < colors.length; i++) if (value <= colors[i][0]) {
    const [a, ca] = colors[i - 1], [b, cb] = colors[i], t = (value - a) / (b - a);
    return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
  }
  return colors.at(-1)[1];
}
const palette = Array.from({ length: 256 }, (_, i) => heat(i / 255));
function showResult({ spectrum, samples }) {
  const image = resultContext.createImageData(W, H);
  for (let i = 0; i < spectrum.length; i++) { image.data.set(palette[spectrum[i]], i * 4); image.data[i * 4 + 3] = 255; }
  resultContext.putImageData(image, 0, 0);
  $('result-empty').hidden = true; $('result').parentElement.classList.remove('stale');
  $('result-badge').textContent = 'Rendered'; $('result-badge').classList.add('current');
  drawWaveform(samples);
  $('waveform').style.opacity = '.8';
}
function drawWaveform(samples) {
  const w = $('waveform').width, h = $('waveform').height;
  waveContext.clearRect(0, 0, w, h); waveContext.strokeStyle = '#a1dab4'; waveContext.lineWidth = 1;
  waveContext.beginPath();
  for (let x = 0; x < w; x++) {
    let low = 0, high = 0;
    for (let i = Math.floor(x / w * samples.length); i < Math.floor((x + 1) / w * samples.length); i++) { low = Math.min(low, samples[i]); high = Math.max(high, samples[i]); }
    waveContext.moveTo(x + .5, h / 2 + low * h * .47); waveContext.lineTo(x + .5, h / 2 + high * h * .47 + .2);
  }
  waveContext.stroke();
}
function renderSound() {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending.promise;
  try { validateSettings(settings()); } catch (e) { return Promise.reject(e); }
  if (!pixels.some(v => v > 0)) return Promise.reject(new Error('The canvas is empty. Paint a line or choose an example.'));
  const worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
  const id = revision;
  let resolveJob, rejectJob;
  const promise = new Promise((resolve, reject) => { resolveJob = resolve; rejectJob = reject; });
  pending = { worker, promise, reject: rejectJob, id };
  $('play-label').textContent = 'Cancel render'; $('export').disabled = true; $('render').disabled = true;
  $('render-progress').hidden = false; $('render-progress').value = 0;
  message('Rendering sound…');
  const finish = () => { if (pending?.id === id) pending = null; worker.terminate(); $('render-progress').hidden = true; $('play-label').textContent = 'Play'; $('export').disabled = false; $('render').disabled = false; };
  worker.onmessage = ({ data }) => {
    if (data.id !== revision) return;
    if (data.type === 'progress') { $('render-progress').value = data.value; return; }
    finish();
    if (data.type === 'error') { rejectJob(new Error(data.message)); return; }
    cached = { samples: data.samples, spectrum: data.spectrum, settings: settings() };
    showResult(cached); message('Ready.'); resolveJob(cached);
  };
  worker.onerror = () => { finish(); rejectJob(new Error('Audio rendering failed. Reload the page and try again.')); };
  worker.postMessage({ id, pixels: pixels.slice(), width: W, height: H, ...settings() });
  return promise;
}
function report(e) { if (e.name !== 'AbortError') message(e.message || 'Something went wrong.', true); }

function stop(reset = true) {
  if (source) { const old = source; source = null; old.onended = null; old.stop(); old.disconnect(); }
  cancelAnimationFrame(animation); $('play').classList.remove('is-playing');
  if (!pending) $('play-label').textContent = 'Play';
  $('draw-head').hidden = true; $('result-head').hidden = true;
  if (reset) $('position').textContent = '0:00.0';
}
function animate() {
  if (!source) return;
  const duration = cached.settings.duration, time = Math.max(0, Math.min(duration, audio.currentTime - playbackStarted));
  $('position').textContent = formatTime(time);
  for (const id of ['draw-head', 'result-head']) { $(id).hidden = false; $(id).style.left = `${time / duration * 100}%`; }
  animation = requestAnimationFrame(animate);
}
async function togglePlay() {
  if (pending) { cancelRender(); message('Rendering cancelled.'); return; }
  if (source) { stop(); message('Stopped.'); return; }
  try {
    if (!audio) { audio = new AudioContext(); gain = audio.createGain(); gain.connect(audio.destination); }
    const myRevision = revision;
    await audio.resume();
    if (audio.state !== 'running') throw new Error('Audio could not start. Try pressing Play again.');
    const result = await renderSound();
    if (myRevision !== revision || document.hidden) return;
    // A second click while AudioContext was resuming must not start two voices.
    if (source) return;
    const buffer = audio.createBuffer(1, result.samples.length, SAMPLE_RATE); buffer.copyToChannel(result.samples, 0);
    gain.gain.value = +$('volume').value / 100;
    source = audio.createBufferSource(); source.buffer = buffer; source.connect(gain);
    source.onended = () => { stop(false); $('position').textContent = formatTime(result.settings.duration); message('Finished.'); };
    playbackStarted = audio.currentTime; source.start(); $('play').classList.add('is-playing'); $('play-label').textContent = 'Stop';
    message('Playing.'); animate();
  } catch (e) { report(e); }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function filename(extension) { return `spectracanvas-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${extension}`; }
async function exportWav() {
  try { const result = await renderSound(); download(new Blob([encodeWav(result.samples)], { type: 'audio/wav' }), filename('wav')); message('WAV exported · 44.1 kHz, 16-bit mono.'); }
  catch (e) { report(e); }
}
function saveImage() {
  const output = document.createElement('canvas'); output.width = W; output.height = H; const c = output.getContext('2d'), image = c.createImageData(W, H);
  for (let i = 0; i < pixels.length; i++) { const j = i * 4; image.data[j] = image.data[j + 1] = image.data[j + 2] = pixels[i]; image.data[j + 3] = 255; }
  c.putImageData(image, 0, 0); output.toBlob(blob => { if (blob) { download(blob, filename('png')); message('Drawing saved as PNG.'); } }, 'image/png');
}

async function importImage(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { message('Choose an image smaller than 20 MB.', true); return; }
  let bitmap, imageUrl;
  try {
    // Image decoding also accepts SVG in browsers where createImageBitmap
    // supports only raster formats. Blob URLs keep the input on this device.
    const imageFile = /\.svg$/i.test(file.name) ? new Blob([file], { type: 'image/svg+xml' }) : file;
    imageUrl = URL.createObjectURL(imageFile);
    bitmap = new Image(); bitmap.src = imageUrl; await bitmap.decode();
    const offscreen = document.createElement('canvas'); offscreen.width = W; offscreen.height = H; const c = offscreen.getContext('2d');
    const scale = Math.min(W / bitmap.width, H / bitmap.height), w = bitmap.width * scale, h = bitmap.height * scale;
    c.drawImage(bitmap, (W - w) / 2, (H - h) / 2, w, h);
    const data = c.getImageData(0, 0, W, H).data;
    const imported = imageToPixels(data, { width: W, height: H, fit: { x: (W - w) / 2, y: (H - h) / 2, w, h } });
    remember(); invalidate();
    pixels = imported.pixels;
    draw(); scheduleSave(); message(imported.inverted ? 'Image imported. White background inverted into silence.' : 'Image imported. Light pixels become sound.');
  } catch (error) { message(`Could not open that image: ${error.message || 'unsupported format'}. Try a PNG, JPEG, or WebP.`, true); }
  finally { if (imageUrl) URL.revokeObjectURL(imageUrl); $('image-file').value = ''; }
}

function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 350); }
function save() {
  try {
    localStorage.setItem(STORE, serializeProject({ pixels, settings: settings(), brush: +$('brush').value, strength: +$('strength').value }));
    $('save-status').textContent = 'Saved locally';
  } catch { $('save-status').textContent = 'Autosave unavailable'; }
}
function load() {
  try {
    const saved = parseProject(localStorage.getItem(STORE));
    if (!saved) return false;
    // A select rejects values that are not among its options; treat that as no project.
    for (const [key, value] of Object.entries(saved.settings)) { $(key).value = value; if ($(key).value === '') return false; }
    pixels = saved.pixels;
    if (saved.brush !== null) $('brush').value = saved.brush;
    if (saved.strength !== null) $('strength').value = saved.strength;
    $('save-status').textContent = 'Restored locally'; return true;
  } catch { return false; }
}

$('draw-tool').addEventListener('click', () => setTool('draw')); $('erase-tool').addEventListener('click', () => setTool('erase'));
$('undo').addEventListener('click', undo); $('redo').addEventListener('click', redo);
$('clear').addEventListener('click', () => { remember(); invalidate(); pixels.fill(0); draw(); scheduleSave(); message('Canvas cleared.'); });
$('play').addEventListener('click', togglePlay); $('export').addEventListener('click', exportWav); $('save-image').addEventListener('click', saveImage);
$('render').addEventListener('click', () => renderSound().catch(report));
$('import').addEventListener('click', () => $('image-file').click()); $('image-file').addEventListener('change', e => importImage(e.target.files[0]));
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => example(button.dataset.example)));
$('help-toggle').addEventListener('click', () => { $('help').hidden = !$('help').hidden; $('help-toggle').setAttribute('aria-expanded', !$('help').hidden); });
for (const id of ['brush', 'strength']) $(id).addEventListener('input', () => { updateLabels(); scheduleSave(); });
let settingsBefore = null;
for (const id of ['duration', 'low', 'high']) {
  $(id).addEventListener('focus', () => { settingsBefore = snapshot(); });
  $(id).addEventListener('pointerdown', () => { settingsBefore = snapshot(); });
  $(id).addEventListener('input', () => { invalidate(); updateLabels(); });
  $(id).addEventListener('change', () => { if (settingsBefore) remember(settingsBefore); settingsBefore = snapshot(); scheduleSave(); message('Settings changed.'); });
}
$('volume').addEventListener('input', () => { updateLabels(); if (gain) gain.gain.setTargetAtTime(+$('volume').value / 100, audio.currentTime, .02); });
const dropzone = $('drawing-plot');
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('drag-over'); importImage(e.dataTransfer.files[0]); });
document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea') || e.target.isContentEditable) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' && !e.target.closest('button,a') && !e.repeat) { e.preventDefault(); togglePlay(); }
  if (e.key.toLowerCase() === 'b') setTool('draw'); if (e.key.toLowerCase() === 'e') setTool('erase');
  if (e.key === 'Escape') { cancelRender(); stop(); message('Stopped.'); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && source) { stop(); message('Playback paused while the tab is hidden.'); } });
window.addEventListener('pagehide', () => { save(); cancelRender(); stop(); });

if (!load()) example('spiral', false);
updateLabels(); draw();
renderSound().catch(report);
