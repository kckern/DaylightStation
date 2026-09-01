/**
 * A RESULT THIS COMPONENT NEVER PLAYED IS NOT A RESULT.
 *
 * See docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md — a
 * resurrected transcript arrived already finished and this hook filed it as a
 * ranked loss on every mount, ten times, silently.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Same seam the sibling game-platform tests use (see GameBoundary.test.jsx):
// the hook takes a `.child()` of the default export, so one object answers both.
const h = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = () => logger;
  return { logger };
});
vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => h.logger, getLogger: () => h.logger,
}));

import { useAddressedBoardGame } from './useAddressedBoardGame.js';

function makeClient() {
  return {
    readConfig: vi.fn(async () => null),
    readLadder: vi.fn(async () => ({ unlocked_through: 7 })),
    writeConfig: vi.fn(async () => null),
    saveGame: vi.fn(async () => null),
    archiveGame: vi.fn(async () => null),
  };
}

const FINISHED = [0, 1, 0, 1, 0, 1, 0];

function renderGame(client, { moves, result }) {
  return renderHook(
    (props) => useAddressedBoardGame({
      gameId: 'connect-four', client, currentUser: { id: 'ada' }, ...props,
    }),
    { initialProps: { moves, result } },
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('useAddressedBoardGame — filing a result', () => {
  it('files a result the component watched play out', async () => {
    const client = makeClient();
    const view = renderGame(client, { moves: FINISHED.slice(0, 6), result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());

    view.rerender({ moves: FINISHED, result: 'win' });

    await waitFor(() => expect(client.saveGame).toHaveBeenCalledTimes(1));
    expect(client.saveGame.mock.calls[0][1]).toMatchObject({ result: 'win', completed: true });
    expect(client.archiveGame).toHaveBeenCalledTimes(1);
  });

  it('REFUSES a transcript that arrived already finished', async () => {
    const client = makeClient();
    // Exactly the shape a resurrected session produces: an empty first render
    // while the authority loads, then a full finished transcript.
    const view = renderGame(client, { moves: [], result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());

    view.rerender({ moves: FINISHED, result: 'loss' });

    expect(client.saveGame).not.toHaveBeenCalled();
    expect(client.archiveGame).not.toHaveBeenCalled();
  });

  it('SAYS SO when it refuses — a phantom result must never be silent', async () => {
    // The incident was not that a bad result got filed; it was that nobody
    // could tell. A guard that refuses without a word only half-fixes it.
    const client = makeClient();
    const view = renderGame(client, { moves: [], result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());

    view.rerender({ moves: FINISHED, result: 'loss' });

    const refusal = await waitFor(() => {
      const call = h.logger.warn.mock.calls.find(([event]) => event === 'game.result-refused');
      expect(call).toBeTruthy();
      return call;
    });
    expect(refusal[1]).toMatchObject({
      gameId: 'connect-four',
      result: 'loss',
      plies: FINISHED.length,
      watchedPlies: 0,
      reason: 'not-played-here',
    });
    // The session it refused is named, so the log can be tied to a real match.
    expect(refusal[1].gameSessionId).toMatch(/^connect-four-/);
    expect(client.saveGame).not.toHaveBeenCalled();
  });

  it('does not file a refused transcript as ABANDONED on the way out', async () => {
    // Refusing the result and then archiving the same phantom as
    // `completed: false` would just trade a duplicate ranked loss for a junk
    // abandoned row. A transcript this component never played is not a game it
    // can report on either way.
    const client = makeClient();
    const view = renderGame(client, { moves: [], result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());
    view.rerender({ moves: FINISHED, result: 'loss' });

    view.unmount();

    expect(client.archiveGame).not.toHaveBeenCalled();
    expect(h.logger.warn.mock.calls.map(([event]) => event)).toContain('game.abandon-refused');
  });

  it('still refuses once, not on every render', async () => {
    const client = makeClient();
    const view = renderGame(client, { moves: [], result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());

    // A FRESH ARRAY each time. Passing the same `moves` reference leaves every
    // dep of the save effect stable, so the effect never re-runs and the
    // repetition this test exists for is never actually exercised.
    view.rerender({ moves: [...FINISHED], result: 'loss' });
    view.rerender({ moves: [...FINISHED], result: 'loss' });
    view.rerender({ moves: [...FINISHED], result: 'loss' });

    expect(client.saveGame).not.toHaveBeenCalled();
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(1);

    // ...but a genuinely DIFFERENT phantom is not the same render storm.
    view.rerender({ moves: FINISHED.slice(0, 5), result: 'loss' });
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(2);
  });

  it('says NOTHING about an ordinary rematch — every refusal is an incident', async () => {
    const client = makeClient();
    const view = renderGame(client, { moves: FINISHED.slice(0, 6), result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());
    view.rerender({ moves: FINISHED, result: 'win' });
    await waitFor(() => expect(client.saveGame).toHaveBeenCalledTimes(1));

    // "Play again" leaves the finished board mounted for however many commits
    // the authority reset takes. A restart only takes effect at the new match's
    // first playable render, so those are ordinary already-filed repeats and
    // never reach the refusal — an alarm that fires on every rematch is one
    // everybody learns to scroll past.
    act(() => { view.result.current.restart(); });
    view.rerender({ moves: [...FINISHED], result: 'win' });
    view.rerender({ moves: [...FINISHED], result: 'win' });

    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(0);
    expect(h.logger.debug.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(0);
    expect(client.saveGame).toHaveBeenCalledTimes(1);

    // And walking out mid-window does not re-file the match it already filed.
    view.unmount();
    expect(client.archiveGame).toHaveBeenCalledTimes(1);
    expect(h.logger.warn.mock.calls.map(([event]) => event)).not.toContain('game.abandon-refused');
  });

  it('a refusal does not spend the one-shot — a game played after it still files', async () => {
    // The exact regression that shipped and was reverted: a refusal files
    // nothing, so it must not close the door on the next real game.
    const client = makeClient();
    const view = renderGame(client, { moves: FINISHED.slice(0, 6), result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());
    view.rerender({ moves: FINISHED, result: 'win' });
    await waitFor(() => expect(client.saveGame).toHaveBeenCalledTimes(1));

    act(() => { view.result.current.restart(); });
    view.rerender({ moves: [], result: null });              // the restart lands
    view.rerender({ moves: [...FINISHED], result: 'loss' }); // a phantom
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(1);
    expect(client.saveGame).toHaveBeenCalledTimes(1);

    view.rerender({ moves: [], result: null });
    view.rerender({ moves: [0, 1], result: null });
    view.rerender({ moves: [0, 1, 0], result: 'win' });

    await waitFor(() => expect(client.saveGame).toHaveBeenCalledTimes(2));
    expect(client.saveGame.mock.calls[1][1]).toMatchObject({ result: 'win', moves: [0, 1, 0] });
  });

  it('refuses a terminal transcript it never once saw playable', async () => {
    // Mounted already finished, with nothing to have watched. Said literally
    // rather than left to fall out of the arithmetic, so the save path and the
    // abandon guard agree about junk.
    const client = makeClient();
    renderGame(client, { moves: [], result: 'loss' });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());

    expect(client.saveGame).not.toHaveBeenCalled();
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(1);
  });

  it('KNOWN LIMITATION: refuses a real match that commits two plies in one render', async () => {
    // If you are here because your new game's results vanished, this is why:
    // the guard assumes one ply per commit, and the match is lost whole,
    // because the abandon archive is refused too.
    const client = makeClient();
    const view = renderGame(client, { moves: [0, 1, 0, 1], result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());

    // A player move and a terminal engine reply landing in the same commit.
    view.rerender({ moves: [0, 1, 0, 1, 0, 1], result: 'loss' });

    expect(client.saveGame).not.toHaveBeenCalled();
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(1);
  });

  it('waits for the ladder before filing, so the rung is the real one', async () => {
    // `level` reads 1 until the ladder answers, and on 2026-09-01 every phantom
    // record carried that 1 while the child's real rung was 7. A game finished
    // in that window is a REAL result filed against a rung nobody is on.
    const client = makeClient();
    let releaseLadder;
    client.readLadder = vi.fn(() => new Promise((resolve) => { releaseLadder = resolve; }));

    const view = renderGame(client, { moves: FINISHED.slice(0, 6), result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());
    view.rerender({ moves: FINISHED, result: 'win' });

    // The game is over and the ladder has not answered: nothing is filed yet.
    expect(client.saveGame).not.toHaveBeenCalled();
    // ...and waiting is not refusing. A deferred result must not trip the alarm.
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(0);

    await act(async () => { releaseLadder({ unlocked_through: 7 }); });

    await waitFor(() => expect(client.saveGame).toHaveBeenCalledTimes(1));
    expect(client.saveGame.mock.calls[0][1]).toMatchObject({ result: 'win', level: 7 });
    expect(client.archiveGame.mock.calls[0][0]).toMatchObject({ level: 7 });
  });

  it('files anyway when the ladder read never answers', async () => {
    // FAIL OPEN. Losing a played game is worse than filing it against the
    // fallback rung, so a hung read costs a level, never a record.
    vi.useFakeTimers();
    try {
      const client = makeClient();
      client.readLadder = vi.fn(() => new Promise(() => {}));

      const view = renderGame(client, { moves: FINISHED.slice(0, 6), result: null });
      view.rerender({ moves: FINISHED, result: 'win' });
      expect(client.saveGame).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

      expect(client.saveGame).toHaveBeenCalledTimes(1);
      expect(client.saveGame.mock.calls[0][1]).toMatchObject({ result: 'win', level: 1 });
      // It went through the timeout, and said so — a record filed against the
      // fallback rung is only forgivable if it is visible.
      expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.ladder-read-slow')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
