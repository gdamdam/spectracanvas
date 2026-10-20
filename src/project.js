import { WIDTH, HEIGHT, validateSettings } from './dsp.js';

// Pure helpers for the project format and image import, kept free of DOM
// access so they can be tested in Node.

export const PROJECT_VERSION = 1;

const clamp = (value, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : null;

export function serializeProject({ pixels, settings, brush, strength, width = WIDTH, height = HEIGHT }) {
  let binary = '';
  for (let i = 0; i < pixels.length; i += 4096) binary += String.fromCharCode(...pixels.subarray(i, i + 4096));
  return JSON.stringify({ version: PROJECT_VERSION, width, height, pixels: btoa(binary), settings, brush, strength });
}

// Returns null for anything that is not a compatible project; throws for
// settings outside the supported range (the caller treats both as "no project").
export function parseProject(text, { width = WIDTH, height = HEIGHT } = {}) {
  const saved = JSON.parse(text);
  if (!saved || saved.version !== PROJECT_VERSION || saved.width !== width || saved.height !== height) return null;
  validateSettings(saved.settings);
  const binary = atob(saved.pixels);
  if (binary.length !== width * height) return null;
  const { duration, low, high } = saved.settings;
  return {
    pixels: Uint8ClampedArray.from(binary, s => s.charCodeAt(0)),
    settings: { duration, low, high },
    brush: clamp(saved.brush, 1, 12),
    strength: clamp(saved.strength, 5, 100),
  };
}

// Converts RGBA image data (already fitted into a width×height canvas at the
// rectangle `fit`) into a luminance drawing. Bright opaque backgrounds are
// detected from the edges of the fitted image and inverted into silence;
// transparent pixels always stay silent.
export function imageToPixels(data, { width = WIDTH, height = HEIGHT, fit }) {
  const left = Math.max(0, Math.ceil(fit.x)), right = Math.min(width - 1, Math.floor(fit.x + fit.w) - 1);
  const top = Math.max(0, Math.ceil(fit.y)), bottom = Math.min(height - 1, Math.floor(fit.y + fit.h) - 1);
  const luminance = i => data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722;
  let edge = 0, weight = 0;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) if (x === left || x === right || y === top || y === bottom) {
    const i = (y * width + x) * 4, alpha = data[i + 3] / 255;
    edge += luminance(i) * alpha; weight += alpha;
  }
  const inverted = weight > 0 && edge / weight > 150;
  const pixels = new Uint8ClampedArray(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const j = i * 4, light = luminance(j);
    pixels[i] = (inverted ? 255 - light : light) * data[j + 3] / 255;
  }
  return { pixels, inverted };
}
