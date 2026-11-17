/** Semantic owner boundary: Work cannot access Lifelog persistence internals. */
export class KnowledgeWorkBridge {
  #backfill;
  constructor({
    backfill
  }) {
    this.#backfill = backfill;
  }
  async previewImport(input) {
    const prepared = input.manifest ? {
      manifest: input.manifest
    } : await this.#backfill.prepare(input);
    return {
      ...prepared,
      ...(await this.#backfill.resume({
        manifest: prepared.manifest,
        usageDir: input.usageDir
      }))
    };
  }
  commitImport(input) {
    return this.#backfill.commit(input);
  }
}
