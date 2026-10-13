import { describe, it, expect, vi, beforeEach } from 'vitest';

const warn = vi.fn();
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }) }),
}));

import { loadCrtGeomSource, resetCrtShaderSourceForTest, CRT_GEOM_URL } from './crtShaderSource.js';

describe('loadCrtGeomSource', () => {
  beforeEach(() => { warn.mockClear(); resetCrtShaderSourceForTest(); });

  it('fetches the shader from /vendor and caches it', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'void main(){}' }));
    expect(await loadCrtGeomSource({ fetchImpl })).toBe('void main(){}');
    await loadCrtGeomSource({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(CRT_GEOM_URL);
    expect(CRT_GEOM_URL).toBe('/vendor/shaders/crt/crt-geom.glsl');
  });

  it('returns null and warns once when the shader is not installed', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    expect(await loadCrtGeomSource({ fetchImpl })).toBeNull();
    expect(await loadCrtGeomSource({ fetchImpl })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('crt.shader-unavailable');
    expect(JSON.stringify(warn.mock.calls[0][1])).toContain('install:assets');
  });

  it('treats a network error as not installed', async () => {
    expect(await loadCrtGeomSource({ fetchImpl: async () => { throw new Error('offline'); } })).toBeNull();
  });

  it('remembers a failed fetch for the session: one request, not one per mount', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    await loadCrtGeomSource({ fetchImpl });
    await loadCrtGeomSource({ fetchImpl });
    await loadCrtGeomSource({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
