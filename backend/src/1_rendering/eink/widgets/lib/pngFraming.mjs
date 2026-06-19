/**
 * Minimal PNG chunk framing (no dependencies)
 * @module 1_rendering/eink/widgets/lib/pngFraming
 *
 * Shared by the e-ink output encoders (grayscalePng colour-type-0, rgbPng
 * colour-type-2). node-canvas only emits RGBA PNGs, so for the panel's own colour
 * spaces we hand-roll the container: signature + length/type/CRC32-framed chunks.
 * The IDAT deflate stream (with its Adler32) comes from Node's zlib; only the
 * outer PNG framing is done here. ~25 lines — cheaper than a PNG library for these
 * two narrow output paths.
 */

// Standard PNG CRC-32 (polynomial 0xEDB88320), precomputed table. Done locally
// rather than via zlib.crc32 (only present on newer Node) so this works anywhere.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Frame a PNG chunk: length(4) + type(4) + data + CRC32(type+data). */
export function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
