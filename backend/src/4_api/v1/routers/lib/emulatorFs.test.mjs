// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  resolveRomPath,
  resolveArtPath,
  resolveSavePath,
  resolveStatePath,
  readBinary,
  writeBinary,
  makeReadEngineFile,
} from './emulatorFs.mjs';

const EMU_DIR = '/media/emulation';

function makeCfg() {
  return {
    systems: { gb: { core: 'gb', label: 'Game Boy' } },
    games: [
      {
        id: 'pokemon-red',
        system: 'gb',
        rom: 'roms/Pokemon Red (UE) [S][!].gb',
        boxart: 'cover.png',
        bezel: 'bezel.png',
      },
    ],
  };
}

describe('emulatorFs path resolvers', () => {
  it('resolveRomPath joins the real filename from cfg under {system}/', () => {
    const p = resolveRomPath(EMU_DIR, makeCfg(), 'gb', 'pokemon-red');
    expect(p).toBe(path.join(EMU_DIR, 'gb', 'roms/Pokemon Red (UE) [S][!].gb'));
  });

  it('resolveArtPath resolves cover and bezel', () => {
    expect(resolveArtPath(EMU_DIR, makeCfg(), 'gb', 'pokemon-red', 'cover')).toBe(
      path.join(EMU_DIR, 'gb', 'cover.png')
    );
    expect(resolveArtPath(EMU_DIR, makeCfg(), 'gb', 'pokemon-red', 'bezel')).toBe(
      path.join(EMU_DIR, 'gb', 'bezel.png')
    );
  });

  it('resolveSavePath uses safe per-user filename', () => {
    expect(resolveSavePath(EMU_DIR, 'gb', 'pokemon-red', 'soren')).toBe(
      path.join(EMU_DIR, 'gb', 'saves', 'soren', 'pokemon-red.srm')
    );
  });

  it('resolveStatePath uses slot file under user/game dir', () => {
    expect(resolveStatePath(EMU_DIR, 'gb', 'pokemon-red', '1', 'soren')).toBe(
      path.join(EMU_DIR, 'gb', 'states', 'soren', 'pokemon-red', '1.state')
    );
  });

  it('unsafe system throws', () => {
    expect(() => resolveSavePath(EMU_DIR, '../etc', 'pokemon-red', 'soren')).toThrow();
    expect(() => resolveRomPath(EMU_DIR, makeCfg(), '../etc', 'pokemon-red')).toThrow();
  });

  it('unknown game throws ENOENT', () => {
    try {
      resolveRomPath(EMU_DIR, makeCfg(), 'gb', 'nope');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('ENOENT');
    }
  });
});

describe('emulatorFs writeBinary → readBinary round-trip (real tmp dir)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-fs-test-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('writes atomically (creating dirs) and reads back identical bytes', async () => {
    const abs = path.join(tmp, 'nested', 'deep', 'save.srm');
    const payload = Buffer.from([10, 20, 30, 40]);
    await writeBinary(abs, payload);
    const result = readBinary(abs);
    expect(result.size).toBe(4);
    const buf = result.buffer ?? Buffer.from('');
    expect(buf).toEqual(payload);
  });

  it('readBinary throws ENOENT for missing file', () => {
    try {
      readBinary(path.join(tmp, 'does-not-exist'));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('ENOENT');
    }
  });

  it('readBinary honors range', () => {
    const abs = path.join(tmp, 'ranged.bin');
    fs.writeFileSync(abs, Buffer.from('ABCDEFGH'));
    const result = readBinary(abs, { range: { start: 2, end: 4 } });
    expect(result.size).toBe(8);
    expect(result.range).toEqual({ start: 2, end: 4 });
    // collect stream
    return new Promise((resolve) => {
      const chunks = [];
      result.stream.on('data', (c) => chunks.push(c));
      result.stream.on('end', () => {
        expect(Buffer.concat(chunks).toString()).toBe('CDE');
        resolve();
      });
    });
  });
});

describe('makeReadEngineFile (real tmp engine dir)', () => {
  const engineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-engine-test-'));
  afterAll(() => fs.rmSync(engineDir, { recursive: true, force: true }));

  it('reads a file under the engine dir (including nested)', () => {
    fs.writeFileSync(path.join(engineDir, 'loader.js'), 'LOADER');
    fs.mkdirSync(path.join(engineDir, 'cores'), { recursive: true });
    fs.writeFileSync(path.join(engineDir, 'cores', 'gambatte-wasm.data'), 'COREDATA');

    const read = makeReadEngineFile(engineDir);
    expect(read('loader.js').buffer.toString()).toBe('LOADER');
    expect(read('cores/gambatte-wasm.data').buffer.toString()).toBe('COREDATA');
  });

  it('throws ENOENT for a missing file', () => {
    const read = makeReadEngineFile(engineDir);
    try {
      read('missing.js');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('ENOENT');
    }
  });

  it('refuses to escape the engine dir', () => {
    // place a sibling secret outside the engine dir
    const secret = path.join(engineDir, '..', `secret-${path.basename(engineDir)}.txt`);
    fs.writeFileSync(secret, 'SECRET');
    try {
      const read = makeReadEngineFile(engineDir);
      try {
        read('../' + path.basename(secret));
        throw new Error('should have thrown');
      } catch (err) {
        expect(err.code).toBe('ENOENT');
      }
    } finally {
      fs.rmSync(secret, { force: true });
    }
  });
});
