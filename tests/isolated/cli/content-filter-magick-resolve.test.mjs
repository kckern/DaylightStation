import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { resolveMagick } from '../../../__app_modules/media/media/server/adapters/content-filter/MagickRefineRenderer.mjs';

const binDir = (...names) => {
  const d = mkdtempSync(path.join(tmpdir(), 'cf-bin-'));
  for (const n of names) { writeFileSync(path.join(d, n), '#!/bin/sh\n'); chmodSync(path.join(d, n), 0o755); }
  return d;
};

describe('resolveMagick', () => {
  it('prefers magick (ImageMagick 7)', () => expect(resolveMagick(binDir('magick', 'convert'))).toBe('magick'));
  it('falls back to convert (ImageMagick 6)', () => expect(resolveMagick(binDir('convert'))).toBe('convert'));
  it('names magick when neither exists', () => expect(resolveMagick(binDir())).toBe('magick'));
});

describe('renderer output size on this host\'s ImageMagick', () => {
  it('pads a small cell crop up to the model minimum (280 px per side)', async () => {
    const { MagickRefineRenderer } = await import('../../../__app_modules/media/media/server/adapters/content-filter/MagickRefineRenderer.mjs');
    const { execFileSync } = await import('child_process');
    const dir = mkdtempSync(path.join(tmpdir(), 'cf-img-'));
    const src = path.join(dir, 'f.png');
    execFileSync(resolveMagick(), ['-size', '1280x720', 'xc:gray', src]);
    const png = await new MagickRefineRenderer().cellCrop(readFileSync(src), { grid: 6, cell: 0 });
    const out = path.join(dir, 'o.png'); writeFileSync(out, png);
    const dims = execFileSync(resolveMagick() === 'magick' ? 'magick' : 'identify', resolveMagick() === 'magick' ? [out, '-format', '%w %h', 'info:'] : ['-format', '%w %h', out]).toString().trim();
    const [w, h] = dims.split(' ').map(Number);
    expect(w).toBeGreaterThanOrEqual(280);
    expect(h).toBeGreaterThanOrEqual(280);
  });
});
