import { describe, it, expect } from 'vitest';
import { dataUriToBytes, buildShaderEntry } from './customShaders.js';

// The 8-byte PNG signature, base64'd.
const PNG_SIG_URI = 'data:image/png;base64,iVBORw0KGgo=';
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('dataUriToBytes', () => {
  it('decodes a base64 data URI to the exact bytes, high bit intact', () => {
    const bytes = dataUriToBytes(PNG_SIG_URI);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(PNG_SIG);
  });

  it('rejects anything that is not a base64 data URI', () => {
    expect(() => dataUriToBytes('/assets/paper-bg.png')).toThrow(/data: URI/);
    expect(() => dataUriToBytes('data:text/plain,hello')).toThrow(/base64/);
    expect(() => dataUriToBytes(undefined)).toThrow();
  });
});

describe('buildShaderEntry', () => {
  it('shapes preset + passes for EmulatorJS and keeps textures as raw bytes', () => {
    const entry = buildShaderEntry({
      preset: 'shaders = 1\nshader0 = a.glsl\n',
      passes: [['a.glsl', 'void main(){}']],
      textures: [['bg.png', PNG_SIG_URI]],
    });
    expect(entry.shader).toEqual({ type: 'text', value: 'shaders = 1\nshader0 = a.glsl\n' });
    expect(entry.resources).toEqual([{ name: 'a.glsl', type: 'text', value: 'void main(){}' }]);
    expect(Object.keys(entry.binaries)).toEqual(['bg.png']);
    expect(Array.from(entry.binaries['bg.png'])).toEqual(PNG_SIG);
  });

  it('works without textures', () => {
    const entry = buildShaderEntry({ preset: 'shaders = 1', passes: [['a.glsl', 'x']] });
    expect(entry.binaries).toEqual({});
  });

  it('refuses an empty preset or no passes', () => {
    expect(() => buildShaderEntry({ preset: '', passes: [['a.glsl', 'x']] })).toThrow(/preset/);
    expect(() => buildShaderEntry({ preset: 'shaders = 0', passes: [] })).toThrow(/pass/);
  });
});
