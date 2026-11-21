/**
 * addressMap — per-system CPU-address → system-RAM-buffer offset translation.
 *
 * Adding a new system is a single entry in RAM_REGIONS: the inclusive CPU
 * address range that maps linearly onto the emulator's RAM buffer, with
 * offset 0 at `base`.
 */

/**
 * Regions per system. `ram` is the core's SYSTEM_RAM buffer (offset 0 at `base`).
 * `sram` is the cartridge save RAM buffer (libretro memory type 0). `mapped`
 * regions are found per address through the core's published memory map
 * (daylight_memory_region_*), so they need no buffer layout assumptions.
 */
const REGIONS = {
  gb: [
    { name: 'ram', base: 0xc000, end: 0xdfff },
    { name: 'sram', base: 0xa000, end: 0xbfff },
    { name: 'hram', base: 0xff80, end: 0xfffe, mapped: true },
  ],
  gbc: [
    { name: 'ram', base: 0xc000, end: 0xdfff },
    { name: 'sram', base: 0xa000, end: 0xbfff },
    { name: 'hram', base: 0xff80, end: 0xfffe, mapped: true },
  ],
  // Mega Drive/Genesis: 68000 work RAM at 0xFF0000-0xFFFFFF (64 KiB).
  genesis: [{ name: 'ram', base: 0xff0000, end: 0xffffff }],
  // GBA: EWRAM is the core's SYSTEM_RAM; IWRAM comes from the memory map.
  gba: [
    { name: 'ram', base: 0x02000000, end: 0x0203ffff },
    { name: 'iwram', base: 0x03000000, end: 0x03007fff, mapped: true },
  ],
};

/** Which region a CPU address falls in: { name, offset, mapped }. */
export function resolveAddress(system, cpuAddr) {
  const regions = REGIONS[system];
  if (!regions) throw new Error('unknown system');
  const r = regions.find((x) => cpuAddr >= x.base && cpuAddr <= x.end);
  if (!r) throw new Error('address out of range');
  return { name: r.name, offset: cpuAddr - r.base, mapped: r.mapped === true };
}

/**
 * Translate a CPU address to a RAM buffer offset.
 * @param {string} system system key (e.g. 'gb', 'gbc')
 * @param {number} cpuAddr CPU address
 * @returns {number} offset into the system RAM buffer
 */
export function toRamOffset(system, cpuAddr) {
  const r = resolveAddress(system, cpuAddr);
  if (r.name !== 'ram') throw new Error('address out of range');
  return r.offset;
}
