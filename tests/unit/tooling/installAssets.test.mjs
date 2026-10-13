import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInstaller, validateManifest, resolveTarget } from '../../../scripts/install-assets.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

describe('install-assets', () => {
  let dir; let media; let out;
  const log = [];
  const io = { out: (m) => log.push(m), err: (m) => log.push(m) };
  const writeManifest = (assets) => {
    const p = join(dir, 'm.yml');
    writeFileSync(p, JSON.stringify({ version: 1, assets })); // JSON is valid YAML
    return p;
  };
  beforeEach(() => {
    log.length = 0;
    dir = mkdtempSync(join(tmpdir(), 'install-assets-'));
    media = join(dir, 'media');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.bin'), 'AAA');
    writeFileSync(join(dir, 'src', 'b.bin'), 'BBB');
    out = { a: pathToFileURL(join(dir, 'src', 'a.bin')).href, b: pathToFileURL(join(dir, 'src', 'b.bin')).href };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const entry = (id, url, content, extra = {}) =>
    ({ id, target: `fonts/${id}.bin`, source: { url }, sha256: sha(content), licence: 'OFL', ...extra });

  it('resolves targets under <media>/vendor and refuses escapes', () => {
    expect(resolveTarget('/m', 'fonts/x.otf')).toBe('/m/vendor/fonts/x.otf');
    expect(() => resolveTarget('/m', '../x')).toThrow(/escapes/);
    expect(() => resolveTarget('/m', '/abs')).toThrow();
  });

  it('validates manifest shape', () => {
    expect(() => validateManifest({ assets: [{ id: 'x' }] })).toThrow(/target/);
    expect(() => validateManifest({ assets: [entry('a', out.a, 'AAA'), entry('a', out.a, 'AAA')] })).toThrow(/duplicate/);
    expect(() => validateManifest({ assets: [{ id: 'x', target: 't', source: { url: 'u', npm: 'p' }, sha256: sha('x') }] })).toThrow(/exactly one/);
  });

  it('installs from a file:// source, verifies sha, and is idempotent', async () => {
    const manifest = writeManifest([entry('a', out.a, 'AAA')]);
    expect(await runInstaller(['--media-dir', media, '--manifest', manifest], io)).toBe(0);
    expect(readFileSync(join(media, 'vendor', 'fonts', 'a.bin'), 'utf8')).toBe('AAA');
    log.length = 0;
    expect(await runInstaller(['--media-dir', media, '--manifest', manifest], io)).toBe(0);
    expect(log.join('\n')).toMatch(/skip.*a/i);
  });

  it('aborts only the entry whose sha does not match, leaving no file', async () => {
    const manifest = writeManifest([entry('a', out.a, 'WRONG'), entry('b', out.b, 'BBB')]);
    expect(await runInstaller(['--media-dir', media, '--manifest', manifest], io)).toBe(1);
    expect(existsSync(join(media, 'vendor', 'fonts', 'a.bin'))).toBe(false);
    expect(readFileSync(join(media, 'vendor', 'fonts', 'b.bin'), 'utf8')).toBe('BBB');
  });

  it('--only installs a single entry', async () => {
    const manifest = writeManifest([entry('a', out.a, 'AAA'), entry('b', out.b, 'BBB')]);
    expect(await runInstaller(['--media-dir', media, '--manifest', manifest, '--only', 'b'], io)).toBe(0);
    expect(existsSync(join(media, 'vendor', 'fonts', 'a.bin'))).toBe(false);
    expect(existsSync(join(media, 'vendor', 'fonts', 'b.bin'))).toBe(true);
    expect(await runInstaller(['--media-dir', media, '--manifest', manifest, '--only', 'nope'], io)).toBe(1);
  });

  it('--check exits 1 and reports missing and mismatched entries, writing nothing', async () => {
    const manifest = writeManifest([entry('a', out.a, 'AAA'), entry('b', out.b, 'BBB')]);
    mkdirSync(join(media, 'vendor', 'fonts'), { recursive: true });
    writeFileSync(join(media, 'vendor', 'fonts', 'b.bin'), 'tampered');
    expect(await runInstaller(['--check', '--media-dir', media, '--manifest', manifest], io)).toBe(1);
    const text = log.join('\n');
    expect(text).toMatch(/missing.*a/i);
    expect(text).toMatch(/mismatch.*b/i);
    expect(existsSync(join(media, 'vendor', 'fonts', 'a.bin'))).toBe(false);
  });

  it('--check exits 0 once everything is installed', async () => {
    const manifest = writeManifest([entry('a', out.a, 'AAA')]);
    await runInstaller(['--media-dir', media, '--manifest', manifest], io);
    expect(await runInstaller(['--check', '--media-dir', media, '--manifest', manifest], io)).toBe(0);
  });

  it('reports local-source entries as owner-provided: checked, never fetched', async () => {
    const manifest = writeManifest([{ id: 'own', target: 'fonts/own.bin', source: { local: 'bring your own' }, sha256: sha('OWN'), licence: 'unknown' }]);
    // install mode: not an error, but reported
    expect(await runInstaller(['--media-dir', media, '--manifest', manifest], io)).toBe(0);
    expect(log.join('\n')).toMatch(/owner-provided.*own/i);
    expect(existsSync(join(media, 'vendor', 'fonts', 'own.bin'))).toBe(false);
    // check mode: missing is a failure
    expect(await runInstaller(['--check', '--media-dir', media, '--manifest', manifest], io)).toBe(1);
    mkdirSync(join(media, 'vendor', 'fonts'), { recursive: true });
    writeFileSync(join(media, 'vendor', 'fonts', 'own.bin'), 'OWN');
    expect(await runInstaller(['--check', '--media-dir', media, '--manifest', manifest], io)).toBe(0);
  });

  it('installs from an npm source resolved in node_modules', async () => {
    mkdirSync(join(dir, 'node_modules', 'pkg', 'dist'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'dist', 'f.bin'), 'NPM');
    const manifest = writeManifest([{ id: 'n', target: 'n/f.bin', source: { npm: 'pkg/dist/f.bin' }, sha256: sha('NPM'), licence: 'MIT' }]);
    expect(await runInstaller(['--media-dir', media, '--manifest', manifest, '--node-modules', join(dir, 'node_modules')], io)).toBe(0);
    expect(readFileSync(join(media, 'vendor', 'n', 'f.bin'), 'utf8')).toBe('NPM');
  });

  it('fails with a usage error when no media dir can be determined', async () => {
    const manifest = writeManifest([]);
    const saved = process.env.DAYLIGHT_MEDIA_PATH; delete process.env.DAYLIGHT_MEDIA_PATH;
    const savedBase = process.env.DAYLIGHT_BASE_PATH; delete process.env.DAYLIGHT_BASE_PATH;
    try { expect(await runInstaller(['--manifest', manifest, '--no-dotenv'], io)).toBe(2); }
    finally { if (saved) process.env.DAYLIGHT_MEDIA_PATH = saved; if (savedBase) process.env.DAYLIGHT_BASE_PATH = savedBase; }
  });
});
