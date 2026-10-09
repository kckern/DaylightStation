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
