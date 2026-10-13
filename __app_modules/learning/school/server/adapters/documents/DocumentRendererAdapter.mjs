import { IDocumentRenderer } from "../../application/ports/IDocumentRenderer.mjs";

function documentArtifact(bytes, replay = {}) {
  return Object.freeze({
    printWith(printer, options) {
      return printer.printPdf(bytes, options);
    },
    async retainWith(store, metadata) {
      if (!store) return this;
      await store.put({
        ...metadata,
        bytes,
        sourceDocument: metadata.sourceDocument ?? replay.sourceDocument ?? null,
        renderContext: metadata.renderContext ?? replay.renderContext ?? null,
      });
      // Retention records the recipe. This in-memory render is still the one
      // dispatched by the current issue call; the store does not need to hand
      // the disposable PDF bytes back.
      return documentArtifact(bytes, replay);
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
      artifact: documentArtifact(rendered.pdf, { sourceDocument: document, renderContext: opts ?? {} }),
      pageCount: rendered.pageCount,
      formMap: rendered.formMap ?? null,
    };
  }
}


export default DocumentRendererAdapter;
