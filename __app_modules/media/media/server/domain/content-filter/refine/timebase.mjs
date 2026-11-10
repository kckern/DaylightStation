/**
 * Frame <-> media-time conversion for one video stream.
 *
 * Media time is what the player's `currentTime` reads. Frame n (0-based, in
 * presentation order) is on screen from `frameStart(n)` until `frameStart(n+1)`.
 * `startTime` is the stream's first presentation timestamp (ffprobe
 * `start_time`); pass 0 when the player's clock starts at the first frame.
 *
 * Frame rates are rational ({ num, den }) so 24000/1001 stays exact.
 */

const EPS = 1e-6;

/** Parse "24000/1001", "24/1", 23.976 or { num, den } into { num, den }. */
export function parseRate(rate) {
  if (rate && typeof rate === 'object' && rate.num && rate.den) return { num: rate.num, den: rate.den };
  if (typeof rate === 'string' && rate.includes('/')) {
    const [num, den] = rate.split('/').map(Number);
    if (num > 0 && den > 0) return { num, den };
  }
  const f = Number(rate);
  if (!(f > 0)) throw new Error(`invalid frame rate: ${rate}`);
  // Snap common NTSC rates to their exact rationals
  for (const base of [24, 30, 60]) {
    const ntsc = (base * 1000) / 1001;
    if (Math.abs(f - ntsc) < 0.002) return { num: base * 1000, den: 1001 };
  }
  return { num: Math.round(f * 1000), den: 1000 };
}

/** Round seconds to whole milliseconds. */
export function ms(sec) {
  return Math.round(sec * 1000) / 1000;
}

/**
 * @param {{ fps: string|number|{num:number,den:number}, startTime?: number }} opts
 */
export function makeTimebase({ fps, startTime = 0 }) {
  const rate = parseRate(fps);
  const frameDur = rate.den / rate.num;
  const start = Number(startTime) || 0;

  const frameStart = (n) => start + (n * rate.den) / rate.num;
  const frameEnd = (n) => frameStart(n + 1);
  /** The frame on screen at media time `sec` (the last frame whose start <= sec). */
  const frameAt = (sec) => Math.max(0, Math.floor(((sec - start) * rate.num) / rate.den + EPS));
  /** The middle of frame n: a safe seek target that lands on that frame. */
  const frameMid = (n) => frameStart(n) + frameDur / 2;

  /** A frame span as player times: in = start of first frame, out = end of last frame. */
  const spanToTimes = (frameIn, frameOut) => {
    if (frameOut < frameIn) throw new Error(`frame span reversed: ${frameIn}..${frameOut}`);
    return { in: ms(frameStart(frameIn)), out: ms(frameEnd(frameOut)) };
  };

  return { rate, fps: rate.num / rate.den, frameDur, startTime: start, frameStart, frameEnd, frameAt, frameMid, spanToTimes };
}
