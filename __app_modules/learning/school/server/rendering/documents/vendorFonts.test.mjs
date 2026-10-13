import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDocumentPdfRenderer } from "./DocumentPdfRenderer.mjs";
import { createDocumentReceiptRenderer } from "./DocumentReceiptRenderer.mjs";
import { createWorkbookTheme } from "./workbookTheme.mjs";
import { texToSvg } from "./mathSvg.mjs";
import { MissingVendorAssetError, resetVendorFontWarnings, setDefaultVendorFontDir, vendorFontDirFor, vendorFontDirFromEnv, enableEnvVendorFontDir, getDefaultVendorFontDir, resolveVendorFont, warnedKeys } from "./vendorFonts.mjs";

const theme = createWorkbookTheme({ typeScale: 'young' });
const doc = (md) => ({
  id: 'vendor-font', title: 'Vendor font', seed: 1, variant: 0, target: ['letter'],
  blocks: [{ type: 'rich_text', md }],
});

describe('missing vendor font (Noto Sans KR not installed)', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-vendor-'));
  const vendorFontDir = vendorFontDirFor(empty);
  beforeEach(() => { setDefaultVendorFontDir(null); resetVendorFontWarnings(); });

  it('vendorFontDirFor is <media>/vendor/fonts', () => {
    expect(vendorFontDir).toBe(path.join(empty, 'vendor', 'fonts'));
  });
  it('a non-Korean PDF still renders', async () => {
    const { pdf } = await createDocumentPdfRenderer({ theme, texToSvg, vendorFontDir }).render(doc('Plain English only'), { studentName: 'Learner' });
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.toString('latin1')).not.toMatch(/NotoSansKR/);
  });
  it('a Korean PDF throws an error naming npm run install:assets', async () => {
    const renderer = createDocumentPdfRenderer({ theme, texToSvg, vendorFontDir });
    await expect(renderer.render(doc('What does **가위** mean?'), { studentName: 'Learner' }))
      .rejects.toThrow(/npm run install:assets/);
    await expect(renderer.render(doc('안녕'), { studentName: 'Learner' })).rejects.toBeInstanceOf(MissingVendorAssetError);
  });
  it('a non-Korean receipt renders; a Korean receipt throws naming install:assets', async () => {
    const rasterizeSvg = async () => Buffer.alloc(0);
    const renderer = createDocumentReceiptRenderer({ vendorFontDir, rasterizeSvg });
    const card = (text) => ({ id: 'r', title: text, blocks: [] });
    await expect(renderer.createCanvas(card('Plain'), { tokens: {} })).resolves.toBeDefined();
    await expect(renderer.createCanvas(card('UBKS 비둘기'), { tokens: {} }))
      .rejects.toThrow(/npm run install:assets/);
  });
});

describe('vendorFontDirFromEnv (CLI runs have no composition)', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vf-env-'));
  it('uses DAYLIGHT_MEDIA_PATH, else DAYLIGHT_BASE_PATH/media, else null', () => {
    const cwd = tmp();
    expect(vendorFontDirFromEnv({ env: { DAYLIGHT_MEDIA_PATH: '/m' }, cwd })).toBe('/m/vendor/fonts');
    expect(vendorFontDirFromEnv({ env: { DAYLIGHT_BASE_PATH: '/b' }, cwd })).toBe('/b/media/vendor/fonts');
    expect(vendorFontDirFromEnv({ env: {}, cwd, envFiles: [] })).toBeNull();
  });
  it('reads a .env file when the shell env has nothing (dotenv has not run yet)', () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, '.env'), 'DAYLIGHT_BASE_PATH=/from/dotenv\n');
    expect(vendorFontDirFromEnv({ env: {}, cwd })).toBe('/from/dotenv/media/vendor/fonts');
    expect(vendorFontDirFromEnv({ env: { DAYLIGHT_MEDIA_PATH: '/shell' }, cwd })).toBe('/shell/vendor/fonts');
  });
  it('falls back to <cwd>/media when it holds vendor/fonts (in-container run)', () => {
    const cwd = tmp();
    expect(vendorFontDirFromEnv({ env: {}, cwd, envFiles: [] })).toBeNull();
    fs.mkdirSync(path.join(cwd, 'media', 'vendor', 'fonts'), { recursive: true });
    expect(vendorFontDirFromEnv({ env: {}, cwd, envFiles: [] })).toBe(path.join(cwd, 'media', 'vendor', 'fonts'));
  });
  it('enableEnvVendorFontDir resolves lazily at first use, not at call time', () => {
    const cwd = tmp();
    setDefaultVendorFontDir(null);
    const env = {};
    enableEnvVendorFontDir({ env, cwd, envFiles: [] });
    env.DAYLIGHT_MEDIA_PATH = '/late'; // e.g. dotenv.config() ran after import
    expect(getDefaultVendorFontDir()).toBe('/late/vendor/fonts');
    setDefaultVendorFontDir(null);
  });
  it('an explicit setDefaultVendorFontDir wins over the lazy resolver', () => {
    enableEnvVendorFontDir({ env: { DAYLIGHT_MEDIA_PATH: '/env' }, envFiles: [] });
    setDefaultVendorFontDir('/explicit');
    expect(getDefaultVendorFontDir()).toBe('/explicit');
    setDefaultVendorFontDir(null);
  });
  it('a real process with only a .env in cwd resolves the dir', () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, '.env'), 'DAYLIGHT_MEDIA_PATH=/only/dotenv\n');
    const mod = new URL('./vendorFonts.mjs', import.meta.url).href;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const m=await import(${JSON.stringify(mod)});m.enableEnvVendorFontDir();console.log(m.getDefaultVendorFontDir())`],
    { cwd, env: { PATH: process.env.PATH }, encoding: 'utf8' });
    expect(r.stderr).not.toMatch(/Error/);
    expect(r.stdout.trim()).toBe('/only/dotenv/vendor/fonts');
  });
  it('the warn-once key includes the directory', () => {
    resetVendorFontWarnings();
    expect(resolveVendorFont('x.otf', '/nope-a').missing).toBe(true);
    expect(resolveVendorFont('x.otf', '/nope-b').missing).toBe(true);
    expect(warnedKeys()).toEqual(['/nope-a::x.otf', '/nope-b::x.otf']);
  });
});

describe('every CLI that builds a renderer enables the env-resolved vendor font dir', () => {
  const cliDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../../../cli');
  for (const f of ['agenda.mjs', 'sim.mjs', 'docs.mjs', 'barcode-workflows.mjs']) {
    it(f, () => {
      expect(fs.readFileSync(path.join(cliDir, f), 'utf8')).toMatch(/enableEnvVendorFontDir\(\)/);
    });
  }
});
