/** Capture a frozen result receipt before it reaches the thermal printer. */
export class CaptureResultReceiptArtifact {
  #artifacts; #renderReceipt; #logger;

  constructor({ issuedArtifacts, renderReceipt, logger = console } = {}) {
    if (!issuedArtifacts) throw new Error('CaptureResultReceiptArtifact requires issuedArtifacts');
    if (typeof renderReceipt !== 'function') throw new Error('CaptureResultReceiptArtifact requires renderReceipt');
    this.#artifacts = issuedArtifacts;
    this.#renderReceipt = renderReceipt;
    this.#logger = logger;
  }

  async execute({ artifactId, sessionId, learnerId, unitId, kind = 'result-receipt',
    document, issuedAt, parentArtifactIds = [] } = {}) {
    const existing = await this.#artifacts.get(artifactId);
    if (existing) return { artifact: existing, created: false };
    // Clone before crossing the rendering boundary. The receipt document is
    // the factual snapshot; no future review note, timezone, or token lookup
    // may alter what teacher history calls this original receipt.
    const sourceDocument = structuredClone(document);
    const rendered = await this.#renderReceipt(sourceDocument);
    if (!Buffer.isBuffer(rendered?.bytes)) throw new Error('receipt renderer did not return PNG bytes');
    const artifact = await this.#artifacts.put({
      artifactId, bytes: rendered.bytes, issuedAt, sessionId, learnerId, unitId,
      kind, captureKind: 'original', sourceDocument,
      representation: { mediaType: 'image/png', extension: 'png', width: rendered.width ?? null, height: rendered.height ?? null },
      parentArtifactIds,
      document: { id: sourceDocument.id, title: sourceDocument.title ?? 'Worksheet Result' },
      renderContext: { target: 'receipt', renderer: 'thermal-raster' },
    });
    this.#logger.info?.('school.result-receipt.captured', { artifactId, sessionId, kind });
    return { artifact, created: true };
  }
}

export default CaptureResultReceiptArtifact;
