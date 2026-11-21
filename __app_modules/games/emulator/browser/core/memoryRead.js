/**
 * memoryRead — read an interpreted numeric value out of an emulator's RAM heap.
 *
 * The heap is the raw WASM memory (Uint8Array). `wramBase` is the index in the
 * heap where the system's RAM buffer begins; per-system CPU→RAM offset is
 * resolved via addressMap.toRamOffset.
 */

import { toRamOffset } from "./addressMap.js";

/**
 * Systems whose RAM the core stores as host-order 16-bit words. Genesis Plus GX
 * keeps 68k work RAM as native uint16 and reads bytes as BASE[ADDR ^ 1] on a
 * little-endian host (core/macros.h), so the byte the 68k sees at address A sits
 * at buffer offset A ^ 1. The 68k is big-endian, so multi-byte values default
 * to big-endian there: a sidecar writes addresses and widths as the game sees them.
 */
const WORD_SWAPPED = { genesis: true };
const DEFAULT_ENDIAN = { genesis: 'big' };

/**
 * Read and interpret a value from the heap.
 * @param {Uint8Array} heap raw memory view
 * @param {number} wramBase heap index where the system RAM buffer starts
 * @param {string} system system key (e.g. 'gb')
 * @param {object} spec
 * @param {number} spec.addr CPU address
 * @param {number} [spec.size=1] number of bytes to read
 * @param {('little'|'big')} [spec.endian] byte order (default: little; big on Genesis)
 * @param {('bcd')} [spec.decode] optional decode mode
 * @returns {number}
 */
export function readValue(heap, wramBase, system, { addr, size = 1, endian, decode } = {}) {
  const order = endian ?? DEFAULT_ENDIAN[system] ?? 'little';
  const swap = WORD_SWAPPED[system] === true;

  // Collect bytes in CPU address order.
  const bytes = [];
  for (let i = 0; i < size; i++) {
    const offset = toRamOffset(system, addr + i);
    bytes.push(heap[wramBase + (swap ? offset ^ 1 : offset)]);
  }
  const endianOrder = order;

  // Reorder to display order (most-significant first).
  const displayBytes = endianOrder === 'big' ? bytes : bytes.slice().reverse();

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
