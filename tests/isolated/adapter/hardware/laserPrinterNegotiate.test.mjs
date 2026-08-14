import { describe, it, expect } from 'vitest';
import { chooseDocumentFormat, chooseResolution, RASTER_FORMATS, FALLBACK_DPI } from '../../../../backend/src/1_adapters/hardware/laser-printer/negotiate.mjs';

describe('chooseDocumentFormat', () => {
  it('a printer that advertises PDF directly gets the PDF, unrasterized', () => {
    const chosen = chooseDocumentFormat({
      payloadFormat: 'application/pdf',
      supported: ['application/octet-stream', 'application/pdf'],
      preferred: 'application/pdf',
    });
    expect(chosen).toEqual({ format: 'application/pdf', needsRasterize: false });
  });

  it('a printer advertising only urf/pwg-raster gets rasterized bytes, preferring document-format-preferred', () => {
    const chosen = chooseDocumentFormat({
      payloadFormat: 'application/pdf',
      supported: ['application/octet-stream', 'image/urf', 'image/pwg-raster'],
      preferred: 'image/urf',
    });
    expect(chosen).toEqual({ format: 'image/urf', needsRasterize: true });
  });

  it('falls back to pwg-raster when preferred is unset but pwg-raster is the only raster format supported', () => {
    const chosen = chooseDocumentFormat({
      payloadFormat: 'application/pdf',
      supported: ['application/octet-stream', 'image/pwg-raster'],
      preferred: null,
    });
    expect(chosen).toEqual({ format: 'image/pwg-raster', needsRasterize: true });
  });

  it('ignores a document-format-preferred we cannot produce and falls back to our own raster preference order', () => {
    const chosen = chooseDocumentFormat({
      payloadFormat: 'application/pdf',
      supported: ['image/urf', 'image/pwg-raster'],
      preferred: 'application/vnd.hp-PCL', // not in RASTER_FORMATS, not producible
    });
    expect(chosen.format).toBe(RASTER_FORMATS[0]);
    expect(chosen.needsRasterize).toBe(true);
  });

  it('a printer advertising neither PDF nor a raster format we can produce is refused: returns null', () => {
    // This is the exact shape of the incident: document-format-supported
    // contains ONLY application/octet-stream. Trusting that as "anything
    // goes" is what printed a PDF's own source as plain text.
    const chosen = chooseDocumentFormat({
      payloadFormat: 'application/pdf',
      supported: ['application/octet-stream'],
      preferred: null,
    });
    expect(chosen).toBeNull();
  });

  it('a printer advertising nothing at all is refused: returns null', () => {
    const chosen = chooseDocumentFormat({ payloadFormat: 'application/pdf', supported: [], preferred: null });
    expect(chosen).toBeNull();
  });

  it('never treats application/octet-stream as a direct match, even when it is literally the payload format', () => {
    const chosen = chooseDocumentFormat({
      payloadFormat: 'application/octet-stream',
      supported: ['application/octet-stream'],
      preferred: null,
    });
    expect(chosen).toBeNull();
  });
});

describe('chooseResolution', () => {
  it('picks 300dpi from printer-resolution-supported when it is on offer', () => {
    const dpi = chooseResolution({
      printerResolutionSupported: [{ xres: 600, yres: 600, units: 3 }, { xres: 300, yres: 300, units: 3 }],
      urfSupported: [],
    });
    expect(dpi).toBe(300);
  });

  it('picks the lowest advertised resolution when 300 is not offered', () => {
    const dpi = chooseResolution({
      printerResolutionSupported: [{ xres: 1200, yres: 1200, units: 3 }, { xres: 600, yres: 600, units: 3 }],
      urfSupported: [],
    });
    expect(dpi).toBe(600);
  });

  it('falls back to parsing urf-supported RS tokens when no structured resolution attribute is present', () => {
    const dpi = chooseResolution({ printerResolutionSupported: [], urfSupported: ['V1.4', 'RS300-600', 'SRGB24'] });
    expect(dpi).toBe(300);
  });

  it('falls back to FALLBACK_DPI when nothing parseable is offered', () => {
    const dpi = chooseResolution({ printerResolutionSupported: [], urfSupported: [] });
    expect(dpi).toBe(FALLBACK_DPI);
  });

  it('ignores non-dpi (dots/cm) resolution entries', () => {
    const dpi = chooseResolution({
      printerResolutionSupported: [{ xres: 118, yres: 118, units: 4 }], // dots/cm — not dpi
      urfSupported: [],
    });
    expect(dpi).toBe(FALLBACK_DPI);
  });
});
