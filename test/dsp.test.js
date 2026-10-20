import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesize, analyze, fft, encodeWav, frequencyAtRow } from '../src/dsp.js';

const options = { width: 64, height: 32, duration: 1, low: 100, high: 1000, sampleRate: 8000 };
function singleRow(row = 0, first = 0, end = options.width) {
  const pixels = new Uint8ClampedArray(options.width * options.height);
  pixels.fill(255, row * options.width + first, row * options.width + end);
  return pixels;
}
test('frequency rows match a logarithmic scale with correct endpoints', () => {
  assert.equal(frequencyAtRow(0, 3, 100, 10000), 10000);
  assert.equal(frequencyAtRow(1, 3, 100, 10000), 1000);
  assert.equal(frequencyAtRow(2, 3, 100, 10000), 100);
});
test('FFT resolves a known sinusoid and rejects unsupported dimensions', () => {
  const n = 1024, real = Float64Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 64 * i / n)), imag = new Float64Array(n);
  fft(real, imag);
  assert.ok(Math.abs(Math.hypot(real[64], imag[64]) - n / 2) < 1e-8);
  assert.ok(Math.hypot(real[63], imag[63]) < 1e-8);
  assert.throws(() => fft(new Float64Array(3), new Float64Array(3)), /power of two/);
});
test('painted top row produces the specified pitch, length, normalized peak, and fades', () => {
  const samples = synthesize({ ...options, pixels: singleRow() });
  assert.equal(samples.length, 8000);
  assert.ok(samples.every(Number.isFinite));
  assert.equal(Math.abs(samples[0]), 0); assert.equal(Math.abs(samples.at(-1)), 0);
  assert.ok(Math.abs(Math.max(...samples.map(Math.abs)) - 0.9) < 1e-6);
  const real = new Float64Array(4096), imag = new Float64Array(4096);
  real.set(samples.subarray(2000, 6096)); fft(real, imag);
  let strongest = 0;
  for (let i = 1; i < 2048; i++) if (Math.hypot(real[i], imag[i]) > Math.hypot(real[strongest], imag[strongest])) strongest = i;
  assert.equal(strongest * 8000 / 4096, 1000);
});
test('the time axis controls when sound starts and silence remains silent', () => {
  const samples = synthesize({ ...options, pixels: singleRow(10, 32) });
  assert.ok(samples.subarray(0, 3800).every(v => v === 0));
  assert.ok(samples.subarray(4400, 7000).some(v => Math.abs(v) > 0.2));
});
test('rendered spectrogram measures the audio and places the tone at its frequency', () => {
  const samples = synthesize({ ...options, pixels: singleRow(12) });
  const spectrum = analyze(samples, { ...options, fftSize: 2048 });
  const center = 32;
  let best = 0;
  for (let row = 0; row < options.height; row++) if (spectrum[row * options.width + center] > spectrum[best * options.width + center]) best = row;
  assert.ok(Math.abs(best - 12) <= 1, `Peak was at row ${best}`);
  assert.ok(spectrum[12 * options.width + center] > 240);
  assert.equal(analyze(new Float32Array(8000), { ...options, fftSize: 2048 }).some(v => v > 0), false);
});
test('rendering is deterministic and empty/unsafe inputs fail clearly', () => {
  assert.deepEqual(synthesize({ ...options, pixels: singleRow() }), synthesize({ ...options, pixels: singleRow() }));
  assert.throws(() => synthesize({ ...options, pixels: singleRow(), high: 5000 }), /frequency range/);
  assert.throws(() => synthesize({ ...options, pixels: new Uint8ClampedArray(64 * 32) }), /empty/);
  assert.throws(() => synthesize({ ...options, pixels: singleRow(), duration: 100 }), /1–12/);
});
test('WAV has a correct PCM header and clips/encodes both polarities', () => {
  const samples = new Float32Array([-2, -.5, 0, .5, 2]), bytes = encodeWav(samples, 8000), view = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint16(34, true), 16); assert.equal(view.getUint32(40, true), 10);
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(52, true), 32767);
});
