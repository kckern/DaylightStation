/**
 * pianoRollLayout — pure geometry for a wrapped piano-roll image.
 *
 * Lays notes out as a piano roll (time → x, pitch → y) that WRAPS into stacked
 * rows so the overall image approximates a target aspect ratio (16:9 by default),
 * with total area growing with the music's length. Detail level (px per second,
 * px per semitone) is fixed, so a long session yields a physically larger image
 * than a short take; the number of rows falls out of the content:
 *
 *   width  = T·pxPerSec / R        (one row shows secondsPerRow = width/pxPerSec)
 *   height = R·rowHeight
 *   aspect = width/height = T·pxPerSec / (R²·rowHeight)   → R = √(T·pxPerSec / (rowHeight·aspect))
 *
 * so area = width·height = T·pxPerSec·rowHeight ∝ T, and aspect ≈ target.
 * A max-side cap uniformly downscales the geometry for extreme lengths.
 *
 * Layer: DOMAIN (2_domains/pianoaudio). Pure — math only, no I/O, no canvas.
 * @module domains/pianoaudio/pianoRollLayout
 */

const DEFAULTS = {
  pxPerSec: 6,
  pxPerKey: 7,
  targetAspect: 16 / 9,
  pitchMargin: 2,   // semitones of headroom above/below the used range
  rowGap: 10,       // px between wrapped rows
  maxSide: 4000,    // cap on either dimension
  minWidth: 240,    // floor so a tiny take still renders a sensible frame
  maxNoteDurSec: 4, // display clamp: keep attacks legible, don't smear pedal sustain
};

/**
 * @param {Array<{pitch:number, startSec:number, durSec:number, velocity:number}>} notes
 * @param {number} durationSeconds
 * @param {object} [opts]
 * @returns {{
 *   width:number, height:number, rows:number, rowHeight:number, rowGap:number,
 *   secondsPerRow:number, pxPerSec:number, pxPerKey:number,
 *   pitchMin:number, pitchMax:number,
 *   segments:Array<{x:number,y:number,w:number,h:number,pitch:number,velocity:number,row:number}>
 * }}
 */
export function computePianoRollLayout(notes, durationSeconds, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const T = Math.max(durationSeconds || 0, 0.001);

  // Pitch range (used ± margin, clamped to the MIDI 0..127 range).
  let pitchMin = 127;
  let pitchMax = 0;
  for (const n of notes) {
    if (n.pitch < pitchMin) pitchMin = n.pitch;
    if (n.pitch > pitchMax) pitchMax = n.pitch;
  }
  if (!notes.length) { pitchMin = 60; pitchMax = 72; } // empty → a default octave frame
  pitchMin = Math.max(0, pitchMin - cfg.pitchMargin);
  pitchMax = Math.min(127, pitchMax + cfg.pitchMargin);
  const usedKeys = pitchMax - pitchMin + 1;
  const rowHeight = usedKeys * cfg.pxPerKey;

  // Rows to approximate the target aspect (see module header).
  let rows = Math.max(1, Math.round(Math.sqrt((T * cfg.pxPerSec) / (rowHeight * cfg.targetAspect))));
  let rowWidth = Math.max(cfg.minWidth, Math.ceil((T * cfg.pxPerSec) / rows));
  const secondsPerRow = rowWidth / cfg.pxPerSec;

  let width = rowWidth;
  let height = rows * rowHeight + (rows - 1) * cfg.rowGap;

  // Build note segments (splitting notes that cross a row boundary).
  const segments = [];
  for (const n of notes) {
    const startSec = Math.max(0, n.startSec);
    const endSec = startSec + Math.min(Math.max(0, n.durSec), cfg.maxNoteDurSec);
    const startRow = Math.floor(startSec / secondsPerRow);
    const endRow = Math.floor(endSec / secondsPerRow);
    for (let r = startRow; r <= endRow && r < rows; r++) {
      const rowStartT = r * secondsPerRow;
      const segStartT = Math.max(startSec, rowStartT);
      const segEndT = Math.min(endSec, rowStartT + secondsPerRow);
      if (segEndT < segStartT) continue;
      const x = (segStartT - rowStartT) * cfg.pxPerSec;
      const w = Math.max(1, (segEndT - segStartT) * cfg.pxPerSec);
      const y = r * (rowHeight + cfg.rowGap) + (pitchMax - n.pitch) * cfg.pxPerKey;
      segments.push({ x, y, w, h: cfg.pxPerKey, pitch: n.pitch, velocity: n.velocity, row: r });
    }
  }

  // Cap: uniformly downscale everything if either dimension is too large.
  const over = Math.max(width, height) / cfg.maxSide;
  let pxPerSec = cfg.pxPerSec;
  let pxPerKey = cfg.pxPerKey;
  let effRowHeight = rowHeight;
  let effRowGap = cfg.rowGap;
  if (over > 1) {
    const s = 1 / over;
    width = Math.round(width * s);
    height = Math.round(height * s);
    effRowHeight = rowHeight * s;
    effRowGap = cfg.rowGap * s;
    pxPerSec *= s;
    pxPerKey *= s;
    for (const seg of segments) {
      seg.x *= s; seg.y *= s; seg.w = Math.max(1, seg.w * s); seg.h = Math.max(1, seg.h * s);
    }
  }

  return {
    width,
    height,
    rows,
    rowHeight: effRowHeight,
    rowGap: effRowGap,
    secondsPerRow,
    pxPerSec,
    pxPerKey,
    pitchMin,
    pitchMax,
    segments,
  };
}

export default { computePianoRollLayout };
