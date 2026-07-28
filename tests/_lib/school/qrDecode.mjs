/**
 * A QR decoder that reads PRINTED PIXELS — no shared code with the writer.
 *
 * WHY THIS EXISTS
 *   `DocumentPdfRenderer` draws the action-box symbol and reports what it drew
 *   in `codeMap`. Every existing assertion about the code reads that report:
 *   module count, dark-module count, position. All of them would still pass if
 *   the draw loop emitted a plausible-looking mess, because the report is
 *   written by the same loop. Nothing had ever pointed a DECODER at the ink.
 *
 * WHY IT IS HAND-WRITTEN
 *   `node_modules` contains two QR WRITERS (`qrcode`, which the renderer uses,
 *   and `qr-image`) and no reader. Adding a decoder dependency for a test was
 *   not on the table, and generating a reference symbol with the other writer
 *   would only compare two encoders — it could not tell you what the printed
 *   symbol SAYS. So this is a decoder: it locates the symbol by its finder
 *   patterns, samples the module grid off the page raster, reads the format
 *   information, removes the data mask, walks the codeword zigzag, and parses
 *   the payload. The renderer's `codeMap` is never consulted.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT
 *   Proves: the printed ink is a well-formed QR symbol whose modules, read by
 *   something that did not draw them, spell the exact token the renderer was
 *   handed — geometry, masking and encoding all correct.
 *   Does NOT prove: that a specific physical scanner will read it off paper at
 *   a given size, contrast or angle. Error correction is not applied here (the
 *   render is pristine, so every codeword is exact); a symbol that decoded only
 *   BECAUSE of error correction would fail here rather than pass, which is the
 *   safe direction for a print gate.
 *
 * SCOPE
 *   Versions 1–6 (21–41 modules) and byte mode, which is what School tokens
 *   produce: they are `sch:` plus 16 characters, and the lowercase prefix rules
 *   out alphanumeric mode. Anything outside that range THROWS by name rather
 *   than guessing.
 *
 * @module tests/_lib/school/qrDecode
 */

/** Format-information BCH(15,5) generator and the mandatory XOR mask. */
const FORMAT_GENERATOR = 0x537;
const FORMAT_XOR = 0x5412;

/** Format bits 4..3 → error-correction level, in the spec's odd order. */
const EC_LEVELS = ['M', 'L', 'H', 'Q'];

/**
 * Error-correction block structure, per version, for the levels School prints.
 * `[blockCount, totalCodewordsPerBlock, dataCodewordsPerBlock][]` — a version
 * with two block groups lists both. Straight from ISO/IEC 18004 table 9.
 */
const EC_BLOCKS = {
  L: { 1: [[1, 26, 19]], 2: [[1, 44, 34]], 3: [[1, 70, 55]], 4: [[1, 100, 80]], 5: [[1, 134, 108]], 6: [[2, 86, 68]] },
  M: { 1: [[1, 26, 16]], 2: [[1, 44, 28]], 3: [[1, 70, 44]], 4: [[2, 50, 32]], 5: [[2, 67, 43]], 6: [[4, 43, 27]] },
  Q: { 1: [[1, 26, 13]], 2: [[1, 44, 22]], 3: [[2, 35, 17]], 4: [[2, 50, 24]], 5: [[2, 33, 15], [2, 34, 16]], 6: [[4, 43, 19]] },
  H: { 1: [[1, 26, 9]], 2: [[1, 44, 16]], 3: [[2, 35, 13]], 4: [[4, 25, 9]], 5: [[2, 33, 11], [2, 34, 12]], 6: [[4, 43, 15]] },
};

/** Alignment-pattern centre coordinates by version (versions 1–6). */
const ALIGNMENT_CENTRES = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

/** The eight data masks, as (row, col) → invert?. */
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** How far a finder's measured run lengths may stray from the ideal 1:1:3:1:1. */
const FINDER_RATIO_TOLERANCE = 0.5;

