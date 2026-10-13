import { describe, it, expect, vi, beforeEach } from 'vitest';

const warn = vi.fn();
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }) }),
}));

import {
  loadEmulatorShaders, resetEmulatorShadersForTest, GAMEBOY_HARLEQUIN, GAMEBOY_HARLEQUIN_COLOR, VENDOR_SHADER_BASE,
} from './emulatorShaders.js';

const ok = (text) => ({ ok: true, status: 200, text: async () => text });

describe('loadEmulatorShaders', () => {
  beforeEach(() => { warn.mockClear(); resetEmulatorShadersForTest(); });

  it('fetches the five Game Boy passes from /vendor and builds both presets', async () => {
    const fetchImpl = vi.fn(async (url) => ok(`// ${url}`));
    const table = await loadEmulatorShaders({ fetchImpl });
    expect(fetchImpl.mock.calls.map((c) => c[0]).sort()).toEqual(
      [0, 1, 2, 3, 4].map((i) => `${VENDOR_SHADER_BASE}/gameboy/gb-pass${i}.glsl`),
    );
    for (const name of [GAMEBOY_HARLEQUIN, GAMEBOY_HARLEQUIN_COLOR]) {
      expect(table[name].resources.map((r) => r.name)).toEqual([0, 1, 2, 3, 4].map((i) => `gb-pass${i}.glsl`));
      expect(table[name].resources[2].value).toContain('gb-pass2.glsl');
      expect(table[name].shader.value).toMatch(/shader0 = gb-pass0\.glsl/);
    }
  });

  it('returns no shaders (unfiltered picture) and warns ONCE when the passes are not installed', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    expect(await loadEmulatorShaders({ fetchImpl })).toEqual({});
    expect(await loadEmulatorShaders({ fetchImpl })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('emulator.shader.unavailable');
    expect(JSON.stringify(warn.mock.calls[0][1])).toContain('install:assets');
  });

  it('treats a network error like a miss', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    expect(await loadEmulatorShaders({ fetchImpl })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not refetch after a success', async () => {
    const fetchImpl = vi.fn(async () => ok('x'));
    await loadEmulatorShaders({ fetchImpl });
    await loadEmulatorShaders({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
