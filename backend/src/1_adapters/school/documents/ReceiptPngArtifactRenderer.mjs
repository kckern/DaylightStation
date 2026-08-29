/** Adapts the canvas receipt renderer to immutable PNG artifact bytes. */
export class ReceiptPngArtifactRenderer {
  constructor({ renderer } = {}) {
    if (!renderer?.createCanvas) throw new Error('ReceiptPngArtifactRenderer requires renderer');
    this.renderer = renderer;
  }

  render = async (document) => {
    const rendered = await this.renderer.createCanvas(document);
    return {
      bytes: rendered.canvas.toBuffer('image/png'),
      width: rendered.width,
      height: rendered.height,
    };
  };
}
