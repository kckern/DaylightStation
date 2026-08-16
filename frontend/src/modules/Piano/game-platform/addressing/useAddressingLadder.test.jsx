import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useAddressingLadder } from './useAddressingLadder.js';

function harness(props) {
  const seen = { current: null };
  function Probe(inner) { seen.current = useAddressingLadder(inner); return null; }
  const view = render(<Probe {...props} />);
  return { seen, rerender: (next) => view.rerender(<Probe {...{ ...props, ...next }} />) };
}

const client = () => ({ writeConfig: vi.fn(async () => null) });

describe('useAddressingLadder', () => {
  let api;
  beforeEach(() => { api = client(); });

  it('starts on the configured rung', async () => {
    let seen;
    await act(async () => {
      ({ seen } = harness({
        gameId: 'checkers', client: api, userId: 'ada',
        config: { addressing: { ladder: { unlocked_through: 5 } } },
      }));
    });
    expect(seen.current.rung).toBe(5);
  });

  it('promotes on sustained accurate, fluent addressing — and persists it', async () => {
    let seen;
    await act(async () => {
      ({ seen } = harness({
        gameId: 'checkers', client: api, userId: 'ada',
        config: { addressing: { ladder: { unlocked_through: 3 } } },
      }));
    });
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        seen.current.startTurn();
        seen.current.record({ ok: true });
      }
    });
    expect(seen.current.rung).toBe(4);
    expect(api.writeConfig).toHaveBeenCalledWith('ada', {
      addressing: { ladder: { unlocked_through: 4 } },
    });
  });

  it('resets the window on a move, so the next judgement is about the new rung', async () => {
    let seen;
    await act(async () => {
      ({ seen } = harness({ gameId: 'checkers', client: api, userId: 'ada', config: {} }));
    });
    // Promotion fires the moment the window has enough to judge on (12), and
    // resets there — so the next judgement is about how the player copes with
    // the rung they are on NOW, not half-full of evidence from a different one.
    await act(async () => {
      for (let i = 0; i < 12; i += 1) { seen.current.startTurn(); seen.current.record({ ok: true }); }
    });
    expect(seen.current.rung).toBe(2);
    expect(seen.current.samples).toBe(0);
  });

  it('records but never moves a pinned player', async () => {
    let seen;
    await act(async () => {
      ({ seen } = harness({
        gameId: 'checkers', client: api, userId: 'ada',
        config: { addressing: { ladder: { unlocked_through: 9, pinned: 3 } } },
      }));
    });
    await act(async () => {
      for (let i = 0; i < 20; i += 1) { seen.current.startTurn(); seen.current.record({ ok: true }); }
    });
    expect(seen.current.pinned).toBe(true);
    expect(seen.current.rung).toBe(3);
    expect(api.writeConfig).not.toHaveBeenCalled();
    // Still watching, so an operator can see how the held player is doing.
    expect(seen.current.samples).toBeGreaterThan(0);
  });

  it('demotes when the rung is blocking rather than teaching', async () => {
    let seen;
    await act(async () => {
      ({ seen } = harness({
        gameId: 'checkers', client: api, userId: 'ada',
        config: { addressing: { ladder: { unlocked_through: 6 } } },
      }));
    });
    await act(async () => {
      for (let i = 0; i < 20; i += 1) { seen.current.startTurn(); seen.current.record({ ok: false }); }
    });
    expect(seen.current.rung).toBe(5);
  });

  it('does not persist for a guest', async () => {
    let seen;
    await act(async () => {
      ({ seen } = harness({ gameId: 'checkers', client: api, userId: null, config: {} }));
    });
    await act(async () => {
      for (let i = 0; i < 20; i += 1) { seen.current.startTurn(); seen.current.record({ ok: true }); }
    });
    expect(api.writeConfig).not.toHaveBeenCalled();
    // The rung still moves for the session — a guest plays, and is not recorded.
    expect(seen.current.rung).toBe(2);
  });

  it('never reads a game result — the two ladders stay independent', async () => {
    let seen;
    await act(async () => {
      ({ seen } = harness({ gameId: 'checkers', client: api, userId: 'ada', config: {} }));
    });
    // Twenty accurate addresses inside a game the player is losing badly still
    // promote them, because losing is not what this ladder measures.
    await act(async () => {
      for (let i = 0; i < 20; i += 1) { seen.current.startTurn(); seen.current.record({ ok: true }); }
    });
    expect(seen.current.rung).toBe(2);
  });
});
