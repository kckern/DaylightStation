import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CastTargetProvider, CAST_TARGET_KEY } from './CastTargetProvider.jsx';
import { useCastTarget } from './useCastTarget.js';

function Probe() {
  const { mode, targetIds, setMode, toggleTarget, clearTargets } = useCastTarget();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="targets">{targetIds.join(',')}</span>
      <button data-testid="set-fork" onClick={() => setMode('fork')}>fork</button>
      <button data-testid="toggle-lr" onClick={() => toggleTarget('lr')}>lr</button>
      <button data-testid="toggle-ot" onClick={() => toggleTarget('ot')}>ot</button>
      <button data-testid="clear" onClick={clearTargets}>clear</button>
    </div>
  );
}

describe('CastTargetProvider', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to mode=transfer with empty targets', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('transfer');
    expect(screen.getByTestId('targets')).toHaveTextContent('');
  });

  it('toggleTarget adds and removes ids; multi-select is ad-hoc', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('toggle-lr').click(); });
    act(() => { screen.getByTestId('toggle-ot').click(); });
    expect(screen.getByTestId('targets')).toHaveTextContent('lr,ot');
    act(() => { screen.getByTestId('toggle-lr').click(); });
    expect(screen.getByTestId('targets')).toHaveTextContent('ot');
  });

  it('setMode switches transfer ↔ fork; invalid ignored', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('set-fork').click(); });
    expect(screen.getByTestId('mode')).toHaveTextContent('fork');
  });

  it('persists mode + targets and restores on mount', () => {
    const { unmount } = render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('toggle-lr').click(); });
    act(() => { screen.getByTestId('set-fork').click(); });
    expect(localStorage.getItem(CAST_TARGET_KEY)).toContain('fork');
    unmount();

    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('fork');
    expect(screen.getByTestId('targets')).toHaveTextContent('lr');
  });

  it('clearTargets empties the array', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('toggle-lr').click(); });
    act(() => { screen.getByTestId('clear').click(); });
    expect(screen.getByTestId('targets')).toHaveTextContent('');
  });
});
