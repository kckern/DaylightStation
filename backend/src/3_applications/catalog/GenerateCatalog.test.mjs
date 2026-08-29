import { describe, expect, it, vi } from 'vitest';
import { createGenerateCatalog } from './GenerateCatalog.mjs';

function operation({ items = [{ id: 'one' }], generateQRCode = vi.fn(async () => '<svg/>') } = {}) {
  return createGenerateCatalog({
    createContentExpression: vi.fn((value) => value),
    listSource: { getList: vi.fn(async () => ({ title: 'Family', items })) },
    generateQRCode,
    renderPdf: vi.fn(async () => Buffer.from('pdf')),
    logger: { warn: vi.fn() },
  });
}

describe('GenerateCatalog', () => {
  it('returns semantic success data without an HTTP status or envelope', async () => {
    const result = await operation()({ source: 'plex', id: '1', expression: { screen: null, options: {} } });
    expect(result).toEqual({ kind: 'generated', value: { title: 'Family', pdf: Buffer.from('pdf') } });
    expect(result).not.toHaveProperty('status');
  });

  it('returns semantic empty and render-unavailable outcomes', async () => {
    expect(await operation({ items: [] })({ source: 'plex', id: '1', expression: { screen: null, options: {} } })).toEqual({ kind: 'empty' });
    expect(await operation({ generateQRCode: vi.fn(async () => { throw new Error('offline'); }) })({ source: 'plex', id: '1', expression: { screen: null, options: {} } }))
      .toEqual({ kind: 'render_unavailable' });
  });
});
