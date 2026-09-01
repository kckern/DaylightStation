/**
 * A RESULT THIS COMPONENT NEVER PLAYED IS NOT A RESULT.
 *
 * See docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md — a
 * resurrected transcript arrived already finished and this hook filed it as a
 * ranked loss on every mount, ten times, silently.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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

  it('still refuses once, not on every render', async () => {
    const client = makeClient();
    const view = renderGame(client, { moves: [], result: null });
    await waitFor(() => expect(client.readLadder).toHaveBeenCalled());

    view.rerender({ moves: FINISHED, result: 'loss' });
    view.rerender({ moves: FINISHED, result: 'loss' });
    view.rerender({ moves: FINISHED, result: 'loss' });

    expect(client.saveGame).not.toHaveBeenCalled();
  });
});
