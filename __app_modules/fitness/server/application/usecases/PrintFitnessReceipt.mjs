/** Generate and print a fitness receipt using an opaque printer resource. */
export class PrintFitnessReceipt {
  constructor({ printerRegistry, createReceiptCanvas, imagePrintGateway }) {
    this.printerRegistry = printerRegistry;
    this.createReceiptCanvas = createReceiptCanvas;
    this.imagePrintGateway = imagePrintGateway;
  }

  async execute({ sessionId, location, upsidedown }) {
    let printer;
    try {
      printer = this.printerRegistry.resolve(location);
    } catch (error) {
      return { kind: 'printer_not_found', error: error.message };
    }
    const result = await this.createReceiptCanvas(sessionId, upsidedown);
    if (!result) return { kind: 'session_not_found' };
    const buffer = result.canvas.toBuffer('image/png');
    const outcome = await this.imagePrintGateway.print(printer, {
      buffer,
      sessionId,
      width: result.width,
      height: result.height,
      align: 'left',
      threshold: 128,
    });
    return { kind: 'printed', success: outcome === true || outcome?.verified === true };
  }
}

export default PrintFitnessReceipt;
