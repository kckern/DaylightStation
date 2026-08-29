/**
 * The content-dispatch interceptor seam.
 *
 * First refusal on a content dispatch, mirroring the `contentDispatcher` hook
 * that already sits in this handler. The reading session uses it to claim a
 * book tap at a reader where a child has a session open.
 *
 * The contract that matters most here is the FAILURE one: a broken interceptor
 * must leave the old behaviour standing. A tap that reaches a throwing claim
 * still plays its book.
 */
import { describe, it, expect } from 'vitest';
import { responseHandlers } from '#apps/trigger/responseHandlers.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const RESPONSE = {
  kind: 'content',
  dispatchId: 'test-dispatch',
  target: 'livingroom-tv',
  location: 'livingroom',
  expression: { action: 'play-next', contentId: 'plex:620681', options: {} },
  posture: 'authoritative',
};

describe('responseHandlers.content — interceptor seam', () => {
  it('dispatches normally when there are no interceptors at all', async () => {
    const loaded = [];
    await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async (t, q) => { loaded.push({ t, q }); } },
      logger: silent,
    });
    expect(loaded).toHaveLength(1);
  });

  it('dispatches normally when no interceptor claims the content', async () => {
    const loaded = [];
    await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async (t, q) => { loaded.push({ t, q }); } },
      contentInterceptors: [{ claim: async () => null }],
      logger: silent,
    });
    expect(loaded).toHaveLength(1);
  });

  it('does NOT dispatch when an interceptor claims it', async () => {
    const loaded = [];
    const result = await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async () => { loaded.push(1); } },
      contentInterceptors: [{ claim: async () => ({ claimed: true, by: 'reading-session' }) }],
      logger: silent,
    });
    expect(loaded).toEqual([]);
    expect(result).toMatchObject({ claimed: true, by: 'reading-session' });
  });

  it('dispatches normally when an interceptor throws — a broken claim must not eat the tap', async () => {
    const loaded = [];
    await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async () => { loaded.push(1); } },
      contentInterceptors: [{ claim: async () => { throw new Error('boom'); } }],
      logger: silent,
    });
    expect(loaded).toHaveLength(1);
  });

  // The learner handler leaked at exactly this shape once already: the guard
  // was there, but the log call sat where a throw could get past it.
  it('dispatches normally when the WARN logger itself throws', async () => {
    const loaded = [];
    await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async () => { loaded.push(1); } },
      contentInterceptors: [{ claim: async () => { throw new Error('boom'); } }],
      logger: { ...silent, warn() { throw new Error('log transport down'); } },
    });
    expect(loaded).toHaveLength(1);
  });

  it('still returns the claim when the INFO logger throws on a successful claim', async () => {
    const loaded = [];
    const result = await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async () => { loaded.push(1); } },
      contentInterceptors: [{ claim: async () => ({ claimed: true, by: 'reading-session' }) }],
      logger: { ...silent, info() { throw new Error('log transport down'); } },
    });
    expect(loaded).toEqual([]);
    expect(result).toMatchObject({ claimed: true });
  });

  it('a throw with no .message still dispatches and still logs a string', async () => {
    const loaded = [];
    const warned = [];
    await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async () => { loaded.push(1); } },
      // eslint-disable-next-line no-throw-literal
      contentInterceptors: [{ claim: async () => { throw null; } }],
      logger: { ...silent, warn: (e, d) => warned.push(d) },
    });
    expect(loaded).toHaveLength(1);
    expect(typeof warned[0].error).toBe('string');
  });

  it('skips an interceptor with no claim method rather than throwing', async () => {
    const loaded = [];
    await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async () => { loaded.push(1); } },
      contentInterceptors: [null, {}, { claim: null }],
      logger: silent,
    });
    expect(loaded).toHaveLength(1);
  });

  it('consults interceptors in order and stops at the first claim', async () => {
    const seen = [];
    await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async () => {} },
      contentInterceptors: [
        { claim: async () => { seen.push('a'); return { claimed: true }; } },
        { claim: async () => { seen.push('b'); return null; } },
      ],
      logger: silent,
    });
    expect(seen).toEqual(['a']);
  });

  it('a claim that answers `claimed: false` does not stop the dispatch', async () => {
    const loaded = [];
    await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async () => { loaded.push(1); } },
      contentInterceptors: [{ claim: async () => ({ claimed: false, by: 'reading-session' }) }],
      logger: silent,
    });
    expect(loaded).toHaveLength(1);
  });

  // The seam sits ABOVE the posture branch, so an optimistic dispatch is
  // claimable too — otherwise a reader configured optimistic would silently
  // opt out of the whole feature.
  it('claims before the optimistic contentDispatcher runs', async () => {
    const optimistic = [];
    const result = await responseHandlers.content({ ...RESPONSE, posture: 'optimistic' }, {
      wakeAndLoadService: { execute: async () => {} },
      contentDispatcher: { optimistic: async () => { optimistic.push(1); } },
      contentInterceptors: [{ claim: async () => ({ claimed: true, by: 'reading-session' }) }],
      logger: silent,
    });
    expect(optimistic).toEqual([]);
    expect(result).toMatchObject({ claimed: true });
  });

  it('hands the whole response to the interceptor so it can scope itself to a reader', async () => {
    const seen = [];
    await responseHandlers.content(RESPONSE, {
      wakeAndLoadService: { execute: async () => {} },
      contentInterceptors: [{ claim: async (r) => { seen.push(r); return null; } }],
      logger: silent,
    });
    expect(seen[0]).toMatchObject({ location: 'livingroom', target: 'livingroom-tv' });
  });
});

