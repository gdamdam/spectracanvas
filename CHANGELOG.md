# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-10-19

First public release, hosted at https://gdamdam.github.io/spectracanvas/.

### Added
- Spectrogram painting with draw, erase, brush size and strength, undo/redo, and keyboard control.
- Additive synthesis in a web worker with progress and cancellation.
- Measured spectrogram and waveform of the rendered audio.
- Image import with automatic background inversion; PNG save of the drawing.
- WAV export (44.1 kHz, 16-bit mono) and local autosave.
- Spiral, Glides, and Chord examples.
- GPL-3.0 license.
- GitHub Actions: tests and checks on Node 20 and 22; automatic deploy to GitHub Pages on push to `main`.
- Search-engine metadata: description, canonical URL, Open Graph tags, JSON-LD, `robots.txt`, `sitemap.xml`, and a crawlable footer.
- `scripts/stamp-version.mjs` keeps the cache-busting query in `index.html` in sync with `package.json`; `npm run check` verifies it and `npm version` runs it.
- `scripts/screenshot.mjs` captures `docs/screenshot.png` from a running local server.
- Tests for synthesis, FFT, WAV encoding, the project save format, and the image import heuristic.
