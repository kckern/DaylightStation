import { describe, it, expect } from 'vitest';
import {
  chooseDocumentFormat, chooseResolution, chooseUrfColor, choosePwgRasterColor,
  negotiatePrintPlan, chooseJobAttributes, RASTER_FORMATS, FALLBACK_DPI,
} from '../../../../backend/src/1_adapters/hardware/laser-printer/negotiate.mjs';

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

describe('chooseResolution (format-aware — incident #2)', () => {
  it('for image/urf, reads the RS token off urf-supported — not printer-resolution-supported', () => {
    const dpi = chooseResolution({
      format: 'image/urf',
      urfSupported: ['V1.4', 'RS300-600', 'SRGB24'],
      printerResolutionSupported: [{ xres: 1200, yres: 1200, units: 3 }],
    });
    expect(dpi).toBe(300);
  });

  it('for image/pwg-raster, reads pwg-raster-document-resolution-supported — not urf-supported', () => {
    const dpi = chooseResolution({
      format: 'image/pwg-raster',
      pwgRasterResolutionSupported: [{ xres: 600, yres: 600, units: 3 }],
      urfSupported: ['RS300-600-1200'], // deliberately different — must NOT leak into the pwg-raster answer
    });
    expect(dpi).toBe(600);
  });

  it('the exact incident shape: urf permits 300 while pwg-raster is 600-only — same printer, different answer per format', () => {
    const caps = {
      urfSupported: ['W8', 'RS300-600-1200'],
      pwgRasterResolutionSupported: [{ xres: 600, yres: 600, units: 3 }],
    };
    expect(chooseResolution({ format: 'image/urf', ...caps })).toBe(300);
    expect(chooseResolution({ format: 'image/pwg-raster', ...caps })).toBe(600);
  });

  it('picks the lowest pwg-raster-supported resolution when 300 is not offered for that format', () => {
    const dpi = chooseResolution({
      format: 'image/pwg-raster',
      pwgRasterResolutionSupported: [{ xres: 1200, yres: 1200, units: 3 }, { xres: 600, yres: 600, units: 3 }],
    });
    expect(dpi).toBe(600);
  });

  it('falls back to printer-resolution-supported only when the format-specific list is empty', () => {
    const dpi = chooseResolution({
      format: 'image/pwg-raster',
      pwgRasterResolutionSupported: [],
      printerResolutionSupported: [{ xres: 600, yres: 600, units: 3 }],
    });
    expect(dpi).toBe(600);
  });

  it('falls back to FALLBACK_DPI when nothing parseable is offered anywhere', () => {
    const dpi = chooseResolution({ format: 'image/urf', urfSupported: [], printerResolutionSupported: [] });
    expect(dpi).toBe(FALLBACK_DPI);
  });

  it('ignores non-dpi (dots/cm) resolution entries in the generic fallback', () => {
    const dpi = chooseResolution({
      format: 'image/pwg-raster',
      pwgRasterResolutionSupported: [],
      printerResolutionSupported: [{ xres: 118, yres: 118, units: 4 }], // dots/cm — not dpi
    });
    expect(dpi).toBe(FALLBACK_DPI);
  });
});

describe('chooseUrfColor / choosePwgRasterColor — grayscale-only printer (the Brother HL-L2460DW shape)', () => {
  it('chooseUrfColor parses "W8" into 1-channel, 8-bit grayscale, monochrome print-color-mode', () => {
    const color = chooseUrfColor(['CP1', 'IS4-1', 'MT1-3-4-5-8', 'OB10', 'PQ3-4-5', 'RS300-600-1200', 'V1.5', 'DM1', 'W8']);
    expect(color).toMatchObject({
      token: 'W8', family: 'gray', channels: 1, bitsPerColor: 8, bitsPerPixel: 8, printColorMode: 'monochrome',
    });
  });

  it('choosePwgRasterColor parses "sgray_8" the same way', () => {
    const color = choosePwgRasterColor(['sgray_8']);
    expect(color).toMatchObject({
      token: 'sgray_8', family: 'gray', channels: 1, bitsPerColor: 8, bitsPerPixel: 8, printColorMode: 'monochrome',
    });
  });

  it('a grayscale-only printer never gets an RGB plan even when RGB parses first in the list', () => {
    // Order in the capability list must not matter — gray is preferred
    // whenever it's an option, since that is what this printer's
    // print-color-mode-default ("monochrome") and this app's worksheets want.
    const urf = chooseUrfColor(['SRGB24', 'W8']);
    expect(urf.family).toBe('gray');
    const pwg = choosePwgRasterColor(['srgb_8', 'sgray_8']);
    expect(pwg.family).toBe('gray');
  });

  it('a color-only printer (no gray token at all) still gets a producible plan, not null', () => {
    const color = chooseUrfColor(['SRGB24']);
    expect(color).toMatchObject({ family: 'rgb', channels: 3, bitsPerColor: 8, bitsPerPixel: 24, printColorMode: 'color' });
  });

  it('returns null when nothing in the list parses into a known color family — caller must refuse/fall back', () => {
    expect(chooseUrfColor(['CP1', 'V1.5'])).toBeNull();
    expect(choosePwgRasterColor(['unknownfamily_8'])).toBeNull();
    expect(chooseUrfColor([])).toBeNull();
    expect(choosePwgRasterColor([])).toBeNull();
  });
});

