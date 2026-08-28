import { describe, expect, it, vi } from 'vitest';
import * as sass from 'sass';
import { fileURLToPath } from 'url';
import { act, render, screen } from '@testing-library/react';
import OpponentPortrait from './OpponentPortrait.jsx';
import { opponentMood, opponentStatus } from './opponentViewModel.js';
import { DEFAULT_ROSTER, themeForLevel, TOP_LEVEL } from '@shared-gaming/rulesets/chess/ladder.mjs';

// COMPILE EACH SHEET ONCE PER FILE. A stylesheet cannot change mid-run, but
// `withStyles()` recompiled it on every call — up to 20 times in this file
// alone, across nine specs that each do the same. `sass.compile` is
// synchronous and CPU-heavy, and under a full parallel sweep (~1,000 files on
// every core) that redundant work is what starves a worker past its timeout,
// failing whichever timing-shaped test it was inside. Memoised by path.
const __sassCache = new Map();
const compileSheetOnce = (file) => {
  if (!__sassCache.has(file)) __sassCache.set(file, sass.compile(file));
  return __sassCache.get(file);
};


describe('the opponent status line', () => {
  it('says what they are doing, from real state only', () => {
    expect(opponentStatus({ thinking: true })).toBe('Thinking…');
    expect(opponentStatus({ lastMove: 'Nf3' })).toBe('Played Nf3');
    expect(opponentStatus({ lastMove: 'Nxe5', lastCapture: 'knight' })).toBe('Took your knight');
    expect(opponentStatus({})).toBe('Waiting for you');
  });

  it('reports the end of the game from the player\'s side', () => {
    // "Beaten" when the player won — the line is about the opponent, so it must
    // not read as though the child lost when they have just won.
    expect(opponentStatus({ gameOver: true, result: 'win' })).toBe('Beaten');
    expect(opponentStatus({ gameOver: true, result: 'loss' })).toBe('Won');
    expect(opponentStatus({ gameOver: true, result: 'draw' })).toBe('Drew with you');
  });

  it('prefers thinking over a stale last move', () => {
    // Once they are on the clock again, what they played last turn is history.
    expect(opponentStatus({ thinking: true, lastMove: 'Nf3', lastCapture: 'pawn' })).toBe('Thinking…');
  });
});

describe('the portrait', () => {
  it('shows the character and their status', () => {
    render(<OpponentPortrait opponent={DEFAULT_ROSTER[3]} level={3} status="Thinking…" />);
    expect(screen.getByText(DEFAULT_ROSTER[3].name)).toBeTruthy();
    expect(screen.getByText('Thinking…')).toBeTruthy();
  });

  it('draws an identicon when the roster ships no artwork', () => {
    const { container } = render(<OpponentPortrait opponent={DEFAULT_ROSTER[0]} level={0} />);
    expect(container.querySelector('.chess-opponent__identicon')).toBeTruthy();
    expect(container.querySelector('.chess-opponent__art')).toBeNull();
  });

  it('uses the roster artwork when there is some — the Themed case', () => {
    const { container } = render(
      <OpponentPortrait opponent={{ level: 2, name: 'Magikarp', art: '/magikarp.png' }} level={2} />,
    );
    expect(container.querySelector('.chess-opponent__art').getAttribute('src')).toBe('/magikarp.png');
    expect(container.querySelector('.chess-opponent__identicon')).toBeNull();
  });

  it('gives the same character the same face every time', () => {
    // The identicon is generated from the name, so a character is recognisable
    // across games — and across the other games in this house that use it.
    const first = render(<OpponentPortrait opponent={DEFAULT_ROSTER[7]} level={7} />).container.innerHTML;
    const second = render(<OpponentPortrait opponent={DEFAULT_ROSTER[7]} level={7} />).container.innerHTML;
    expect(first).toBe(second);
    const other = render(<OpponentPortrait opponent={DEFAULT_ROSTER[8]} level={8} />).container.innerHTML;
    expect(other).not.toBe(first);
  });

  it('never renders a blank where a name should be', () => {
    render(<OpponentPortrait opponent={null} level={5} />);
    expect(screen.getByText('Level 5')).toBeTruthy();
  });

  it('types speech visually while announcing the whole sentence only once', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <OpponentPortrait
          opponent={DEFAULT_ROSTER[0]}
          level={0}
          speech={{ eventId: 'g1:1:e4', quip: 'A bold first step.' }}
        />,
      );
      const typed = container.querySelector('.chess-opponent__speech-typed');
      const live = container.querySelector('.chess-opponent__speech-live');
      expect(typed.textContent).toBe('');
      expect(live.textContent).toBe('A bold first step.');
      expect(typed.getAttribute('aria-hidden')).toBe('true');
      await act(async () => vi.advanceTimersByTimeAsync(500));
      expect(typed.textContent).toBe('A bold first step.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the whole line immediately when reduced motion is requested', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    try {
      const { container } = render(
        <OpponentPortrait
          opponent={DEFAULT_ROSTER[0]}
          level={0}
          speech={{ eventId: 'g1:1:e4', quip: 'A bold first step.' }}
        />,
      );
      expect(container.querySelector('.chess-opponent__speech-typed').textContent).toBe('A bold first step.');
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else delete window.matchMedia;
    }
  });
});

