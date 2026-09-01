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

    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());
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
      playedThrough: 0,
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
  });

  it('logs the ordinary rematch at DEBUG — the alarm is not for routine play', async () => {
    const client = makeClient();
    const view = renderGame(client, { moves: FINISHED.slice(0, 6), result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());
    view.rerender({ moves: FINISHED, result: 'win' });
    await waitFor(() => expect(client.saveGame).toHaveBeenCalledTimes(1));

    // "Play again" on the non-gated path: restart mints a session id while the
    // finished board is still mounted, so the next commit carries the new
    // session and the old terminal transcript. Real, routine, and refused — but
    // an alarm that fires on every rematch is one nobody reads.
    act(() => { view.result.current.restart(); });

    const debugs = h.logger.debug.mock.calls.filter(([event]) => event === 'game.result-refused');
    expect(debugs).toHaveLength(1);
    expect(debugs[0][1]).toMatchObject({ reason: 'restart-stale-render', plies: FINISHED.length });
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(0);
    expect(client.saveGame).toHaveBeenCalledTimes(1);
  });

  it('holds the rematch grace until a playable render, then re-arms the alarm', async () => {
    const client = makeClient();
    const view = renderGame(client, { moves: FINISHED.slice(0, 6), result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());
    view.rerender({ moves: FINISHED, result: 'win' });
    await waitFor(() => expect(client.saveGame).toHaveBeenCalledTimes(1));

    act(() => { view.result.current.restart(); });

    // The stale window is closed by a PLAYABLE RENDER, not by one refusal. A
    // second commit that still carries the finished board is the same rematch,
    // so it must stay at debug — counting refusals would assume the window is
    // exactly one commit, which is only true of today's consumers.
    view.rerender({ moves: [...FINISHED], result: 'win' });
    expect(h.logger.debug.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(2);
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(0);

    // Board cleared: the rematch is over, and a phantom arriving now in the
    // SAME session is once again worth waking up for.
    view.rerender({ moves: [], result: null });
    view.rerender({ moves: [...FINISHED], result: 'loss' });
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(1);
    expect(client.saveGame).toHaveBeenCalledTimes(1);
  });

  it('KNOWN LIMITATION: refuses a real match that commits two plies in one render', async () => {
    // The guard assumes ONE PLY PER COMMIT — see the contract at the refusal
    // site. Both current consumers hold to it, so this is unreachable today.
    // If you are here because your new game's results vanished: this is why.
    // The match is lost whole, since the abandon archive is refused too.
    const client = makeClient();
    const view = renderGame(client, { moves: [0, 1, 0, 1], result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());

    // A player move and a terminal engine reply landing in the same commit.
    view.rerender({ moves: [0, 1, 0, 1, 0, 1], result: 'loss' });

    expect(client.saveGame).not.toHaveBeenCalled();
    expect(h.logger.warn.mock.calls.filter(([event]) => event === 'game.result-refused')).toHaveLength(1);
  });
});
