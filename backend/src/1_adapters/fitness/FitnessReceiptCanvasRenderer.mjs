/** Rendering-boundary adapter for the legacy fitness receipt image. */
export class FitnessReceiptCanvasRenderer {
  constructor({ renderer, theme, resolveDisplayName, serializeSession, preparePresentation } = {}) {
    if (!renderer?.createCanvas || !theme || typeof resolveDisplayName !== 'function'
      || typeof serializeSession !== 'function' || typeof preparePresentation !== 'function') {
      throw new Error('FitnessReceiptCanvasRenderer requires renderer, theme, resolver, serializer, and presenter');
    }
    this.renderer = renderer;
    this.theme = theme;
    this.resolveDisplayName = resolveDisplayName;
    this.serializeSession = serializeSession;
    this.preparePresentation = preparePresentation;
  }

  createCanvas(session, upsideDown = false) {
    const model = this.preparePresentation(this.serializeSession(session), {
      resolveDisplayName: this.resolveDisplayName,
      targetRows: this.theme.chart.downsampleTarget,
      zoneSymbolMap: this.theme.chart.zoneSymbolMap,
      eventSymbols: this.theme.chart.eventSymbols,
      histogramBuckets: this.theme.leaderboard.histogramBuckets,
    });
    return this.renderer.createCanvas(model, upsideDown);
  }
}

export default FitnessReceiptCanvasRenderer;
