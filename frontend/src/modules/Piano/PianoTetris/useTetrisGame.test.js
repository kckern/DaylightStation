import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import getLogger from '../../../lib/logging/Logger.js';
import { useTetrisGame } from './useTetrisGame.js';

// Tetris telemetry used to reach the container console and nowhere else: the
// backend sessionFile transport files an event only when its context carries
// BOTH `app` and `sessionLog` (sessionFile.mjs:59-60), and the tetris loggers
// carried neither. A container restart therefore erased every game ever played,
// which is why the difficulty ramp could only ever be tuned against whatever
// happened to be in `docker logs` at the time. Tagging the game logger routes
// tetris.* to media/logs/piano-tetris/ so the lines/pieces distributions
// survive to be read later.

afterEach(() => { vi.restoreAllMocks(); });

describe('useTetrisGame session logging', () => {
  it('creates its game logger with a session-logged piano-tetris context', () => {
    const root = getLogger();
    const origChild = root.child.bind(root);
    const ctxs = [];
    vi.spyOn(root, 'child').mockImplementation((ctx) => { ctxs.push(ctx); return origChild(ctx); });

    renderHook(() => useTetrisGame(new Map(), null));

    const sessionCtx = ctxs.find((c) => c && c.sessionLog);
    expect(sessionCtx, 'no logger child carried sessionLog').toBeTruthy();
    expect(sessionCtx).toMatchObject({ app: 'piano-tetris', sessionLog: true });
    expect(sessionCtx.component).toBe('piano-tetris');
  });

  it('opens a piano-tetris session on mount so the backend can file its events', () => {
    const root = getLogger();
    const emitted = [];
    vi.spyOn(root, 'info').mockImplementation((event, data) => { emitted.push({ event, data }); });

    renderHook(() => useTetrisGame(new Map(), null));

    // Logger.js only auto-emits session-log.start for a child that FRESHLY turns
    // sessionLog on, so exactly one open is expected per mounted game.
    const starts = emitted.filter((e) => e.event === 'session-log.start');
    expect(starts).toHaveLength(1);
  });
});