/**
 * D8 — the live hazard. The `livingroom` source declares `end: tv-off`, which
 * flows as `endBehavior` into the content query and fires when the content
 * ends (`WakeAndLoadService.mjs:275` → `sideEffectHandlers['tv-off']`). Left
 * alone it powers the TV off THE INSTANT A STORY ENDS — before the ceremony
 * can render, and while a child is still standing at the reader.
 *
 * So the seam has a second half: an interceptor that DECLINED to claim a tap
 * may still say "not that end behaviour, not while I am open". Suppression is
 * deliberately separate from claiming, because the taps that need it are
 * exactly the ones the session does NOT claim — a browsing-mode second book,
 * and a mid-story tap whose obligation could not be read.
 */
describe('responseHandlers.content — the end-behaviour suppression half of the seam', () => {
  const ENDING = { ...RESPONSE, end: 'tv-off', endLocation: 'livingroom' };

  it('passes the end behaviour through when nothing suppresses it', async () => {
    const loaded = [];
    await responseHandlers.content(ENDING, {
      wakeAndLoadService: { execute: async (t, q, o) => { loaded.push(o); } },
      logger: silent,
    });
    expect(loaded[0]).toMatchObject({ endBehavior: 'tv-off', endLocation: 'livingroom' });
  });

  it('drops endBehavior AND endLocation when an interceptor suppresses it', async () => {
    const loaded = [];
    await responseHandlers.content(ENDING, {
      wakeAndLoadService: { execute: async (t, q, o) => { loaded.push(o); } },
      contentInterceptors: [{ claim: async () => null, suppressEnd: () => true }],
      logger: silent,
    });
    expect(loaded).toHaveLength(1);
    expect(loaded[0].endBehavior).toBeUndefined();
    expect(loaded[0].endLocation).toBeUndefined();
    // The content still plays. Suppression is about the TEARDOWN, never the book.
    expect(loaded[0].dispatchId).toBeTruthy();
  });

  it('suppresses on the optimistic path too — a reader configured optimistic must not opt out', async () => {
    const dispatched = [];
    await responseHandlers.content({ ...ENDING, posture: 'optimistic' }, {
      wakeAndLoadService: { execute: async () => {} },
      contentDispatcher: { optimistic: async (t, q, o) => { dispatched.push(o); } },
      contentInterceptors: [{ claim: async () => null, suppressEnd: () => true }],
      logger: silent,
    });
    expect(dispatched[0].endBehavior).toBeUndefined();
  });

  it('keeps the end behaviour when suppressEnd THROWS — a broken guard must not change teardown', async () => {
    const loaded = [];
    await responseHandlers.content(ENDING, {
      wakeAndLoadService: { execute: async (t, q, o) => { loaded.push(o); } },
      contentInterceptors: [{ claim: async () => null, suppressEnd: () => { throw new Error('boom'); } }],
      logger: silent,
    });
    expect(loaded[0]).toMatchObject({ endBehavior: 'tv-off' });
  });

  it('a throwing warn logger cannot stop the dispatch either', async () => {
    const loaded = [];
    await responseHandlers.content(ENDING, {
      wakeAndLoadService: { execute: async (t, q, o) => { loaded.push(o); } },
      contentInterceptors: [{ claim: async () => null, suppressEnd: () => { throw new Error('boom'); } }],
      logger: { ...silent, warn() { throw new Error('log transport down'); } },
    });
    expect(loaded).toHaveLength(1);
  });

  it('an interceptor with no suppressEnd at all is simply not asked', async () => {
    const loaded = [];
    await responseHandlers.content(ENDING, {
      wakeAndLoadService: { execute: async (t, q, o) => { loaded.push(o); } },
      contentInterceptors: [null, {}, { claim: async () => null }],
      logger: silent,
    });
    expect(loaded[0]).toMatchObject({ endBehavior: 'tv-off' });
  });

  it('ANY interceptor suppressing is enough — the first no does not settle it', async () => {
    const loaded = [];
    await responseHandlers.content(ENDING, {
      wakeAndLoadService: { execute: async (t, q, o) => { loaded.push(o); } },
      contentInterceptors: [
        { claim: async () => null, suppressEnd: () => false },
        { claim: async () => null, suppressEnd: () => true },
      ],
      logger: silent,
    });
    expect(loaded[0].endBehavior).toBeUndefined();
  });

  it('a claimed tap never reaches the dispatch, so suppression is moot there', async () => {
    const loaded = [];
    const result = await responseHandlers.content(ENDING, {
      wakeAndLoadService: { execute: async (t, q, o) => { loaded.push(o); } },
      contentInterceptors: [{ claim: async () => ({ claimed: true, by: 'reading-session' }) }],
      logger: silent,
    });
    expect(loaded).toEqual([]);
    expect(result).toMatchObject({ claimed: true });
  });
});