describe('negotiatePrintPlan — the exact Brother HL-L2460DW capability shape from the incident', () => {
  const brotherCaps = {
    payloadFormat: 'application/pdf',
    documentFormatSupported: ['application/octet-stream', 'image/urf', 'image/pwg-raster'],
    documentFormatPreferred: 'image/urf',
    urfSupported: ['W8', 'CP1', 'IS4-1', 'MT1-3-4-5-8', 'OB10', 'PQ3-4-5', 'RS300-600-1200', 'V1.5', 'DM1'],
    pwgRasterDocumentTypeSupported: ['sgray_8'],
    pwgRasterResolutionSupported: [{ xres: 600, yres: 600, units: 3 }],
    media: 'na_letter_8.5x11in',
  };

  it('picks image/urf (the printer\'s own preference), 8-bit grayscale, 300dpi (urf-specific)', () => {
    const plan = negotiatePrintPlan(brotherCaps);
    expect(plan).toMatchObject({
      format: 'image/urf',
      needsRasterize: true,
      raster: {
        dpi: 300, channels: 1, bitsPerColor: 8, bitsPerPixel: 8, printColorMode: 'monochrome', media: 'na_letter_8.5x11in',
      },
    });
  });

  it('falls back to image/pwg-raster when urf-supported has no parseable color token at all', () => {
    const plan = negotiatePrintPlan({ ...brotherCaps, urfSupported: ['CP1', 'RS300-600-1200'] });
    expect(plan.format).toBe('image/pwg-raster');
    expect(plan.raster).toMatchObject({ dpi: 600, channels: 1, bitsPerColor: 8, printColorMode: 'monochrome' });
  });

  it('refuses (returns null) when NEITHER raster format has a parseable color token — the incident-#1-shaped case, generalized to raster', () => {
    const plan = negotiatePrintPlan({ ...brotherCaps, urfSupported: ['CP1'], pwgRasterDocumentTypeSupported: [] });
    expect(plan).toBeNull();
  });

  it('a printer that takes PDF directly needs no raster plan at all', () => {
    const plan = negotiatePrintPlan({
      ...brotherCaps,
      documentFormatSupported: ['application/octet-stream', 'application/pdf'],
      documentFormatPreferred: 'application/pdf',
    });
    expect(plan).toEqual({ format: 'application/pdf', needsRasterize: false });
  });
});

describe('chooseJobAttributes — only ever names what job-creation-attributes-supported confirmed', () => {
  it('includes printer-resolution/print-color-mode/sides/media when the printer lists all four', () => {
    const attrs = chooseJobAttributes({
      jobCreationAttributesSupported: ['printer-resolution', 'print-color-mode', 'sides', 'media', 'copies'],
      dpi: 300, printColorMode: 'monochrome', media: 'na_letter_8.5x11in',
    });
    expect(attrs).toEqual({
      printerResolution: { xres: 300, yres: 300, units: 3 },
      printColorMode: 'monochrome',
      sides: 'one-sided',
      media: 'na_letter_8.5x11in',
    });
  });

  it('omits an attribute the printer never declared support for, even when we have a value for it', () => {
    const attrs = chooseJobAttributes({
      jobCreationAttributesSupported: ['media'], // no printer-resolution/print-color-mode/sides
      dpi: 300, printColorMode: 'monochrome', media: 'na_letter_8.5x11in',
    });
    expect(attrs).toEqual({ media: 'na_letter_8.5x11in' });
  });

  it('omits printer-resolution/print-color-mode when there is no raster-derived value (direct-PDF path)', () => {
    const attrs = chooseJobAttributes({
      jobCreationAttributesSupported: ['printer-resolution', 'print-color-mode', 'media'],
      dpi: null, printColorMode: null, media: 'na_letter_8.5x11in',
    });
    expect(attrs).toEqual({ media: 'na_letter_8.5x11in' });
  });
});
