import { describe, it, expect } from 'vitest';
import { createCatalogRenderer } from '#rendering/catalog/CatalogRenderer.mjs';

describe('CatalogRenderer', () => {
  it('produces a valid PDF buffer from title + PNG buffers', async () => {
    const renderer = createCatalogRenderer();

    // Create a minimal 1x1 red PNG (smallest valid PNG)
    const sharp = (await import('sharp')).default;
    const pngBuf = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).png().toBuffer();

    const pdfBytes = await renderer.render({
      title: 'Test Catalog',
      images: [pngBuf, pngBuf, pngBuf, pngBuf],
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(100);

    // PDF magic bytes: %PDF
    const header = String.fromCharCode(...pdfBytes.slice(0, 4));
    expect(header).toBe('%PDF');
  });

  it('creates multiple pages when items exceed 15', async () => {
    const renderer = createCatalogRenderer();
    const sharp = (await import('sharp')).default;
    const pngBuf = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 0, g: 0, b: 255 } }
    }).png().toBuffer();

    // 16 items = 2 pages (15 per page)
    const images = Array(16).fill(pngBuf);

    const pdfBytes = await renderer.render({
      title: 'Multi Page',
      images,
    });

    // Parse with pdf-lib to check page count
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(2);
  });
});
