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
  signature = DEFAULT_SIGNATURE,
  logger,
} = {}) {
  const warn = logger && typeof logger.warn === 'function'
    ? logger.warn.bind(logger)
    : () => {};

  async function calibrate() {
    // 1. Ping: write each signature byte to scratchAddr + i.
    for (let i = 0; i < signature.length; i++) {
      const code = gameSharkCode(signature[i], scratchAddr + i);
      setCheat(i, 1, code);
    }

    // 2. Let frames run so the cheats apply.
    await waitFrames();

    // 3. Scan the live heap for the signature.
    const heap = getHeap();
    const matches = findSignatureMatches(heap, signature);

    // 4. Remove the ping (always, even on failure).
    resetCheat();

    // 5. Resolve.
    if (matches.length === 1) {
      const matchIndex = matches[0];
      const wramBase = matchIndex - (scratchAddr - SCRATCH_BASE);
      return { wramBase, matchIndex };
    }

    warn('wram-calibrate-ambiguous', {
      matches: matches.length,
      system,
      scratchAddr,
    });
    return null;
  }

  return { calibrate };
}
