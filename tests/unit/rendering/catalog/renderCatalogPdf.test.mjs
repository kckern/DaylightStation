import { describe, expect, it } from 'vitest';
import { renderCatalogPdf } from '#rendering/catalog/renderCatalogPdf.mjs';

describe('renderCatalogPdf', () => {
  it('renders a valid PDF buffer from QR SVG input', async () => {
    const pdf = await renderCatalogPdf({
      title: 'Catalog',
      svgs: ['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'],
      logger: { warn() {} },
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
