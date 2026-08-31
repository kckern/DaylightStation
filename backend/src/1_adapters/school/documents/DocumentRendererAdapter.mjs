import { IDocumentRenderer } from '#apps/school/ports/IDocumentRenderer.mjs';

function documentArtifact(bytes) {
  return Object.freeze({
    printWith(printer, options) {
      return printer.printPdf(bytes, options);
    },
    async retainWith(store, metadata) {
      if (!store) return this;
      const retained = await store.put({ ...metadata, bytes });
      return documentArtifact(retained.bytes);
    },
  });
}

/** Adapts a rendering-layer implementation to the school application port. */
export class DocumentRendererAdapter extends IDocumentRenderer {
  #renderer;

  constructor({ renderer }) {
    super();
    if (!renderer || typeof renderer.render !== 'function') {
      throw new TypeError('DocumentRendererAdapter requires renderer.render');
    }
    this.#renderer = renderer;
  }

  async render(document, opts) {
    const rendered = await this.#renderer.render(document, opts);
    return {
      artifact: documentArtifact(rendered.pdf),
      pageCount: rendered.pageCount,
      formMap: rendered.formMap ?? null,
    };
  }
}

/** Owns raw thermal job shapes and guarantees raster scratch cleanup. */
export class ReceiptRendererAdapter {
  #renderer;

  constructor({ renderer }) {
    if (!renderer || typeof renderer.render !== 'function') {
      throw new TypeError('ReceiptRendererAdapter requires renderer.render');
    }
    this.#renderer = renderer;
  }

  async render(document, opts) {
    const job = await this.#renderer.render(document, opts);
    return Object.freeze({
      async printWith(printer, options = {}) {
        try {
          return await printer.print({
            ...job,
            ...(options.jobName ? { jobName: options.jobName } : {}),
          });
        } finally {
          try { await job.cleanup?.(); } catch { /* scratch cleanup is best effort */ }
        }
      },
    });
  }
}

export default DocumentRendererAdapter;
