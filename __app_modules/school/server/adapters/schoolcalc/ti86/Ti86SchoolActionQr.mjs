import { createQrCodeMatrix } from '#system/utils/QRCodeMatrix.mjs';

export const TI86_ACTION_QR_MODULES = 21;
export const TI86_ACTION_QR_ROW_BYTES = 3;
export const TI86_ACTION_QR_BYTES = TI86_ACTION_QR_MODULES * TI86_ACTION_QR_ROW_BYTES;
const ACTION_TOKEN = /^sch:[2-9A-HJ-NP-Z]{16}$/;

/**
 * Compile an opaque School action token into row-major QR modules. The TI-86
 * expands each bit to 2×2 pixels and supplies the four-module quiet zone, so
 * an artifact spends 63 bytes rather than a 1,024-byte framebuffer.
 */
export function encodeTi86SchoolActionQr(token) {
  if (!ACTION_TOKEN.test(token || '')) throw new Error('TI-86 action QR requires an opaque 16-character sch: token');
  const qr = createQrCodeMatrix([
    { data: 'sch:', mode: 'byte' },
    { data: token.slice(4), mode: 'alphanumeric' },
  ], { version: 1, errorCorrectionLevel: 'L' });
  if (qr.version !== 1 || qr.size !== TI86_ACTION_QR_MODULES) {
    throw new Error('TI-86 action QR must remain Version 1/EC-L');
  }
  const packed = Buffer.alloc(TI86_ACTION_QR_BYTES);
  for (let y = 0; y < TI86_ACTION_QR_MODULES; y += 1) {
    for (let x = 0; x < TI86_ACTION_QR_MODULES; x += 1) {
      if (qr.modules[(y * qr.size) + x]) {
        packed[y * TI86_ACTION_QR_ROW_BYTES + (x >>> 3)] |= 0x80 >>> (x & 7);
      }
    }
  }
  return packed;
}

export function readTi86SchoolActionQrModule(packed, x, y) {
  if ((!Buffer.isBuffer(packed) && !(packed instanceof Uint8Array))
    || packed.byteLength !== TI86_ACTION_QR_BYTES
    || !Number.isInteger(x) || x < 0 || x >= TI86_ACTION_QR_MODULES
    || !Number.isInteger(y) || y < 0 || y >= TI86_ACTION_QR_MODULES) {
    throw new Error('TI-86 action QR module lookup is out of range');
  }
  return Boolean(packed[y * TI86_ACTION_QR_ROW_BYTES + (x >>> 3)] & (0x80 >>> (x & 7)));
}

export default encodeTi86SchoolActionQr;
