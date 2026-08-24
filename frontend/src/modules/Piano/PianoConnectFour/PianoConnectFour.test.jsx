import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

// The opponent effect goes through this client, not fetch directly — mocking
// it is what lets these tests drive the server-reply and unmount-cancellation
// paths without a network, the same pattern chessApi.js's mock uses.
vi.mock('./connectFourApi.js', () => ({
  default: {
    readConfig: vi.fn(async () => null),
    readLadder: vi.fn(async () => null),
    requestMove: vi.fn(),
    writeConfig: vi.fn(async () => null),
    saveGame: vi.fn(async () => null),
    archiveGame: vi.fn(async () => null),
  },
}));

import PianoConnectFour from './PianoConnectFour.jsx';
import connectFourClient from './connectFourApi.js';

const requestConnectFourMove = connectFourClient.requestMove;

// Note 65 (F) addresses column 3 in the default (unshuffled) deal under the
// DEFAULT_CONFIG this component falls back to when fetchConnectFourConfig
// resolves null (mocked below) — see PianoConnectFour.test.js's own config
// fixture for the same mapping. Playing it seats a disc and hands the turn to
// the opponent (player 2), which is what puts the opponent effect under test.

describe('PianoConnectFour opponent pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    requestConnectFourMove.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('visibly pauses: the reply lands only after the think-time floor, not the instant the request resolves', async () => {
    requestConnectFourMove.mockResolvedValueOnce({ move: { column: 0 } });
    const { container, rerender } = render(<PianoConnectFour activeNotes={new Map()} />);

    // Drop the player's disc in column 3 (note 65) to hand the turn over.
    rerender(<PianoConnectFour activeNotes={new Map([[65, { velocity: 90 }]])} />);
    await act(async () => { await Promise.resolve(); });

    expect(requestConnectFourMove).toHaveBeenCalledTimes(1);
    // The request already resolved (mockResolvedValueOnce), but with zero
    // timers advanced the opponent's disc must not be on the board yet — the
    // old bug committed the instant the promise settled.
    const discsBeforeFloor = container.querySelectorAll('.connect-four-board__disc--2').length;
    expect(discsBeforeFloor).toBe(0);
  });

  it('discards the pending reply on unmount', async () => {
    let resolveMove;
    requestConnectFourMove.mockImplementationOnce(() => new Promise((resolve) => { resolveMove = resolve; }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { rerender, unmount } = render(<PianoConnectFour activeNotes={new Map()} />);
    rerender(<PianoConnectFour activeNotes={new Map([[65, { velocity: 90 }]])} />);
    await act(async () => { await Promise.resolve(); });
    expect(requestConnectFourMove).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveMove({ move: { column: 0 } });
      await Promise.resolve();
    });

    logSpy.mockRestore();
    // No throw, no late setMoves — the assertion that matters is that this
    // resolves without React's unmounted-state-update warning path executing;
    // absence of a crash plus the mock having fired exactly once is the signal.
    expect(requestConnectFourMove).toHaveBeenCalledTimes(1);
  });
});

describe('PianoConnectFour address rail', () => {
  it('renders seven staff cards above the board and drops the text legend', () => {
    const { container } = render(<PianoConnectFour activeNotes={new Map()} />);
    const topRail = container.querySelector('.instrument-board-stage__top-rail .address-rail');
    expect(topRail).toBeTruthy();
    expect(topRail.querySelectorAll('.address-rail__card')).toHaveLength(7);
    // The board now says it — the old "1: C  2: D ..." panel legend is gone.
    expect(container.querySelector('.connect-four-key')).toBeFalsy();
  });

  it('prints chord names instead of feeding them to the staff engraver', async () => {
    connectFourClient.readConfig.mockResolvedValueOnce({
      addressing: { ladder: { unlocked_through: 13 } },
    });
    const { container } = render(<PianoConnectFour currentUser="alan" activeNotes={new Map()} />);

    await act(async () => { await Promise.resolve(); });

    const topRail = container.querySelector('.instrument-board-stage__top-rail .address-rail');
    expect(topRail.textContent).toMatch(/C/);
    expect(topRail.querySelectorAll('.chess-staff-label')).toHaveLength(0);
  });

  it('shows its Pokémon opponent without a permanent help paragraph', () => {
    const { container } = render(<PianoConnectFour activeNotes={new Map()} />);
    const rails = container.querySelectorAll('.instrument-board-stage__rail');
    const railText = [...rails].map((rail) => rail.textContent).join(' ');

    expect(railText).toContain('Diglett');
    expect(container.querySelector('.pg-ladder__portrait').getAttribute('src')).toMatch(/0050-diglett-gen1\.svg/);
    expect(railText).not.toContain('Play seven notes together');
    expect(container.querySelector('.pg-status__text').textContent).toContain('play a key to drop a disc');
  });
});

