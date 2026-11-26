/**
 * ShareRouter — one way in for anything shared from the phone. It finds the
 * URL in the shared text and hands it to the first handler that takes it.
 *
 * A handler (registered by the app that owns that kind of thing):
 *   kind                         'video', ...
 *   matches(url) -> boolean
 *   accept({ url, target, username }) -> summary   (returns at once; work runs on)
 *   status(jobId) -> object|null                    (optional)
 *
 * The router knows no service by name: which links a handler takes is the
 * handler's (and, below it, its adapters') business.
 *
 * Reference: __docs/reference/core/share.md
 */
import { sharedUrlIn } from '../domain/sharePolicy.mjs';

export class ShareRouter {
  #handlers; #logger;

  constructor({ handlers = [], logger = console } = {}) {
    for (const h of handlers) {
      if (typeof h?.matches !== 'function' || typeof h?.accept !== 'function') throw new Error('share handler needs matches and accept');
    }
    this.#handlers = handlers;
    this.#logger = logger;
  }

  /**
   * @returns {{ routed: true, summary: object }|{ routed: false, reason: 'no_url'|'no_handler' }}
   */
  route({ text, target, username }) {
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

  status(jobId) {
    for (const h of this.#handlers) {
      const s = h.status?.(jobId);
      if (s) return s;
    }
    return null;
  }
}

export default ShareRouter;