// ── locating the symbol ───────────────────────────────────────────────────

/** Runs of equal ink value along one row or column. */
function runsAlong(read, length) {
  const runs = [];
  let start = 0;
  let value = read(0);
  for (let i = 1; i < length; i += 1) {
    const next = read(i);
    if (next !== value) {
      runs.push({ value, start, length: i - start });
      value = next;
      start = i;
    }
  }
  runs.push({ value, start, length: length - start });
  return runs;
}

/** Does a five-run window read 1:1:3:1:1 dark-light-dark-light-dark? */
function isFinderRatio(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total < 7) return null;
  const unit = total / 7;
  const slack = unit * FINDER_RATIO_TOLERANCE;
  const wanted = [1, 1, 3, 1, 1];
  for (let i = 0; i < 5; i += 1) {
    if (Math.abs(counts[i] - wanted[i] * unit) > wanted[i] * slack) return null;
  }
  return unit;
}

/** Confirm a horizontal hit by finding the same 1:1:3:1:1 down its centre column. */
function crossCheckVertical(page, centreX, seedY, unit) {
  const { width, height, ink } = page;
  const at = (y) => (y >= 0 && y < height ? ink[y * width + centreX] : 0);
  if (!at(seedY)) return null;

  const limit = unit * 3;
  const counts = [0, 0, 0, 0, 0];
  let y = seedY;
  while (y >= 0 && at(y)) { counts[2] += 1; y -= 1; }
  while (y >= 0 && !at(y) && counts[1] < limit) { counts[1] += 1; y -= 1; }
  while (y >= 0 && at(y) && counts[0] < limit) { counts[0] += 1; y -= 1; }

  y = seedY + 1;
  while (y < height && at(y)) { counts[2] += 1; y += 1; }
  // The centre dark run occupies [centreEnd - counts[2], centreEnd).
  const centreEnd = y;
  while (y < height && !at(y) && counts[3] < limit) { counts[3] += 1; y += 1; }
  while (y < height && at(y) && counts[4] < limit) { counts[4] += 1; y += 1; }

  if (isFinderRatio(counts) === null) return null;
  return centreEnd - counts[2] / 2;
}

/**
 * Locate the three finder patterns on a page.
 * @returns {Array<{x:number, y:number, unit:number}>} centres in pixels
 */
export function findFinderPatterns(page) {
  const { width, height, ink } = page;
  const hits = [];
  for (let y = 0; y < height; y += 1) {
    const rowRuns = runsAlong((i) => ink[y * width + i], width);
    for (let i = 0; i + 4 < rowRuns.length; i += 1) {
      if (rowRuns[i].value !== 1) continue;
      const window = rowRuns.slice(i, i + 5);
      const unit = isFinderRatio(window.map((r) => r.length));
      if (unit === null) continue;
      const centreX = Math.round(window[2].start + window[2].length / 2);
      const centreY = crossCheckVertical(page, centreX, y, unit);
      if (centreY === null) continue;
      hits.push({ x: centreX, y: centreY, unit });
    }
  }

  const clusters = [];
  for (const hit of hits) {
    const near = clusters.find((c) => Math.abs(c.x - hit.x) < hit.unit * 2 && Math.abs(c.y - hit.y) < hit.unit * 2);
    if (near) { near.hits.push(hit); near.x = mean(near.hits, 'x'); near.y = mean(near.hits, 'y'); }
    else clusters.push({ x: hit.x, y: hit.y, hits: [hit] });
  }
  return clusters.map((c) => ({ x: c.x, y: c.y, unit: mean(c.hits, 'unit'), support: c.hits.length }));
}

const mean = (list, key) => list.reduce((a, b) => a + b[key], 0) / list.length;

