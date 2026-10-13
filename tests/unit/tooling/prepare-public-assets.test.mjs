import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FRONTEND_ROOT, REPO_ROOT, PATHS, renderIcon, prepareMedia, prepareFlags, prepareIcons,
} from '../../../frontend/scripts/prepare-public-assets.mjs';

const HINT = 'run `npm run prepare:assets` in frontend/ (the prebuild hook)';

describe('generated public assets are present (build-time completeness)', () => {
  it.each(PATHS.wasmNames)('tfjs wasm %s is generated', (name) => {
    const f = join(FRONTEND_ROOT, 'public', name);
    expect(existsSync(f), `${f} missing: ${HINT}`).toBe(true);
    expect(statSync(f).size).toBeGreaterThan(100_000);
  });

  it('shaka bundle is generated', () => {
    const f = join(REPO_ROOT, PATHS.shaka);
    expect(existsSync(f), `${f} missing: ${HINT}`).toBe(true);
  });

  it.each(['testcard-480.mp4', 'motion-480.mp4'])('crt-lab clip %s is generated', (n) => {
    const f = join(REPO_ROOT, PATHS.crtMedia, n);
    expect(existsSync(f), `${f} missing: ${HINT} (needs ffmpeg)`).toBe(true);
  });

  it('filter-poc clip is generated', () => {
    const f = join(REPO_ROOT, PATHS.filterClip);
    expect(existsSync(f), `${f} missing: ${HINT} (needs ffmpeg)`).toBe(true);
  });
});

describe('prepare-public-assets generators', () => {
  it('renderIcon wraps the Solar body in a 1em currentColor svg', () => {
    const solar = { width: 24, height: 24, icons: { a: { body: '<path fill="currentColor" d="M0 0"/>' } } };
    const svg = renderIcon({ solar: 'a' }, solar);
    expect(svg).toContain('width="1em"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(renderIcon({ solar: 'a', mirror: true }, solar)).toContain('scale(-1 1)');
  });

  it('renderIcon rejects an unknown Solar name', () => {
    expect(() => renderIcon({ solar: 'nope' }, { icons: {} })).toThrow(/not found/);
  });

  it('media step warns and skips when ffmpeg is missing (non-strict), throws when strict', () => {
    const events = [];
    const log = (level, event) => events.push([level, event]);
    expect(prepareMedia({ ffmpeg: 'definitely-not-ffmpeg', log })).toEqual([]);
    expect(events).toEqual([['warn', 'prepare-assets.media.skipped']]);
    expect(() => prepareMedia({ ffmpeg: 'definitely-not-ffmpeg', strict: true, log })).toThrow(/ffmpeg/);
  });

  it('flags step fails loudly when flag-icons lacks a code', () => {
    const root = mkdtempSync(join(tmpdir(), 'prep-'));
    const geo = join(root, '__app_modules/learning/school/browser/geography');
    mkdirSync(geo, { recursive: true });
    writeFileSync(join(geo, 'flag-codes.json'), JSON.stringify(['zz-nope']));
    expect(() => prepareFlags({ repoRoot: root, frontendRoot: FRONTEND_ROOT })).toThrow(/source missing/);
  });

  it('icons step writes every manifest id', () => {
    const root = mkdtempSync(join(tmpdir(), 'prep-'));
    const dir = join(root, PATHS.iconsDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'icons.manifest.json'), JSON.stringify({ icons: { play: { solar: 'play-bold' }, 'skip-forward-30': { solar: 'rewind-forward-bold' } } }));
    const out = prepareIcons({ repoRoot: root, frontendRoot: FRONTEND_ROOT });
    expect(out).toHaveLength(2);
    expect(readFileSync(out[0], 'utf8')).toContain('<path');
  });
});
