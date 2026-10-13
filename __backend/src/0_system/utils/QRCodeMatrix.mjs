import QRCode from 'qrcode';

/**
 * Isolate the external QR implementation behind a representation-neutral
 * system utility. Callers receive copied row-major module bits rather than a
 * vendor object, so inner code does not acquire a package-specific API.
 */
export function createQrCodeMatrix(data, options = {}) {
  const code = QRCode.create(data, options);
  const size = code.modules.size;
  const modules = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      modules[(y * size) + x] = code.modules.get(x, y) ? 1 : 0;
    }
  }
  return { version: code.version, size, modules };
}

export default createQrCodeMatrix;
