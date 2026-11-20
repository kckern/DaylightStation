import React, { useRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useScreenNav } from './useScreenNav.js';

function Harness({ onBack = () => {}, active = true, showTwo = true, onClick = () => {} }) {
  const ref = useRef(null);
  useScreenNav({ rootRef: ref, active, onBack, getGamepads: () => [] });
  return (
    <div ref={ref}>
      <button type="button" onClick={() => onClick('one')}>One</button>
      {showTwo ? <button type="button" data-autofocus onClick={() => onClick('two')}>Two</button> : null}
      <button type="button" disabled>Off</button>
      <button type="button" onClick={() => onClick('three')}>Three</button>
    </div>
  );
}
const focused = () => document.activeElement?.textContent;

describe('useScreenNav', () => {
  it('focuses the default control when it opens', () => {
    render(<Harness />);
    expect(focused()).toBe('Two');
  });

  it('arrows move and wrap past disabled buttons; Enter presses once', () => {
    const onClick = vi.fn();
    render(<Harness onClick={onClick} />);
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
    expect(focused()).toBe('Three');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
    expect(focused()).toBe('One');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
    expect(focused()).toBe('Three');
    fireEvent.keyDown(document.activeElement, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith('three');
  });

  it('Escape goes back, and handled keys never reach the page behind', () => {
    const onBack = vi.fn();
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    render(<Harness onBack={onBack} />);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
    window.removeEventListener('keydown', behind);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
  });

  it('keys still work when focus fell to the page: the first press only lands focus', () => {
    const onClick = vi.fn();
    render(<Harness onClick={onClick} />);
    document.activeElement.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
    expect(focused()).toBe('Two');
  });

  it('when the focused button disappears, focus comes back inside', () => {
    const { rerender } = render(<Harness />);
    expect(focused()).toBe('Two');
    rerender(<Harness showTwo={false} />);
    expect(focused()).toBe('One');
  });

  it('inactive: keys pass through', () => {
    const onBack = vi.fn();
    render(<Harness active={false} onBack={onBack} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onBack).not.toHaveBeenCalled();
  });
});