describe('the think-time pulse', () => {
  it('pulses with the actual floor the opponent is being held for, not a made-up duration', () => {
    const { container } = render(<OpponentPortrait opponent={DEFAULT_ROSTER[3]} level={3} thinkMs={2500} />);
    const figure = container.querySelector('.chess-opponent');
    expect(figure.classList.contains('chess-opponent--thinking')).toBe(true);
    expect(figure.style.getPropertyValue('--pc-think-ms')).toBe('2500ms');
  });

  it('draws no pulse when it is not this character\'s turn', () => {
    const { container } = render(<OpponentPortrait opponent={DEFAULT_ROSTER[3]} level={3} thinkMs={null} />);
    const figure = container.querySelector('.chess-opponent');
    expect(figure.classList.contains('chess-opponent--thinking')).toBe(false);
    expect(figure.style.getPropertyValue('--pc-think-ms')).toBe('');
  });
});

describe('the board theme', () => {
  it('is a colour per level, deepening up the ladder', () => {
    expect(themeForLevel(0)).not.toBe(themeForLevel(TOP_LEVEL));
    expect(themeForLevel(0)).toBe(DEFAULT_ROSTER[0].theme);
  });

  it('clamps rather than producing nonsense off the ends', () => {
    expect(themeForLevel(-5)).toBe(themeForLevel(0));
    expect(themeForLevel(999)).toBe(themeForLevel(TOP_LEVEL));
  });
});

describe('opponentMood', () => {
  const base = {
    thinking: false, gameOver: false, result: null,
    tookPiece: false, lostPiece: false, givingCheck: false,
  };

  it('is neutral when nothing has happened', () => {
    expect(opponentMood(base)).toBe('neutral');
  });

  it('reacts to taking and to losing a piece, differently', () => {
    expect(opponentMood({ ...base, tookPiece: true })).toBe('pleased');
    expect(opponentMood({ ...base, lostPiece: true })).toBe('hurt');
  });

  it('leans in when it is giving check', () => {
    expect(opponentMood({ ...base, givingCheck: true })).toBe('attacking');
  });

  it('ranks the game ending above everything else', () => {
    // A mate is also a check and often also a capture; only one reaction plays.
    expect(opponentMood({
      ...base, gameOver: true, result: 'win', givingCheck: true, tookPiece: true,
    })).toBe('beaten');
    expect(opponentMood({ ...base, gameOver: true, result: 'loss' })).toBe('triumphant');
    expect(opponentMood({ ...base, gameOver: true, result: 'draw' })).toBe('neutral');
  });

  it('ranks check above a capture, since check is the thing to answer', () => {
    expect(opponentMood({ ...base, givingCheck: true, tookPiece: true })).toBe('attacking');
  });

  it('says it is thinking before it says anything about the last move', () => {
    expect(opponentMood({ ...base, thinking: true, tookPiece: true })).toBe('thinking');
  });
});

describe('the thinking pulse is declared once', () => {
  // A merge once added a second, flat-duration `animation` on this selector.
  // Being later it won, silently discarding `--pc-think-ms` — the rung-scaled
  // duration that is the entire point of driving the pulse from real think time.
  it('has exactly one animation rule for the thinking face', () => {
    const css = compileSheetOnce(fileURLToPath(new URL('./OpponentPortrait.scss', import.meta.url))).css;
    const bodies = [...css.matchAll(/\.chess-opponent--thinking \.chess-opponent__face\s*\{([^}]*)\}/g)]
      .map((m) => m[1]);
    const animating = bodies.filter((b) => /animation:\s*chess-opponent/.test(b));
    expect(animating).toHaveLength(1);
    expect(animating[0]).toMatch(/--pc-think-ms/);
  });
});
