import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import ChessClock from './ChessClock.jsx';

const move = (color, at) => ({ color, at, san: 'e4' });
const START = Date.UTC(2026, 7, 16, 12, 0, 0);

// The clock reads the wall clock for the running side's in-progress think, so
// every assertion here would otherwise depend on what time the suite ran at.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START + 10000);
});
afterEach(() => vi.useRealTimers());

function draw(props) {
  return render(
    <ChessClock
      history={[move('w', START + 5000), move('b', START + 8000)]}
      startedAt={START}
      turn="w"
      playerColor="w"
      {...props}
    />,
  );
}

describe('ChessClock', () => {
  it('draws nothing at all when the clock is off', () => {
    const { container } = draw({ timing: { mode: 'off' } });
    expect(container.querySelector('.chess-clock')).toBeNull();
  });

  it('shows both sides, labelled from the player\'s point of view', () => {
    const { container } = draw({ timing: { mode: 'up' } });
    const who = [...container.querySelectorAll('.chess-clock__who')].map((node) => node.textContent);
    expect(who).toContain('You');
    expect(who).toContain('Them');
  });

  it('puts the player\'s own clock nearest them, whichever colour they have', () => {
    const asWhite = draw({ timing: { mode: 'up' }, playerColor: 'w' });
    expect([...asWhite.container.querySelectorAll('.chess-clock__who')].at(-1).textContent).toBe('You');
    const asBlack = draw({ timing: { mode: 'up' }, playerColor: 'b' });
    expect([...asBlack.container.querySelectorAll('.chess-clock__who')].at(-1).textContent).toBe('You');
  });

  it('marks only the side whose clock is running', () => {
    const { container } = draw({ timing: { mode: 'up' }, turn: 'w' });
    expect(container.querySelectorAll('.chess-clock__side--running')).toHaveLength(1);
  });

  it('stops marking anyone as running once the game is over', () => {
    const { container } = draw({ timing: { mode: 'up' }, gameOver: true });
    expect(container.querySelectorAll('.chess-clock__side--running')).toHaveLength(0);
  });

  it('flags a side that has run out in a counted-down game', () => {
    const { container } = render(
      <ChessClock
        history={[move('w', START + 90000)]}
        startedAt={START}
        turn="b"
        playerColor="w"
        timing={{ mode: 'down', initial_ms: 60000, increment_ms: 0 }}
      />,
    );
    expect(container.querySelectorAll('.chess-clock__side--flagged')).toHaveLength(1);
  });

  it('never flags anyone when the clock only counts up', () => {
    const { container } = render(
      <ChessClock
        history={[move('w', START + 9000000)]}
        startedAt={START}
        turn="b"
        playerColor="w"
        timing={{ mode: 'up' }}
      />,
    );
    expect(container.querySelectorAll('.chess-clock__side--flagged')).toHaveLength(0);
  });

  it('renders a readable clock face rather than raw milliseconds', () => {
    const { container } = draw({ timing: { mode: 'up' }, gameOver: true });
    const times = [...container.querySelectorAll('.chess-clock__time')].map((node) => node.textContent);
    expect(times.every((text) => /^\d+:\d{2}(:\d{2})?$/.test(text))).toBe(true);
  });
});
