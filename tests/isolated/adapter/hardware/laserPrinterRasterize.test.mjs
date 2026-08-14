import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { rasterizePdf } from '../../../../backend/src/1_adapters/hardware/laser-printer/rasterize.mjs';

// A minimal-but-valid single-page PDF, built by hand (no pdfkit dependency
// needed for a fixture this small).
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF',
  'latin1',
);

// This adapter's whole fix depends on ghostscript being present in the
// deployed (Alpine) image with working urf/pwgraster devices — confirmed
// separately by building the actual Alpine layer (see the fix report). This
// suite exercises the REAL `gs` binary on whatever host runs it; skip rather
// than fail if this particular host doesn't have one, so the suite stays
// honest about what it did or didn't verify. Must be resolved synchronously
// at collection time — `describe.runIf` reads it before any hook can run.
let hasGs = false;
try {
  execFileSync('gs', ['--version'], { stdio: 'ignore' });
  hasGs = true;
} catch {
  hasGs = false;
}

describe.runIf(hasGs)('rasterizePdf (real ghostscript)', () => {
  it('produces image/urf bytes starting with the UNIRAST magic', async () => {
    const out = await rasterizePdf(MINIMAL_PDF, { format: 'image/urf', dpi: 300, logger: { info() {} } });
    expect(out.subarray(0, 8).toString('latin1')).toBe('UNIRAST\0');
    expect(out.length).toBeGreaterThan(8);
  });

  it('produces image/pwg-raster bytes starting with the RaS2 magic', async () => {
    const out = await rasterizePdf(MINIMAL_PDF, { format: 'image/pwg-raster', dpi: 300, logger: { info() {} } });
    expect(out.subarray(0, 4).toString('latin1')).toBe('RaS2');
    expect(out.length).toBeGreaterThan(4);
  });

  it('rejects a format it has no ghostscript device for', async () => {
    await expect(rasterizePdf(MINIMAL_PDF, { format: 'application/pdf' })).rejects.toThrow(/no ghostscript device/i);
  });

  it('cleans up its temp directory even on failure', async () => {
    const { readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const before = (await readdir(tmpdir())).filter((f) => f.startsWith('laser-print-')).length;
    await expect(rasterizePdf(Buffer.from('not a pdf at all'), { format: 'image/urf' })).rejects.toThrow();
    const after = (await readdir(tmpdir())).filter((f) => f.startsWith('laser-print-')).length;
    expect(after).toBe(before);
  });
});

describe('rasterizePdf without ghostscript on PATH', () => {
  it('surfaces a RASTERIZE_FAILED InfrastructureError rather than hanging or crashing the process', async () => {
    await expect(rasterizePdf(MINIMAL_PDF, { format: 'image/urf', gsBin: '/nonexistent/gs-binary' }))
      .rejects.toThrow(/ghostscript rasterize failed/i);
  });
});