/**
 * Pick the finder TRIPLES that actually describe symbols.
 *
 * The 1:1:3:1:1 run signature occurs inside a dense data region often enough to
 * produce extra candidates (the fixture's own symbol yields a fourth), so the
 * candidates are filtered by geometry rather than by a support threshold: three
 * real finders sit at the corners of a right isosceles triangle whose legs are
 * `(moduleCount - 7)` modules long, and nothing accidental satisfies that.
 *
 * @returns {Array<Array<{x:number,y:number,unit:number}>>} one triple per symbol
 */
export function selectFinderTriples(candidates) {
  const triples = [];
  const used = new Set();
  for (let a = 0; a < candidates.length; a += 1) {
    for (let b = a + 1; b < candidates.length; b += 1) {
      for (let c = b + 1; c < candidates.length; c += 1) {
        const trio = [candidates[a], candidates[b], candidates[c]];
        if (trio.some((t) => used.has(t))) continue;
        const units = trio.map((t) => t.unit);
        if (Math.max(...units) / Math.min(...units) > 1.15) continue;

        const sides = [
          { d: Math.hypot(trio[0].x - trio[1].x, trio[0].y - trio[1].y), corner: 2 },
          { d: Math.hypot(trio[0].x - trio[2].x, trio[0].y - trio[2].y), corner: 1 },
          { d: Math.hypot(trio[1].x - trio[2].x, trio[1].y - trio[2].y), corner: 0 },
        ].sort((p, q) => p.d - q.d);
        // Two equal legs and a hypotenuse of leg·√2, all within 6%.
        if (sides[0].d <= 0 || Math.abs(sides[1].d - sides[0].d) / sides[0].d > 0.06) continue;
        if (Math.abs(sides[2].d - sides[0].d * Math.SQRT2) / (sides[0].d * Math.SQRT2) > 0.06) continue;

        const unit = mean(trio, 'unit');
        const modules = (sides[0].d + sides[1].d) / 2 / unit + 7;
        if (Math.abs(modules - Math.round(modules)) > 0.4) continue;
        if ((Math.round(modules) - 17) % 4 !== 0 || Math.round(modules) < 21) continue;

        trio.forEach((t) => used.add(t));
        triples.push(trio);
      }
    }
  }
  return triples;
}

// ── reading the grid ──────────────────────────────────────────────────────

/** Majority vote over a small neighbourhood, so one stray pixel cannot flip a module. */
function sampleModule(page, x, y, radius) {
  const { width, height, ink } = page;
  const step = Math.max(1, Math.floor(radius));
  let dark = 0;
  let total = 0;
  for (let dy = -step; dy <= step; dy += 1) {
    for (let dx = -step; dx <= step; dx += 1) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      dark += ink[py * width + px];
      total += 1;
    }
  }
  return total > 0 && dark * 2 > total ? 1 : 0;
}

/**
 * Sample the module matrix of the symbol whose finders are given.
 *
 * The grid is pinned to the symbol's OUTER EDGES, not to the finder centres.
 * A finder centre is only located to about a pixel, and dividing that error
 * across a 14-module baseline leaves a pitch estimate ~0.4% short — enough to
 * walk half a module off by the far corner and read the data region as noise.
 * The outer edges are unambiguous: walking out from a finder centre crosses its
 * dark core, its light ring, then its outer dark ring, and the far side of that
 * last run IS the symbol boundary. Three centres bracket all four sides, and
 * the pitch then follows from a whole span rather than from an estimate.
 *
 * @returns {{size:number, modules:Uint8Array}}
 */
