/**
 * ShareRouter — one way in for anything shared from the phone. It finds the
 * URL in the shared text and hands it to the first handler that takes it.
 *
 * A handler (registered by the app that owns that kind of thing):
 *   kind                         'video', ...
 *   matches(url) -> boolean
 *   accept({ url, target, username }) -> summary   (returns at once; work runs on)
 *   status(jobId) -> object|null (or a Promise)     (optional)
 *   media(jobId) -> opaque media resource|null      (optional)
 *
 * A share made more than `maxAgeMs` ago (the phone's recorded time; a share
 * queued while the phone was offline) is refused: a video that starts on a
 * screen hours after it was shared is a surprise, not a share.
 *
 * The router knows no service by name: which links a handler takes is the
 * handler's (and, below it, its adapters') business.
 *
 * Reference: __docs/reference/core/share.md
 */
import { sharedUrlIn } from '../domain/sharePolicy.mjs';

/** Shares older than this are refused (the phone queued them while offline). */
export const SHARE_MAX_AGE_MS = 10 * 60_000;

export class ShareRouter {
  #handlers; #logger; #clock; #maxAgeMs;

  constructor({ handlers = [], logger = console, clock = Date.now, maxAgeMs = SHARE_MAX_AGE_MS } = {}) {
    for (const h of handlers) {
      if (typeof h?.matches !== 'function' || typeof h?.accept !== 'function') throw new Error('share handler needs matches and accept');
    }
    this.#handlers = handlers;
    this.#logger = logger;
    this.#clock = clock;
    this.#maxAgeMs = maxAgeMs;
  }

  /**
   * @param {Date|null} [input.capturedAt] - when the phone captured the share, when believed
   * @returns {{ routed: true, summary: object }|{ routed: false, reason: 'no_url'|'no_handler'|'stale' }}
   */
  route({ text, target, username, capturedAt = null }) {
    if (capturedAt instanceof Date && this.#clock() - capturedAt.getTime() > this.#maxAgeMs) {
      this.#logger.info?.('share.stale', { target, ageS: Math.round((this.#clock() - capturedAt.getTime()) / 1000) });
      return { routed: false, reason: 'stale' };
    }
    const url = sharedUrlIn(text);
    if (!url) return { routed: false, reason: 'no_url' };
    const handler = this.#handlers.find((h) => h.matches(url));
    if (!handler) {
      // The host only: the rest of a shared link can say who or what it is about.
      let host = null;
      try { host = new URL(url).hostname; } catch { /* not reached: sharedUrlIn parsed it */ }
      this.#logger.info?.('share.unrouted', { host });
      return { routed: false, reason: 'no_handler' };
    }
    const summary = handler.accept({ url, target, username });
    this.#logger.info?.('share.routed', { kind: handler.kind, target });
    return { routed: true, summary };
  }

  async status(jobId) {
    for (const h of this.#handlers) {
      const s = await h.status?.(jobId);
      if (s) return s;
    }
    return null;
  }

  async media(jobId) {
    for (const h of this.#handlers) {
      const m = await h.media?.(jobId);
      if (m) return m;
    }
    return null;
  }
}

export default ShareRouter;
