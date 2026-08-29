import { describe, expect, it, vi } from 'vitest';
import { createGenerateCatalog } from '#apps/catalog/GenerateCatalog.mjs';

const expression = { screen: 'kitchen', options: { shuffle: true } };
const createContentExpression = vi.fn((value) => value);

describe('GenerateCatalog', () => {
  it('preserves upstream list status and empty-list envelopes', async () => {
    const unavailable = createGenerateCatalog({
      createContentExpression,
      listSource: { getList: async () => { const error = new Error('rejected'); error.code = 'catalog_list_source_rejected'; error.status = 503; throw error; } },
      generateQRCode: vi.fn(), renderPdf: vi.fn(),
    });
    await expect(unavailable({ source: 'plex', id: '1', expression })).rejects.toMatchObject({
      code: 'catalog_list_source_rejected', status: 503,
    });

    const empty = createGenerateCatalog({
      createContentExpression,
      listSource: { getList: async () => ({ title: 'Empty', items: [] }) },
      generateQRCode: vi.fn(), renderPdf: vi.fn(),
    });
    await expect(empty({ source: 'plex', id: '1', expression })).resolves.toEqual({ kind: 'empty' });
  });

  it('renders successful QR results while preserving partial-failure degradation', async () => {
    const generateQRCode = vi.fn()
      .mockResolvedValueOnce('<svg id="one"/>')
      .mockRejectedValueOnce(new Error('thumbnail failed'));
    const renderPdf = vi.fn(async () => Buffer.from('pdf'));
    const generate = createGenerateCatalog({
      createContentExpression,
      listSource: { getList: async () => ({ title: 'My List', items: [{ id: 'a' }, { id: 'b' }] }) },
      generateQRCode, renderPdf, logger: { warn() {} },
    });
    await expect(generate({ source: 'plex', id: '1', expression })).resolves.toEqual({
      kind: 'generated', value: { title: 'My List', pdf: Buffer.from('pdf') },
    });
    expect(generateQRCode).toHaveBeenCalledWith({
      expression: { action: 'queue', contentId: 'a', options: { shuffle: true }, screen: 'kitchen' },
    });
    expect(renderPdf).toHaveBeenCalledWith(expect.objectContaining({ title: 'My List', svgs: ['<svg id="one"/>'] }));
  });

  it('preserves the all-QR-failures 500 result', async () => {
    const generate = createGenerateCatalog({
      createContentExpression,
      listSource: { getList: async () => ({ title: undefined, items: [{ id: 'a' }] }) },
      generateQRCode: async () => { throw new Error('failed'); },
      renderPdf: vi.fn(), logger: { warn() {} },
    });
    await expect(generate({ source: 'plex', id: '1', expression })).resolves.toEqual({ kind: 'render_unavailable' });
  });
});