function readModuleMatrix(page, finders) {
  const { width, height, ink } = page;
  const byCorner = [...finders];
  const topLeft = byCorner.reduce((a, b) => (a.x + a.y <= b.x + b.y ? a : b));
  const rest = byCorner.filter((f) => f !== topLeft);
  const topRight = rest.reduce((a, b) => (a.x >= b.x ? a : b));
  const bottomLeft = rest.find((f) => f !== topRight);

  const unitGuess = (finders[0].unit + finders[1].unit + finders[2].unit) / 3;
  const dark = (x, y) => (x >= 0 && y >= 0 && x < width && y < height ? ink[y * width + x] : 0);

  /** Cross core → gap → outer ring, and return the ring's far edge. */
  const walkToBoundary = (from, dx, dy) => {
    let x = Math.round(from.x); let y = Math.round(from.y);
    const limit = unitGuess * 3;
    const advanceWhile = (wanted) => {
      let steps = 0;
      while (dark(x + dx, y + dy) === wanted && steps <= limit) { x += dx; y += dy; steps += 1; }
      return steps;
    };
    if (!dark(x, y)) throw new Error('qrDecode: a located finder centre is not on ink');
    const core = advanceWhile(1);
    const gap = advanceWhile(0);
    const ring = advanceWhile(1);
    if (core > limit || gap > limit || ring > limit || gap === 0 || ring === 0) {
      throw new Error(`qrDecode: a finder pattern's rings are malformed (core ${core}px, gap ${gap}px, ring ${ring}px)`);
    }
    return { x, y };
  };

  const left = walkToBoundary(topLeft, -1, 0).x;
  const top = walkToBoundary(topLeft, 0, -1).y;
  const right = walkToBoundary(topRight, 1, 0).x;
  const bottom = walkToBoundary(bottomLeft, 0, 1).y;

  const spanX = right - left + 1;
  const spanY = bottom - top + 1;
  const size = Math.round(spanX / unitGuess);
  if (size < 21 || size > 41 || (size - 17) % 4 !== 0) {
    throw new Error(`qrDecode: derived a module count of ${size}, which is not a QR version 1–6 dimension`);
  }
  // Each axis uses its own span, so a non-square rasterization cannot skew the grid.
  const pitchX = spanX / size;
  const pitchY = spanY / size;
  if (Math.abs(pitchX - pitchY) / pitchX > 0.02) {
    throw new Error(`qrDecode: the symbol is not square — module pitch ${pitchX.toFixed(3)}px across vs ${pitchY.toFixed(3)}px down`);
  }

  const originX = left - 0.5;
  const originY = top - 0.5;
  const modules = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const x = originX + (col + 0.5) * pitchX;
      const y = originY + (row + 0.5) * pitchY;
      modules[row * size + col] = sampleModule(page, x, y, Math.min(pitchX, pitchY) / 4);
    }
  }
  return { size, modules, pitchX, pitchY, originX, originY };
}

// ── format information ────────────────────────────────────────────────────

/** All 32 valid 15-bit format strings, generated rather than tabulated. */
function validFormatCodes() {
  const codes = [];
  for (let value = 0; value < 32; value += 1) {
    let remainder = value << 10;
    for (let bit = 14; bit >= 10; bit -= 1) {
      if (remainder & (1 << bit)) remainder ^= FORMAT_GENERATOR << (bit - 10);
    }
    codes.push({ value, code: ((value << 10) | remainder) ^ FORMAT_XOR });
  }
  return codes;
}

const hamming = (a, b) => {
  let x = a ^ b;
  let count = 0;
  while (x) { count += x & 1; x >>= 1; }
  return count;
};

function decodeFormat({ size, modules }) {
  const bit = (row, col) => modules[row * size + col];
  const read = (positions) => positions.reduce((acc, [r, c]) => (acc << 1) | bit(r, c), 0);

  // ISO/IEC 18004 figure 25, MSB (bit 14) first. Copy 2 deliberately skips the
  // dark module at (size-8, 8), which is a fixed function module, not format.
  const copy1 = read([
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ]);
  const copy2 = read([
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ]);

  const codes = validFormatCodes();
  let best = null;
  for (const candidate of [copy1, copy2]) {
    for (const entry of codes) {
      const distance = hamming(candidate, entry.code);
      if (!best || distance < best.distance) best = { distance, value: entry.value, copy: candidate };
    }
  }
  if (best.distance > 3) {
    throw new Error(`qrDecode: neither format-information copy is a valid BCH code (best Hamming distance ${best.distance})`);
  }
  return {
    ecLevel: EC_LEVELS[(best.value >> 3) & 0b11],
    maskPattern: best.value & 0b111,
    formatDistance: best.distance,
    formatCopiesAgree: copy1 === copy2,
  };
}

