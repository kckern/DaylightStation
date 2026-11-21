/**
 * WramCalibrator — locate the WASM-memory base of a Game Boy emulator's WRAM
 * ONCE at boot, via a harmless cheat "ping".
 *
 * EmulatorJS doesn't export a RAM pointer, but `Module.HEAPU8` (the whole WASM
 * memory) is reachable. We write a unique multi-byte signature into a WRAM
 * scratch region using the GameShark cheat API, let a few frames run so the
 * cheats apply, then scan HEAPU8 for the signature. Exactly one match yields
 * the base; the cheat is then removed and all future detection is pure reads.
 *
 * Two matches happen when the scratch page is the game's OAM source: Super
 * Mario Land keeps its sprite table at $C000-$C09F and copies it into OAM every
 * frame, so the signature appears in WRAM and in the core's OAM copy. With more
 * than one scratch address (`scratchAddrs`, from the game's sidecar), the
 * calibrator pings the next address on another page and keeps only the base
 * both pings agree on: OAM copies one page, WRAM holds them all. The bytes under
 * every ping after the first are put back once the base is known.
 *
 * All I/O is injected so this is unit-testable with NO real emulator.
 */

const SCRATCH_BASE = 0xc000; // WRAM base CPU address (offset 0)

/** Default 32-byte distinctive signature (varied, not a uniform run). */
export const DEFAULT_SIGNATURE = Uint8Array.from(
  { length: 32 },
  (_, i) => (i * 7 + 0x4d) & 0xff,
);

/**
 * Build a GB GameShark write code: `'01' + dataHex + leAddrHex`, UPPERCASED.
 * dataHex = the byte (2 hex). leAddrHex = the CPU address little-endian
 * (low byte then high byte, 4 hex). Lowercase is silently rejected by the
 * cheat engine, so the whole string is uppercased.
 * @param {number} dataByte byte value 0..255
 * @param {number} cpuAddr CPU address 0..0xFFFF
 * @returns {string}
 */
export function gameSharkCode(dataByte, cpuAddr) {
  const data = (dataByte & 0xff).toString(16).padStart(2, '0');
  const lo = (cpuAddr & 0xff).toString(16).padStart(2, '0');
  const hi = ((cpuAddr >> 8) & 0xff).toString(16).padStart(2, '0');
  return `01${data}${lo}${hi}`.toUpperCase();
}

/**
 * Find every starting index where `signature` occurs as a subsequence of `heap`.
 * @param {Uint8Array} heap
 * @param {Uint8Array|number[]} signature
 * @returns {number[]} match indices
 */
function findSignatureMatches(heap, signature) {
  const matches = [];
  const n = signature.length;
  if (n === 0 || heap.length < n) return matches;
  const first = signature[0];
  const limit = heap.length - n;
  for (let i = 0; i <= limit; i++) {
    if (heap[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < n; j++) {
      if (heap[i + j] !== signature[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }
  return matches;
}

/**
 * Create a WRAM calibrator.
 * @param {object} deps
 * @param {(index:number, enabled:number, code:string)=>void} deps.setCheat
 * @param {()=>void} deps.resetCheat
 * @param {()=>Uint8Array} deps.getHeap re-fetch the live HEAPU8
 * @param {()=>Promise<void>} deps.waitFrames resolves once cheats have landed
 * @param {string} [deps.system='gb']
 * @param {number} [deps.scratchAddr=0xC080] CPU address to ping
 * @param {number[]} [deps.scratchAddrs] ping these in order until one base remains
 *   (overrides scratchAddr). Each must be safe for the game to have 32 bytes
 *   written into for a few frames; the sidecar names them per game.
 * @param {Uint8Array} [deps.signature=DEFAULT_SIGNATURE]
 * @param {{warn?:Function}} [deps.logger] optional logger (no-op default)
 */
export function createWramCalibrator({
  setCheat,
  resetCheat,
  getHeap,
  waitFrames,
  system = 'gb',
  scratchAddr = 0xc080,
  scratchAddrs = null,
  signature = DEFAULT_SIGNATURE,
  logger,
} = {}) {
  const warn = logger && typeof logger.warn === 'function'
    ? logger.warn.bind(logger)
    : () => {};
  const info = logger && typeof logger.info === 'function'
    ? logger.info.bind(logger)
    : () => {};

  const addrs = Array.isArray(scratchAddrs) && scratchAddrs.length ? scratchAddrs : [scratchAddr];

  /**
   * Write the signature at `addr` via cheats, let it land, scan, remove.
   * Throws ENOFRAMES when the emulator ran no frames (a stalled boot): the
   * cheats never applied, so an empty scan says nothing about the heap and
   * must not be reported as a failed calibration. The caller can retry.
   */
  async function ping(addr) {
    for (let i = 0; i < signature.length; i++) {
      setCheat(i, 1, gameSharkCode(signature[i], addr + i));
    }
    const framesRan = await waitFrames();
    if (framesRan === false) {
      resetCheat();
      throw Object.assign(new Error('no emulator frames ran during calibration'), { code: 'ENOFRAMES' });
    }
    const matches = findSignatureMatches(getHeap(), signature);
    resetCheat(); // always, even on failure
    return matches;
  }

  async function calibrate() {
    let candidates = null; // possible WRAM bases
    const restores = []; // { addr, saved: Map<base, Uint8Array> } for pings after the first
    for (const addr of addrs) {
      const offset = addr - SCRATCH_BASE;
      // Remember what is under this ping at every candidate base, so it can be
      // put back (the first ping has no candidates yet).
      if (candidates) {
        const heap = getHeap();
        const saved = new Map(candidates.map((b) => [b, heap.slice(b + offset, b + offset + signature.length)]));
        restores.push({ offset, saved });
      }
      const matches = await ping(addr);
      const bases = matches.map((m) => m - offset);
      candidates = candidates ? candidates.filter((b) => bases.includes(b)) : bases;
      if (candidates.length <= 1) break;
    }

    if (candidates && candidates.length === 1) {
      const wramBase = candidates[0];
      const heap = getHeap();
      for (const { offset, saved } of restores) {
        const bytes = saved.get(wramBase);
        if (bytes) heap.set(bytes, wramBase + offset);
      }
      info('wram-calibrate-ok', { wramBase, matchIndex: wramBase + (addrs[0] - SCRATCH_BASE), system, pings: restores.length + 1 });
      return { wramBase, matchIndex: wramBase + (addrs[0] - SCRATCH_BASE) };
    }

    warn('wram-calibrate-ambiguous', {
      matches: candidates ? candidates.length : 0,
      system,
      scratchAddr: addrs[0],
      scratchAddrs: addrs,
    });
    return null;
  }

  return { calibrate };
}
