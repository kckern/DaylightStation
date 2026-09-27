import { describe, it, expect, vi } from 'vitest';
import { buildShaderEntry, loadShaderTextures, withShaderTextures, withoutShader } from './customShaders.js';

// The 8-byte PNG signature — every byte >= 0x80 must survive untouched.
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const okResponse = (bytes) => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(bytes).buffer });

describe('buildShaderEntry', () => {
  it('shapes preset + passes for EmulatorJS, with no textures yet', () => {
    const entry = buildShaderEntry({
      preset: 'shaders = 1\nshader0 = a.glsl\n',
      passes: [['a.glsl', 'void main(){}']],
    });
    expect(entry.shader).toEqual({ type: 'text', value: 'shaders = 1\nshader0 = a.glsl\n' });
    expect(entry.resources).toEqual([{ name: 'a.glsl', type: 'text', value: 'void main(){}' }]);
    expect(entry.binaries).toEqual({});
  });

  it('refuses an empty preset or no passes', () => {
    expect(() => buildShaderEntry({ preset: '', passes: [['a.glsl', 'x']] })).toThrow(/preset/);
    expect(() => buildShaderEntry({ preset: 'shaders = 0', passes: [] })).toThrow(/pass/);
  });
});

describe('loadShaderTextures', () => {
  it('fetches each texture under the base and returns exact bytes', async () => {
    const fetchImpl = vi.fn(async () => okResponse(PNG_SIG));
    const { bytes, missing } = await loadShaderTextures(
      { 'bg.png': 'shaders/gameboy/bg.png' },
      { base: '/api/v1/emulator/engine/', fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/emulator/engine/shaders/gameboy/bg.png');
    expect(missing).toEqual([]);
    expect(bytes['bg.png']).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes['bg.png'])).toEqual(PNG_SIG);
  });

  it('reports a 404 or a network failure as missing instead of throwing', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('gone.png')) return { ok: false, status: 404 };
      throw new Error('offline');
    });
    const { bytes, missing } = await loadShaderTextures(
      { 'gone.png': 'gone.png', 'net.png': 'net.png' },
      { base: '/e/', fetchImpl },
    );
    expect(bytes).toEqual({});
    expect(missing).toEqual(expect.arrayContaining([
      { name: 'gone.png', url: '/e/gone.png', error: 'HTTP 404' },
      { name: 'net.png', url: '/e/net.png', error: 'offline' },
    ]));
  });
});

describe('withShaderTextures / withoutShader', () => {
  const table = Object.freeze({
    'a.glslp': Object.freeze(buildShaderEntry({ preset: 'p', passes: [['a.glsl', 'x']] })),
    'b.glslp': Object.freeze(buildShaderEntry({ preset: 'p', passes: [['b.glsl', 'x']] })),
  });

  it('attaches bytes to one preset without touching the shared table', () => {
    const bytes = { 'bg.png': new Uint8Array(PNG_SIG) };
    const next = withShaderTextures(table, 'a.glslp', bytes);
    expect(next['a.glslp'].binaries).toEqual(bytes);
    expect(next['b.glslp']).toBe(table['b.glslp']);
    expect(table['a.glslp'].binaries).toEqual({});
  });

  it('drops one preset, keeps the rest', () => {
    const next = withoutShader(table, 'a.glslp');
    expect(Object.keys(next)).toEqual(['b.glslp']);
    expect(Object.keys(table)).toEqual(['a.glslp', 'b.glslp']);
  });

  it('leaves the table alone for an unknown name', () => {
    expect(withShaderTextures(table, 'nope', {})).toBe(table);
    expect(withoutShader(table, 'nope')).toBe(table);
  });
});
