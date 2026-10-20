import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeProject, parseProject, imageToPixels } from '../src/project.js';
import { WIDTH, HEIGHT } from '../src/dsp.js';

const settings = { duration: 6, low: 80, high: 6000 };
function drawing() {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT);
  pixels[0] = 255; pixels[WIDTH * 10 + 20] = 128; pixels[pixels.length - 1] = 7;
  return pixels;
}

test('project round-trips pixels, settings, and clamped brush values', () => {
  const text = serializeProject({ pixels: drawing(), settings, brush: 40, strength: 2 });
  const parsed = parseProject(text);
  assert.deepEqual(parsed.pixels, drawing());
  assert.deepEqual(parsed.settings, settings);
  assert.equal(parsed.brush, 12);
  assert.equal(parsed.strength, 5);
});

test('project rejects incompatible versions, sizes, and unsafe settings', () => {
  const base = JSON.parse(serializeProject({ pixels: drawing(), settings, brush: 3, strength: 85 }));
  assert.equal(parseProject(JSON.stringify({ ...base, version: 2 })), null);
  assert.equal(parseProject(JSON.stringify({ ...base, width: WIDTH + 1 })), null);
  assert.equal(parseProject(JSON.stringify({ ...base, pixels: btoa('abc') })), null);
  assert.equal(parseProject('null'), null);
  assert.throws(() => parseProject(JSON.stringify({ ...base, settings: { ...settings, duration: 99 } })), /1–12/);
  assert.equal(parseProject(JSON.stringify({ ...base, brush: 'x' })).brush, null);
});

// Builds RGBA data for a small canvas: a background color with one differently
// colored pixel in the middle. `alpha` applies to the whole image.
function image(width, height, background, mark, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...background, alpha], i * 4);
  data.set([...mark, alpha], ((height >> 1) * width + (width >> 1)) * 4);
  return data;
}
const fit = { x: 0, y: 0, w: 8, h: 4 };

test('white backgrounds are inverted so marks become sound and paper stays silent', () => {
  const { pixels, inverted } = imageToPixels(image(8, 4, [255, 255, 255], [0, 0, 0]), { width: 8, height: 4, fit });
  assert.equal(inverted, true);
  assert.equal(pixels[2 * 8 + 4], 255);
  assert.equal(pixels[0], 0);
});

test('dark backgrounds are kept as drawn and transparent pixels stay silent', () => {
  const dark = imageToPixels(image(8, 4, [0, 0, 0], [255, 255, 255]), { width: 8, height: 4, fit });
  assert.equal(dark.inverted, false);
  assert.equal(dark.pixels[2 * 8 + 4], 255);
  assert.equal(dark.pixels[0], 0);
  const clear = imageToPixels(image(8, 4, [255, 255, 255], [255, 255, 255], 0), { width: 8, height: 4, fit });
  assert.equal(clear.inverted, false);
  assert.ok(clear.pixels.every(v => v === 0));
});
