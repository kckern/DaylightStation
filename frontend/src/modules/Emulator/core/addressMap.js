/**
 * addressMap — per-system CPU-address → system-RAM-buffer offset translation.
 *
 * Adding a new system is a single entry in RAM_REGIONS: the inclusive CPU
 * address range that maps linearly onto the emulator's RAM buffer, with
 * offset 0 at `base`.
 */

const RAM_REGIONS = {
  // Game Boy / Game Boy Color: WRAM at 0xC000–0xDFFF.
  gb: { base: 0xc000, end: 0xdfff },
  gbc: { base: 0xc000, end: 0xdfff },
};

/**
 * Translate a CPU address to a RAM buffer offset.
 * @param {string} system system key (e.g. 'gb', 'gbc')
 * @param {number} cpuAddr CPU address
 * @returns {number} offset into the system RAM buffer
 */
export function toRamOffset(system, cpuAddr) {
  const region = RAM_REGIONS[system];
  if (!region) throw new Error('unknown system');
  if (cpuAddr < region.base || cpuAddr > region.end) {
    throw new Error('address out of range');
  }
  return cpuAddr - region.base;
}
