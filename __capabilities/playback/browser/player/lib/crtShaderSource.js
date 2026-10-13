// crtShaderSource.js — fetch the crt-geom shader text at runtime.
//
// crt-geom is GPL-2.0+ third-party source, so it is not in this repo or its
// bundle: `npm run install:assets` puts it on the media volume and the backend
// serves it at /vendor/shaders/crt/crt-geom.glsl. A miss is not fatal: the
// caller falls back to the CSS overlay (useUpscaleEffects), and we log one warn.
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

export const CRT_GEOM_URL = '/vendor/shaders/crt/crt-geom.glsl';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'crt-shader-source' });
  return _logger;
}

let cached = null;
let warned = false;

export function resetCrtShaderSourceForTest() {
  cached = null;
  warned = false;
}

/**
 * @returns {Promise<string|null>} the shader text, or null when not installed.
 */
export async function loadCrtGeomSource({ fetchImpl = globalThis.fetch, url = CRT_GEOM_URL } = {}) {
  if (cached) return cached;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim()) throw new Error('empty shader');
    cached = text;
    return text;
  } catch (err) {
    if (!warned) {
      warned = true;
      logger().warn('crt.shader-unavailable', {
        url,
        error: err?.message || String(err),
        hint: 'crt-geom is not installed; using the CSS overlay. Run `npm run install:assets`.',
      });
    }
    return null;
  }
}