// ── function-pattern map and codeword walk ────────────────────────────────

function functionPatternMap(size, version) {
  const map = new Uint8Array(size * size);
  const fill = (left, top, width, height) => {
    for (let r = top; r < top + height; r += 1) for (let c = left; c < left + width; c += 1) map[r * size + c] = 1;
  };
  fill(0, 0, 9, 9);
  fill(size - 8, 0, 8, 9);
  fill(0, size - 8, 9, 8);

  const centres = ALIGNMENT_CENTRES[version];
  const max = centres.length - 1;
  for (let i = 0; i < centres.length; i += 1) {
    for (let j = 0; j < centres.length; j += 1) {
      const isFinderCorner = (i === 0 && (j === 0 || j === max)) || (i === max && j === 0);
      if (isFinderCorner) continue;
      fill(centres[j] - 2, centres[i] - 2, 5, 5);
    }
  }

  fill(6, 9, 1, size - 17);
  fill(9, 6, size - 17, 1);
  return map;
}

/** The zigzag codeword walk, right to left, alternating up and down. */
function readCodewords({ size, modules }, version, maskPattern) {
  const map = functionPatternMap(size, version);
  const mask = MASKS[maskPattern];
  const bytes = [];
  let current = 0;
  let bitsRead = 0;
  let readingUp = true;

  for (let col = size - 1; col > 0; col -= 2) {
    // Column 6 is the vertical timing pattern: step PAST it, mutating the loop
    // variable, so the following pair is 5/4 and not 4/3. Skipping without the
    // mutation reads column 4 twice and desynchronizes the tail of the stream.
    if (col === 6) col -= 1;
    for (let count = 0; count < size; count += 1) {
      const row = readingUp ? size - 1 - count : count;
      for (let offset = 0; offset < 2; offset += 1) {
        const c = col - offset;
        if (map[row * size + c]) continue;
        const raw = modules[row * size + c];
        const value = mask(row, c) ? raw ^ 1 : raw;
        current = (current << 1) | value;
        bitsRead += 1;
        if (bitsRead === 8) { bytes.push(current); current = 0; bitsRead = 0; }
      }
    }
    readingUp = !readingUp;
  }
  return bytes;
}

/** Undo the block interleave and return the data codewords in message order. */
function deinterleaveData(codewords, version, ecLevel) {
  const spec = EC_BLOCKS[ecLevel]?.[version];
  if (!spec) {
    throw new Error(`qrDecode: no block table for version ${version} level ${ecLevel} (this decoder covers versions 1–6)`);
  }
  const blocks = [];
  for (const [count, total, data] of spec) {
    for (let i = 0; i < count; i += 1) blocks.push({ data, total, bytes: [] });
  }
  const expected = blocks.reduce((sum, b) => sum + b.total, 0);
  if (codewords.length < expected) {
    throw new Error(`qrDecode: read ${codewords.length} codewords but version ${version}-${ecLevel} needs ${expected}`);
  }

  let cursor = 0;
  const maxData = Math.max(...blocks.map((b) => b.data));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) {
      if (i < block.data) { block.bytes.push(codewords[cursor]); cursor += 1; }
    }
  }
  return blocks.flatMap((b) => b.bytes);
}

