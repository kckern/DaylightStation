/**
 * memoryRead — read an interpreted numeric value out of an emulator's RAM heap.
 *
 * The heap is the raw WASM memory (Uint8Array). `wramBase` is the index in the
 * heap where the system's RAM buffer begins; per-system CPU→RAM offset is
 * resolved via addressMap.toRamOffset.
 */

import { toRamOffset } from './addressMap.js';

/**
 * Read and interpret a value from the heap.
 * @param {Uint8Array} heap raw memory view
 * @param {number} wramBase heap index where the system RAM buffer starts
 * @param {string} system system key (e.g. 'gb')
 * @param {object} spec
 * @param {number} spec.addr CPU address
 * @param {number} [spec.size=1] number of bytes to read
 * @param {('little'|'big')} [spec.endian='little'] byte order
 * @param {('bcd')} [spec.decode] optional decode mode
 * @returns {number}
 */
export function readValue(heap, wramBase, system, { addr, size = 1, endian = 'little', decode } = {}) {
  const offset = toRamOffset(system, addr);
  const start = wramBase + offset;

  // Collect bytes in heap order.
  const bytes = [];
  for (let i = 0; i < size; i++) {
    bytes.push(heap[start + i]);
  }

  // Reorder to display order (most-significant first).
  const displayBytes = endian === 'big' ? bytes : bytes.slice().reverse();

  if (decode === 'bcd') {
    let acc = 0;
    for (const byte of displayBytes) {
      const hi = (byte >> 4) & 0xf;
      const lo = byte & 0xf;
      acc = acc * 100 + hi * 10 + lo;
    }
    return acc;
  }

  // Raw integer assembly from display order (most-significant first).
  let value = 0;
  for (const byte of displayBytes) {
    value = value * 256 + byte;
  }
  return value;
}
