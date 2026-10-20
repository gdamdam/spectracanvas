export const SAMPLE_RATE = 44100;
export const WIDTH = 384;
export const HEIGHT = 128;

export function frequencyAtRow(row, height, low, high) {
  return low * (high / low) ** (1 - row / (height - 1));
}

export function validateSettings({ duration, low, high }, sampleRate = SAMPLE_RATE) {
  if (![duration, low, high].every(Number.isFinite) || duration < 1 || duration > 12 || low < 40 || high > 16000 || low >= high || high >= sampleRate / 2) {
    throw new Error('Choose 1–12 seconds and a frequency range between 40 and 16,000 Hz.');
  }
}

// Log-spaced additive synthesis. Each row is a continuous-phase oscillator;
// adjacent time columns are linearly interpolated to reduce abrupt transitions.
export function synthesize({ pixels, width = WIDTH, height = HEIGHT, duration = 6, low = 80, high = 6000, sampleRate = SAMPLE_RATE }, onProgress = () => {}) {
  validateSettings({ duration, low, high }, sampleRate);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || pixels.length !== width * height) throw new Error('Invalid drawing dimensions.');
  if (!pixels.some(v => v > 0)) throw new Error('The canvas is empty. Paint a line or choose an example.');
  const length = Math.round(sampleRate * duration);
  const samples = new Float32Array(length);
  const columns = new Uint16Array(length), fractions = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = i / (length - 1) * (width - 1);
    columns[i] = Math.min(width - 2, Math.floor(x));
    fractions[i] = x - columns[i];
  }
  for (let row = 0; row < height; row++) {
    const offset = row * width;
    if (pixels.subarray(offset, offset + width).some(v => v > 0)) {
      const frequency = frequencyAtRow(row, height, low, high);
      const step = 2 * Math.PI * frequency / sampleRate, cs = Math.cos(step), sn = Math.sin(step);
      // A deterministic phase offset distributes peaks across dense drawings.
      let sine = Math.sin(row * 2.39996323), cosine = Math.cos(row * 2.39996323);
      for (let i = 0; i < length; i++) {
        const index = offset + columns[i], fraction = fractions[i];
        const amplitude = (pixels[index] * (1 - fraction) + pixels[index + 1] * fraction) / 255;
        samples[i] += amplitude * sine;
        const next = sine * cs + cosine * sn;
        cosine = cosine * cs - sine * sn;
        sine = next;
      }
    }
    if (row % 8 === 0) onProgress(0.65 * row / height);
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const factor = peak ? 0.9 / peak : 0;
  const fade = Math.round(sampleRate * 0.012);
  for (let i = 0; i < length; i++) samples[i] *= factor * Math.min(1, i / fade, (length - 1 - i) / fade);
  onProgress(0.65);
  return samples;
}

export function fft(real, imag) {
  const n = real.length;
  if (n !== imag.length || n < 2 || (n & (n - 1))) throw new Error('FFT length must be a power of two.');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let size = 2; size <= n; size *= 2) {
    const step = -2 * Math.PI / size, sr = Math.cos(step), si = Math.sin(step);
    for (let start = 0; start < n; start += size) {
      let wr = 1, wi = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j, b = a + size / 2;
        const tr = wr * real[b] - wi * imag[b], ti = wr * imag[b] + wi * real[b];
        real[b] = real[a] - tr; imag[b] = imag[a] - ti;
        real[a] += tr; imag[a] += ti;
        const next = wr * sr - wi * si; wi = wr * si + wi * sr; wr = next;
      }
    }
  }
}

// The displayed result is measured from the generated audio, not the drawing.
export function analyze(samples, { width = WIDTH, height = HEIGHT, low = 80, high = 6000, sampleRate = SAMPLE_RATE, fftSize = 4096 } = {}, onProgress = () => {}) {
  const values = new Float32Array(width * height), real = new Float64Array(fftSize), imag = new Float64Array(fftSize);
  const window = Float64Array.from({ length: fftSize }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)));
  const bins = Float64Array.from({ length: height }, (_, row) => frequencyAtRow(row, height, low, high) * fftSize / sampleRate);
  let max = 1e-12;
  for (let x = 0; x < width; x++) {
    const center = Math.round(x / (width - 1) * (samples.length - 1));
    for (let i = 0; i < fftSize; i++) { real[i] = (samples[center + i - fftSize / 2] || 0) * window[i]; imag[i] = 0; }
    fft(real, imag);
    for (let y = 0; y < height; y++) {
      const bin = bins[y], k = Math.min(fftSize / 2 - 2, Math.floor(bin)), mix = bin - k;
      // Upper rows cover more FFT bins on a logarithmic scale. Peak aggregation
      // prevents narrow tones between the row centers from vanishing.
      const lower = y === height - 1 ? bin : Math.sqrt(bin * bins[y + 1]);
      const upper = y === 0 ? bin : Math.sqrt(bin * bins[y - 1]);
      let magnitude = Math.hypot(real[k], imag[k]) * (1 - mix) + Math.hypot(real[k + 1], imag[k + 1]) * mix;
      for (let b = Math.ceil(lower); b <= Math.min(fftSize / 2 - 1, Math.floor(upper)); b++) magnitude = Math.max(magnitude, Math.hypot(real[b], imag[b]));
      values[y * width + x] = magnitude;
      max = Math.max(max, magnitude);
    }
    if (x % 24 === 0) onProgress(0.65 + 0.35 * x / width);
  }
  const spectrum = new Uint8ClampedArray(values.length);
  for (let i = 0; i < values.length; i++) spectrum[i] = Math.max(0, 1 + 20 * Math.log10(Math.max(1e-12, values[i] / max)) / 60) * 255;
  return spectrum;
}

export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const value = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); }
  return bytes;
}
