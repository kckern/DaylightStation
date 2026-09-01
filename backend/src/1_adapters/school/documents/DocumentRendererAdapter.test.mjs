import { describe, expect, it, vi } from 'vitest';
import { DocumentRendererAdapter, ReceiptRendererAdapter } from './DocumentRendererAdapter.mjs';

describe('document rendering adapters', () => {
  it('retains the render recipe while printing the disposable in-memory PDF', async () => {
    const adapter = new DocumentRendererAdapter({
      renderer: { render: async () => ({ pdf: Buffer.from('pdf-v1'), pageCount: 2, formMap: { id: 'fm' } }) },
    });
    const rendered = await adapter.render({ id: 'doc' }, {});
    expect(rendered).toMatchObject({ pageCount: 2, formMap: { id: 'fm' } });
    expect(rendered).not.toHaveProperty('pdf');
    expect(rendered.artifact).not.toHaveProperty('bytes');

    const store = {
      put: vi.fn(async () => ({ manifest: { artifactId: 'art-1' }, bytes: null })),
    };
    const retained = await rendered.artifact.retainWith(store, { artifactId: 'art-1' });
    const printer = { printPdf: vi.fn(async () => ({ confirmed: true })) };
    await retained.printWith(printer, { jobName: 'school-art-1' });

    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'art-1', sourceDocument: { id: 'doc' }, renderContext: {},
    }));
    expect(printer.printPdf.mock.calls[0][0].toString()).toBe('pdf-v1');
  });

  it('owns receipt scratch cleanup even when dispatch fails', async () => {
    const cleanup = vi.fn(async () => {});
    const adapter = new ReceiptRendererAdapter({
      renderer: { render: async () => ({ items: [{ type: 'image' }], cleanup }) },
    });
    const artifact = await adapter.render({ id: 'receipt' });
    const printer = { print: vi.fn(async () => { throw new Error('offline'); }) };

    await expect(artifact.printWith(printer, { jobName: 'school-receipt-receipt' })).rejects.toThrow('offline');
    expect(printer.print).toHaveBeenCalledWith(expect.objectContaining({
      jobName: 'school-receipt-receipt', items: [{ type: 'image' }],
    }));
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