/** The 45 alphanumeric-mode characters, in their code values. */
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/**
 * Parse the payload out of the data codewords.
 *
 * A QR message is a SEQUENCE of segments, and an encoder will happily switch
 * modes mid-string to save room: `qrcode` splits a School token into a byte
 * segment (`sch`, lowercase) and an alphanumeric one (`:9F3K…`). A decoder that
 * reads one segment and stops returns the first three characters and looks like
 * it worked, so every segment is read here until the terminator.
 */
function parsePayload(dataBytes, version) {
  let bitPos = 0;
  const remaining = () => dataBytes.length * 8 - bitPos;
  const take = (count) => {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = dataBytes[bitPos >> 3];
      if (byte === undefined) throw new Error('qrDecode: the payload ran off the end of the data codewords');
      value = (value << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
      bitPos += 1;
    }
    return value;
  };
  // Version 1–9 character-count widths, by mode.
  const countBits = { numeric: 10, alphanumeric: 9, byte: 8 };
  if (version > 9) throw new Error(`qrDecode: version ${version} needs the wider character-count table`);

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  while (remaining() >= 4) {
    const mode = take(4);
    if (mode === 0b0000) break; // terminator
    if (mode === 0b0001) {
      let count = take(countBits.numeric);
      while (count >= 3) { text += String(take(10)).padStart(3, '0'); count -= 3; }
      if (count === 2) text += String(take(7)).padStart(2, '0');
      else if (count === 1) text += String(take(4));
    } else if (mode === 0b0010) {
      let count = take(countBits.alphanumeric);
      while (count >= 2) {
        const pair = take(11);
        text += ALPHANUMERIC[Math.floor(pair / 45)] + ALPHANUMERIC[pair % 45];
        count -= 2;
      }
      if (count === 1) text += ALPHANUMERIC[take(6)];
    } else if (mode === 0b0100) {
      const count = take(countBits.byte);
      const bytes = [];
      for (let i = 0; i < count; i += 1) bytes.push(take(8));
      text += decoder.decode(Uint8Array.from(bytes));
    } else {
      throw new Error(
        `qrDecode: segment mode ${mode.toString(2).padStart(4, '0')} is not one this decoder reads `
        + '(numeric, alphanumeric and byte are). School tokens use none of the others.',
      );
    }
  }
  return text;
}

/**
 * Decode every QR symbol printed on a rasterized page.
 *
 * Returns an ARRAY, including the empty one: "how many symbols can a decoder
 * find here" is itself an assertion the caller wants to make, and a page that
 * should carry no code must be able to say so without an exception.
 *
 * @param {{width:number,height:number,ink:Uint8Array}} page - from `opticalScan.toPageImage`
 * @returns {Array<{text:string, version:number, moduleCount:number, ecLevel:string,
 *            maskPattern:number, formatCopiesAgree:boolean, darkModules:number}>}
 */
export function decodeQrFromPage(page) {
  return selectFinderTriples(findFinderPatterns(page)).map((finders) => decodeSymbol(page, finders));
}

/** Decode the one symbol described by a located finder triple. */
export function decodeSymbol(page, finders) {
  const matrix = readModuleMatrix(page, finders);
  const version = (matrix.size - 17) / 4;
  const format = decodeFormat(matrix);
  const codewords = readCodewords(matrix, version, format.maskPattern);
  const dataBytes = deinterleaveData(codewords, version, format.ecLevel);
  const text = parsePayload(dataBytes, version);

  let darkModules = 0;
  for (let i = 0; i < matrix.modules.length; i += 1) darkModules += matrix.modules[i];

  return {
    text,
    version,
    moduleCount: matrix.size,
    ecLevel: format.ecLevel,
    maskPattern: format.maskPattern,
    formatCopiesAgree: format.formatCopiesAgree,
    formatDistance: format.formatDistance,
    darkModules,
    originXPx: matrix.originX,
    originYPx: matrix.originY,
    modulePx: matrix.pitchX,
  };
}

export default { decodeQrFromPage, decodeSymbol, findFinderPatterns, selectFinderTriples };
