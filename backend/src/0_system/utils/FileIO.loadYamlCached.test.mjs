import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { loadYamlCached, saveYamlToPathAtomic } from './FileIO.mjs';

const scratch = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const setup = (content = 'a: 1\nlist: [1, 2]\n') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-cached-'));
  scratch.push(dir);
  const base = path.join(dir, 'state');
  fs.writeFileSync(`${base}.yml`, content);
  return base;
};

describe('loadYamlCached', () => {
  it('parses an unchanged file once', () => {
    const base = setup();
    const parse = vi.spyOn(yaml, 'load');
    expect(loadYamlCached(base)).toEqual({ a: 1, list: [1, 2] });
    expect(loadYamlCached(base)).toEqual({ a: 1, list: [1, 2] });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('hands out clones: a caller mutating its copy changes no one else', () => {
    const base = setup();
    const first = loadYamlCached(base);
    first.a = 99; first.list.push(3);
    expect(loadYamlCached(base)).toEqual({ a: 1, list: [1, 2] });
  });

  it('an atomic rewrite is read fresh', () => {
    const base = setup();
    expect(loadYamlCached(base).a).toBe(1);
    saveYamlToPathAtomic(`${base}.yml`, { a: 2 });
    expect(loadYamlCached(base)).toEqual({ a: 2 });
  });

  it('an in-place edit is read fresh', () => {
    const base = setup();
    expect(loadYamlCached(base).a).toBe(1);
    fs.writeFileSync(`${base}.yml`, 'a: 3\nlist: [1, 2]\n');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(`${base}.yml`, later, later);
    expect(loadYamlCached(base).a).toBe(3);
  });

  it('a missing file is null, like loadYaml', () => {
    expect(loadYamlCached(path.join(os.tmpdir(), 'no-such-yaml-file-xyz'))).toBeNull();
  });
});
