import { describe, expect, it } from 'vitest';
import { buildChessRailViewModel, promptFor, safeBoardTheme } from './chessRailViewModel.js';

const playingGame = (overrides = {}) => ({
  playerColor: 'w',
  origin: null,
  history: [],
  rejection: null,
  status: { game_over: false, turn: 'w', check: false },
  ...overrides,
});

describe('chess rail view model', () => {
  it('keeps the takeback instruction ahead of opponent-turn copy', () => {
    const game = playingGame({ status: { game_over: false, turn: 'b', check: false } });
    expect(promptFor(game, null, null, false, true))
      .toBe('Play the octave again to take your move back.');
  });

  it('clamps generated HSL themes without rewriting hand-authored colors', () => {
    expect(safeBoardTheme('hsl(120 90% 80%)')).toBe('hsl(120 46% 52%)');
    expect(safeBoardTheme('#123456')).toBe('#123456');
  });

  it('derives the opponent status, turn label, and actionable pickup copy together', () => {
    const game = playingGame({
      history: [{ color: 'b', san: 'Nxe4', captured: 'p' }],
    });
    const view = buildChessRailViewModel({
      game,
      playerColor: 'w',
      opponent: { theme: 'hsl(10 30% 40%)' },
      opponentThinking: false,
      finishedResult: null,
      cursor: 'e2',
      cursorChord: { symbol: 'Em' },
      movableSources: ['e2'],
      armed: { square: 'e2', at: 42 },
      introSeen: true,
      reading: false,
      takebackArmed: false,
    });

    expect(view.turnLabel).toBe('Yours (White)');
    expect(view.prompt).toBe('Play Em again to pick that piece up.');
    expect(view.pickupDeadline).toBe(42);
    expect(view.opponentLine).toMatch(/pawn/i);
  });
});
