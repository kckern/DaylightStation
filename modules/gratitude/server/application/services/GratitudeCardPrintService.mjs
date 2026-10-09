/** Resolves a household printer and submits a generated gratitude-card image. */
export class GratitudeCardPrintService {
  constructor({ printerRegistry, imagePrintGateway }) {
    if (!printerRegistry?.resolve) throw new Error('GratitudeCardPrintService requires printerRegistry');
    if (!imagePrintGateway?.print) throw new Error('GratitudeCardPrintService requires imagePrintGateway');
    this.printerRegistry = printerRegistry;
    this.imagePrintGateway = imagePrintGateway;
  }

  prepare(location) {
    let printer;
    try { printer = this.printerRegistry.resolve(location); }
    catch (error) { return { kind: 'printer_not_found', message: error.message }; }
    return {
      kind: 'ready',
      print: async ({ buffer, width, height }) => {
        const outcome = await this.imagePrintGateway.print(printer, {
          buffer, width, height, align: 'left', threshold: 128,
        });
        return { kind: 'completed', success: outcome === true || outcome?.verified === true };
      },
    };
  }
}

export default GratitudeCardPrintService;
