import os from 'node:os';
import path from 'node:path';
import { deleteFile, writeBinary } from '#system/utils/FileIO.mjs';
import { IImagePrintGateway } from '#apps/gratitude/ports/IImagePrintGateway.mjs';

/** Bridges image bytes to path-based printer drivers through a scoped temporary artifact. */
export class TemporaryImagePrintGateway extends IImagePrintGateway {
  constructor({ clock = Date.now } = {}) {
    super();
    this.clock = clock;
  }

  async print(printer, { buffer, ...options }) {
    const temporaryPath = path.join(os.tmpdir(), `gratitude_card_${this.clock()}.png`);
    writeBinary(temporaryPath, buffer);
    try {
      return await printer.print(printer.createImagePrint(temporaryPath, options));
    } finally {
      try { deleteFile(temporaryPath); } catch { /* best-effort cleanup */ }
    }
  }
}

export default TemporaryImagePrintGateway;
