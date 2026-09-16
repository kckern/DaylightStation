import { describe, expect, it } from 'vitest';
import { buildChessRailViewModel, promptFor, safeBoardTheme, matchStandingBadge, demotionWarning } from './chessRailViewModel.js';

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

describe('matchStandingBadge — the state of the match, never a guess', () => {
  it('says which it is, in tournament words', () => {
    expect(matchStandingBadge(true)).toEqual({ state: 'counts', label: 'This match counts' });
    expect(matchStandingBadge(false)).toEqual({ state: 'practice', label: 'Practice match' });
  });

  it('says nothing at all when the ladder has not answered', () => {
    // A guest has no ladder, and a slow read has not produced one yet. Neither
    // may render as a confident "this counts" — asserting what it does not know
    // is the exact defect the badge exists to remove.
    expect(matchStandingBadge(null)).toBe(null);
    expect(matchStandingBadge(undefined)).toBe(null);
  });

  it('never says unlock', () => {
    for (const counts of [true, false]) expect(matchStandingBadge(counts).label).not.toMatch(/unlock/i);
  });
});

describe('demotionWarning — what it costs, before it costs it', () => {
  it('names the press, the cost, and how to go ahead anyway', () => {
    expect(demotionWarning('best', 'Weedle'))
      .toBe('Best move will make this a practice match — it stops counting against Weedle. Play it again to use it.');
  });

  it('warns about a second hint in the same words', () => {
    expect(demotionWarning('hint', 'Weedle')).toMatch(/^Another hint will make this a practice match/);
  });

  it('is silent when nothing is armed', () => {
    expect(demotionWarning(null)).toBe(null);
    expect(demotionWarning('replay')).toBe(null);
  });

  it('still reads without an opponent name', () => {
    expect(demotionWarning('best')).toBe('Best move will make this a practice match — it stops counting. Play it again to use it.');
  });
});
