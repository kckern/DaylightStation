/**
 * Faster frame access for refine (2026-11-12: one Terminator 2 cue asked for ~90 single frames
 * within 20 s of film, each its own ffmpeg run; ffmpeg was most of a cue's time).
 *
 * - ProxiedRefineMedia: pictures (frames, shot cuts, black intervals) come from a low-res copy of
 *   the film with a keyframe every second (videoProxy.mjs); sound and the probe from the original.
 *   The copy starts at 0; `offset` maps its times onto the original's.
 * - FrameChunkCache: a frame request that misses decodes the next `chunkFrames` frames in one run
 *   and keeps them, so the requests around a cue are served from memory.
 * Both wrap any media with FfmpegRefineMedia's interface.
 */

const TOL = 0.001; // the 1 ms frame-match tolerance FfmpegRefineMedia uses

export class ProxiedRefineMedia {
  /**
   * @param {{ inner: object, videoSrc: string, offset?: number, preroll?: number }} p
   *   offset: the original's start time minus the copy's. The copy is built without -copyts, so it
   *   starts at 0 while some films start later (a 1.4 s start shifted every picture 1.4 s before
   *   this; review 2026-11-12). Times go to the copy as t - offset and come back + offset.
   *   preroll: seconds before a frame to seek (the copy's 1 s keyframe spacing + margin).
   */
  constructor({ inner, videoSrc, offset = 0, preroll = 1.1 }) {
    Object.assign(this, { inner, videoSrc, offset, preroll });
  }
  async frames(_src, fromPts, count, opts = {}) {
    const out = await this.inner.frames(this.videoSrc, fromPts - this.offset, count, { preroll: this.preroll, ...opts });
    return this.offset ? out.map((f) => ({ ...f, pts: f.pts == null ? null : f.pts + this.offset })) : out;
  }
  async shotCuts(_src, t0, t1, opts) {
    const out = await this.inner.shotCuts(this.videoSrc, t0 - this.offset, t1 - this.offset, opts);
    return this.offset ? out.map((c) => ({ ...c, pts: c.pts + this.offset })) : out;
  }
  async blackIntervals(_src, t0, t1, opts) {
    const out = await this.inner.blackIntervals(this.videoSrc, t0 - this.offset, t1 - this.offset, opts);
    return this.offset ? out.map((b) => ({ ...b, start: b.start + this.offset, end: b.end + this.offset })) : out;
  }
  audio(src, t0, t1, opts) { return this.inner.audio(src, t0, t1, opts); }
  probe(src) { return this.inner.probe(src); }
}

export class FrameChunkCache {
  #chunks = new Map(); #held = 0; #bytes = 0; #seq = 0;

  /** @param {{ inner: object, chunkFrames?: number, maxFrames?: number, maxBytes?: number }} p - maxBytes: PNG bytes held (6 cues at once, 1280 px crops) */
  constructor({ inner, chunkFrames = 48, maxFrames = 1200, maxBytes = 256 * 1024 * 1024 }) {
    Object.assign(this, { inner, chunkFrames, maxFrames, maxBytes });
  }

  async frames(src, fromPts, count, opts = {}) {
    const key = `${src}|${opts.width ?? ''}`;
    for (const [id, c] of this.#chunks) {
      if (c.key !== key || !c.frames.length || c.frames[0].pts > fromPts + TOL) continue;
      const i = c.frames.findIndex((f) => f.pts >= fromPts - TOL);
      if (i < 0 || (i + count > c.frames.length && !c.eof)) continue;
      this.#chunks.delete(id); this.#chunks.set(id, c); // most recently used last
      return c.frames.slice(i, i + count);
    }
    const want = Math.max(count, this.chunkFrames);
    const frames = await this.inner.frames(src, fromPts, want, opts);
    const bytes = frames.reduce((sum, f) => sum + (f.png?.length || 0), 0);
    this.#chunks.set(++this.#seq, { key, frames, bytes, eof: frames.length < want });
    this.#held += frames.length; this.#bytes += bytes;
    for (const [id, c] of this.#chunks) {
      if ((this.#held <= this.maxFrames && this.#bytes <= this.maxBytes) || this.#chunks.size === 1) break;
      this.#chunks.delete(id); this.#held -= c.frames.length; this.#bytes -= c.bytes;
    }
    return frames.slice(0, count);
  }

  audio(...a) { return this.inner.audio(...a); }
  probe(...a) { return this.inner.probe(...a); }
  shotCuts(...a) { return this.inner.shotCuts(...a); }
  blackIntervals(...a) { return this.inner.blackIntervals(...a); }
}
