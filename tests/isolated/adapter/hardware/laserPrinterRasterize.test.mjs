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

  // ── Incident #2 coverage: negotiated container was right, pixel params weren't ──

  it('produces a grayscale (1-channel, 8bpp) image/urf raster for the grayscale-only-printer color plan (W8)', async () => {
    const out = await rasterizePdf(MINIMAL_PDF, {
      format: 'image/urf', dpi: 300, media: 'na_letter_8.5x11in',
      colorParams: { channels: 1, bitsPerColor: 8, cupsColorSpace: 18 }, // negotiate.mjs's chooseUrfColor(['W8', ...]) output shape
      logger: { info() {} },
    });
    expect(out.readUInt8(12)).toBe(8); // bitsPerPixel — 1 channel * 8 bits, not the device's 1-bit default
    expect(out.readUInt32BE(24)).toBe(2550); // width px = round(300 * 612/72) — Letter at 300dpi
    expect(out.readUInt32BE(28)).toBe(3300); // height px = round(300 * 792/72)
    expect(out.readUInt32BE(32)).toBe(300); // resolution
  });

  it('produces a grayscale (1-channel, 8bpp) image/pwg-raster raster at the format-specific 600dpi (sgray_8)', async () => {
    const out = await rasterizePdf(MINIMAL_PDF, {
      format: 'image/pwg-raster', dpi: 600, media: 'na_letter_8.5x11in',
      colorParams: { channels: 1, bitsPerColor: 8, cupsColorSpace: 18 }, // negotiate.mjs's choosePwgRasterColor(['sgray_8']) output shape
      logger: { info() {} },
    });
    expect(out.readUInt32BE(0x184)).toBe(8); // cupsBitsPerColor
    expect(out.readUInt32BE(0x188)).toBe(8); // cupsBitsPerPixel — 1 channel * 8 bits
    expect(out.readUInt32BE(0x178)).toBe(5100); // cupsWidth = round(600 * 612/72)
    expect(out.readUInt32BE(0x17c)).toBe(6600); // cupsHeight = round(600 * 792/72)
    expect(out.readUInt32BE(0x118)).toBe(600); // HWResolution.x
    expect(out.readUInt32BE(0x11c)).toBe(600); // HWResolution.y
    expect(out.readUInt32BE(0x194)).toBe(18); // cupsColorSpace — CUPS_CSPACE_SW / "standard gray"
  });

  it('refuses to return a raster whose actual pixel format disagrees with the negotiated colorParams — never sends unverified bytes a third time', async () => {
    // channels:1 claims a single-channel plan (as if grayscale), but
    // cupsColorSpace:19 is SRGB — ghostscript will actually emit 3 channels /
    // 24 bits per pixel here. This is exactly the class of bug the validator
    // exists to catch: a negotiate.mjs miscalculation (or a future
    // ghostscript version behaving differently) producing bytes that don't
    // match what was decided, rather than a hand-crafted magic-byte failure.
    await expect(rasterizePdf(MINIMAL_PDF, {
      format: 'image/pwg-raster', dpi: 600, media: 'na_letter_8.5x11in',
      colorParams: { channels: 1, bitsPerColor: 8, cupsColorSpace: 19 },
      logger: { info() {} },
    })).rejects.toMatchObject({ code: 'RASTERIZE_PARAM_MISMATCH' });
  });

  it('the mismatch error names the field, expected value, and actual value — not just "mismatch"', async () => {
    await expect(rasterizePdf(MINIMAL_PDF, {
      format: 'image/urf', dpi: 300,
      colorParams: { channels: 1, bitsPerColor: 8, cupsColorSpace: 19 }, // same trick as above, urf container this time
      logger: { info() {} },
    })).rejects.toThrow(/bitsPerPixel: expected 8, got 24/);
  });
});

describe('rasterizePdf without ghostscript on PATH', () => {
  it('surfaces a RASTERIZE_FAILED InfrastructureError rather than hanging or crashing the process', async () => {
    await expect(rasterizePdf(MINIMAL_PDF, { format: 'image/urf', gsBin: '/nonexistent/gs-binary' }))
      .rejects.toThrow(/ghostscript rasterize failed/i);
  });
});
