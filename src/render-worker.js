import { synthesize, analyze } from './dsp.js';
self.onmessage = ({ data }) => {
  const { id, ...options } = data;
  try {
    const progress = value => self.postMessage({ id, type: 'progress', value });
    const samples = synthesize(options, progress);
    const spectrum = analyze(samples, options, progress);
    self.postMessage({ id, type: 'done', samples, spectrum }, [samples.buffer, spectrum.buffer]);
  } catch (error) { self.postMessage({ id, type: 'error', message: error.message }); }
};
