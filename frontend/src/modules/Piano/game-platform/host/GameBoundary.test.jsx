import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import GameBoundary from './GameBoundary.jsx';

function Boom({ explode }) {
  if (explode) throw new Error('board fell over');
  return <div data-testid="game">playing</div>;
}

describe('GameBoundary', () => {
  let errorSpy;
  beforeEach(() => {
    // React logs the caught error to console.error by design; the test is about
    // what the player sees, not about that noise.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('passes a healthy game straight through', () => {
    const { getByTestId } = render(
      <GameBoundary resetKey="tetris" onExit={() => {}}><Boom explode={false} /></GameBoundary>,
    );
    expect(getByTestId('game')).toBeTruthy();
  });

  it('catches a throw instead of blanking the kiosk', () => {
    const { container } = render(
      <GameBoundary resetKey="tetris" label="Tetris" onExit={() => {}}><Boom explode /></GameBoundary>,
    );
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain('Tetris stopped.');
  });

  it('offers the way out, and takes it', () => {
    const onExit = vi.fn();
    const { container } = render(
      <GameBoundary resetKey="tetris" onExit={onExit}><Boom explode /></GameBoundary>,
    );
    fireEvent.click(container.querySelector('.pg-btn'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('unlatches for the next game, so one crash does not shut the others out', () => {
    const { container, rerender } = render(
      <GameBoundary resetKey="tetris" onExit={() => {}}><Boom explode /></GameBoundary>,
    );
    expect(container.querySelector('[role="alert"]')).toBeTruthy();

    rerender(
      <GameBoundary resetKey="chess" onExit={() => {}}><Boom explode={false} /></GameBoundary>,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('playing');
  });

  it('stays latched while the same game keeps rendering', () => {
    const { container, rerender } = render(
      <GameBoundary resetKey="tetris" onExit={() => {}}><Boom explode /></GameBoundary>,
    );
    rerender(
      <GameBoundary resetKey="tetris" onExit={() => {}}><Boom explode={false} /></GameBoundary>,
    );
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });
});
