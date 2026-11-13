/**
 * Faster frame access for refine (2026-11-12: one Terminator 2 cue asked for ~90 single frames
 * within 20 s of film, each its own ffmpeg run; ffmpeg was most of a cue's time).
 *
 * - ProxiedRefineMedia: pictures (frames, shot cuts, black intervals) come from a low-res copy of
 *   the film with a keyframe every second (videoProxy.mjs); sound and the probe from the original.
 *   The copy keeps the original's timestamps, so a frame at pts t is the same frame in both.
 * - FrameChunkCache: a frame request that misses decodes the next `chunkFrames` frames in one run
 *   and keeps them, so the requests around a cue are served from memory.
 * Both wrap any media with FfmpegRefineMedia's interface.
 */

const TOL = 0.001; // the 1 ms frame-match tolerance FfmpegRefineMedia uses

export class ProxiedRefineMedia {
  /** @param {{ inner: object, videoSrc: string, preroll?: number }} p - preroll: seconds before a frame to seek (the proxy's keyframe spacing + margin) */
  constructor({ inner, videoSrc, preroll = 1.1 }) {
    Object.assign(this, { inner, videoSrc, preroll });
  }
  frames(_src, fromPts, count, opts = {}) { return this.inner.frames(this.videoSrc, fromPts, count, { preroll: this.preroll, ...opts }); }
  shotCuts(_src, t0, t1, opts) { return this.inner.shotCuts(this.videoSrc, t0, t1, opts); }
  blackIntervals(_src, t0, t1, opts) { return this.inner.blackIntervals(this.videoSrc, t0, t1, opts); }
  audio(src, t0, t1, opts) { return this.inner.audio(src, t0, t1, opts); }
  probe(src) { return this.inner.probe(src); }
}

export class FrameChunkCache {
  #chunks = new Map(); #held = 0; #seq = 0;

  /** @param {{ inner: object, chunkFrames?: number, maxFrames?: number }} p */
  constructor({ inner, chunkFrames = 48, maxFrames = 1200 }) {
    Object.assign(this, { inner, chunkFrames, maxFrames });
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
    this.#chunks.set(++this.#seq, { key, frames, eof: frames.length < want });
    this.#held += frames.length;
    for (const [id, c] of this.#chunks) {
      if (this.#held <= this.maxFrames || this.#chunks.size === 1) break;
      this.#chunks.delete(id); this.#held -= c.frames.length;
    }
    return frames.slice(0, count);
  }

  audio(...a) { return this.inner.audio(...a); }
  probe(...a) { return this.inner.probe(...a); }
  shotCuts(...a) { return this.inner.shotCuts(...a); }
  blackIntervals(...a) { return this.inner.blackIntervals(...a); }
}
