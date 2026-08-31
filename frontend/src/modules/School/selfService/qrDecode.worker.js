import jsQR from 'jsqr';

// One frame in, one answer out. The caller never queues another frame until
// this one answers, so an older Android WebView cannot build an unbounded pile
// of camera pixels behind a slow decode.
self.onmessage = (event) => {
  const { id, pixels, width, height } = event.data || {};
  try {
    const bytes = new Uint8ClampedArray(pixels);
    const result = jsQR(bytes, width, height, { inversionAttempts: 'dontInvert' });
    self.postMessage({ id, data: result?.data ?? null });
  } catch (error) {
    self.postMessage({ id, error: error?.message ?? String(error) });
  }
};
