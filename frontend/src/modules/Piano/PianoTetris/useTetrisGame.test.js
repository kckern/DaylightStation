import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Tetris telemetry used to reach the container console and nowhere else: the
// backend sessionFile transport files an event only when its context carries
// BOTH `app` and `sessionLog` (sessionFile.mjs:59-60), and the tetris loggers
// carried neither. A container restart therefore erased every game ever played,
// which is why the difficulty ramp could only be tuned against whatever happened
// to still be in `docker logs`.
//
// The hook takes its logger from lib/logging/singleton.js, which builds its OWN
// instance via createLogger — NOT the Logger.js `getLogger()` singleton. Spying
// on the wrong one captures nothing, so mock the module the hook imports.
const { childContexts } = vi.hoisted(() => ({ childContexts: [] }));

vi.mock('../../../lib/logging/singleton.js', () => {
  const stub = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, log: () => {},
    child: () => stub,
  };
  return {
    getChildLogger: (ctx = {}) => { childContexts.push(ctx); return stub; },
    getDaylightLogger: () => stub,
    default: () => stub,
  };
});

const { useTetrisGame } = await import('./useTetrisGame.js');

// STABLE identity, hoisted out of the render callback on purpose. `activeNotes`
// is a dependency of useStaffMatching's effect (useStaffMatching.js:311), and
// that effect calls setMatchedActions(new Set()) whenever matching is disabled
// (:234). Passing `new Map()` inline means a fresh Map per render → effect
// re-runs → setState → re-render → forever, which exhausts the heap rather than
// failing an assertion.
const NO_NOTES = new Map();

beforeEach(() => { childContexts.length = 0; });

describe('useTetrisGame session logging', () => {
  it('creates its game logger with a session-logged piano-tetris context', () => {
    renderHook(() => useTetrisGame(NO_NOTES, null));

    const gameCtx = childContexts.find((c) => c?.component === 'piano-tetris');
    expect(gameCtx, 'no piano-tetris logger was created').toBeTruthy();
    // Both fields are required — the backend gates on app AND sessionLog.
    expect(gameCtx).toMatchObject({ app: 'piano-tetris', sessionLog: true });
  });

  it('leaves the shared staff matcher untagged', () => {
    renderHook(() => useTetrisGame(NO_NOTES, null));

    // useStaffMatching is shared with the other piano games (the side-scroller
    // drives jump/duck through it), so tagging it would file those games' input
    // events under piano-tetris. It stays on the console stream deliberately.
    const matcherCtx = childContexts.find((c) => c?.component === 'staff-matching');
    if (matcherCtx) {
      expect(matcherCtx.sessionLog).toBeUndefined();
      expect(matcherCtx.app).toBeUndefined();
    }
  });
});