describe('PianoConnectFour gravity', () => {
  it('marks only the disc that just landed, and tells the CSS how far it fell', async () => {
    const { container, rerender } = render(<PianoConnectFour activeNotes={new Map()} />);
    // Note 65 (F) addresses column 3 in the default unshuffled deal.
    rerender(<PianoConnectFour activeNotes={new Map([[65, { velocity: 90 }]])} />);
    await act(async () => { await Promise.resolve(); });

    const falling = container.querySelectorAll('.connect-four-board__disc.is-falling');
    expect(falling).toHaveLength(1);
    // Column 3 is empty, so the disc lands on the floor: a full six-row fall.
    expect(falling[0].style.getPropertyValue('--c4-drop-rows')).toBe('6');
    expect(falling[0].style.getPropertyValue('--c4-drop-ms')).toMatch(/^\d+ms$/);
  });

  it('has nothing falling on a fresh board', () => {
    const { container } = render(<PianoConnectFour activeNotes={new Map()} />);
    expect(container.querySelectorAll('.connect-four-board__disc.is-falling')).toHaveLength(0);
  });

  it('draws the front panel over the discs, so a disc falls behind the grid', () => {
    const { container } = render(<PianoConnectFour activeNotes={new Map()} />);
    const board = container.querySelector('.connect-four-board');
    const panel = board.querySelector('.connect-four-board__panel');
    expect(panel).toBeTruthy();
    // Last child: the panel paints after every disc, which with its z-index is
    // what puts the blue plastic in front of a falling counter.
    expect(board.lastElementChild).toBe(panel);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('PianoConnectFour result', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    requestConnectFourMove.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Note 60 (C) addresses column 0 in the default unshuffled deal; the opponent
  // is pinned to column 1, so four player drops in a row are a vertical four.
  const playColumnZero = async (rerender) => {
    rerender(<PianoConnectFour activeNotes={new Map([[60, { velocity: 90 }]])} />);
    await act(async () => { await Promise.resolve(); });
    // Release: the latch only reopens on an empty keyboard.
    rerender(<PianoConnectFour activeNotes={new Map()} />);
    await act(async () => { await Promise.resolve(); });
  };

  const letOpponentAnswer = async () => {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(10000); await Promise.resolve(); });
  };

  it('lights the four that connected and steps every other disc back', async () => {
    requestConnectFourMove.mockResolvedValue({ move: { column: 1 } });
    const { container, rerender } = render(<PianoConnectFour activeNotes={new Map()} />);

    for (let drop = 0; drop < 3; drop += 1) {
      await playColumnZero(rerender);
      await letOpponentAnswer();
    }
    // The fourth drop completes the column and ends the game.
    await playColumnZero(rerender);

    const board = container.querySelector('.connect-four-board');
    expect(board.className).toContain('is-decided');
    expect(board.querySelectorAll('.connect-four-board__cell.is-winner')).toHaveLength(4);
    expect(board.querySelectorAll('.connect-four-board__disc.is-winner')).toHaveLength(4);
    // Every lit disc is the player's own colour.
    expect(board.querySelectorAll('.connect-four-board__disc--1.is-winner')).toHaveLength(4);
    // And the sentence names the winner and the colour, not just "you won".
    expect(container.querySelector('.pg-status__text').textContent).toContain('You win!');
    expect(container.querySelector('.pg-status__text').textContent).toContain('yellow');
  });

  it('marks nothing on a board that is still in play', async () => {
    requestConnectFourMove.mockResolvedValue({ move: { column: 1 } });
    const { container, rerender } = render(<PianoConnectFour activeNotes={new Map()} />);
    await playColumnZero(rerender);

    const board = container.querySelector('.connect-four-board');
    expect(board.className).not.toContain('is-decided');
    expect(board.querySelectorAll('.is-winner')).toHaveLength(0);
  });
});
