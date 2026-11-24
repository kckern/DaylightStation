// frontend/src/lib/ui/useKeyboardViewport.test.jsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useKeyboardViewport } from './useKeyboardViewport.js';

function Surface({ active = true }) {
  const ref = useKeyboardViewport(active);
  return <div ref={ref} data-testid="surface"><input aria-label="Name" /><input aria-label="Check" type="checkbox" /><input aria-label="Ro" readOnly /></div>;
}

function fakeViewport(init) {
  const vv = new EventTarget();
  Object.assign(vv, { height: 800, width: 400, offsetTop: 0, scale: 1 }, init);
  return vv;
}

let original;
beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 400 });
});
afterEach(() => {
  if (original) Object.defineProperty(window, 'visualViewport', original); else delete window.visualViewport;
  delete document.documentElement.clientHeight;
  delete document.documentElement.clientWidth;
});
const install = vv => Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
const resize = (vv, patch) => act(() => { Object.assign(vv, patch); vv.dispatchEvent(new Event('resize')); });

describe('useKeyboardViewport', () => {
  it('fits the surface to the visual viewport when a keyboard-sized shrink happens with a text field focused', () => {
    const vv = fakeViewport();
    install(vv);
    render(<Surface />);
    const surface = screen.getByTestId('surface');
    screen.getByLabelText('Name').focus();
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
    resize(vv, { height: 450, offsetTop: 12 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(true);
    expect(surface.style.getPropertyValue('--keyboard-viewport-height')).toBe('450px');
    expect(surface.style.getPropertyValue('--keyboard-viewport-top')).toBe('12px');
  });

  it('ignores shrinks under 100px (browser toolbar), pinch zoom and width changes', () => {
    const vv = fakeViewport();
    install(vv);
    render(<Surface />);
    const surface = screen.getByTestId('surface');
    screen.getByLabelText('Name').focus();
    resize(vv, { height: 720 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
    resize(vv, { height: 450, scale: 2 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
    resize(vv, { height: 450, scale: 1, width: 300 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
  });

  it('does not fit when focus is outside the surface or on a field that cannot open a keyboard', () => {
    const vv = fakeViewport();
    install(vv);
    render(<><Surface /><button>outside</button></>);
    const surface = screen.getByTestId('surface');
    screen.getByText('outside').focus();
    resize(vv, { height: 450 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
    screen.getByLabelText('Check').focus();
    resize(vv, { height: 440 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
    screen.getByLabelText('Ro').focus();
    resize(vv, { height: 430 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
  });

  it('stays fitted if focus blurs while the keyboard is still closing, and resets once the viewport recovers', () => {
    const vv = fakeViewport();
    install(vv);
    render(<Surface />);
    const surface = screen.getByTestId('surface');
    const input = screen.getByLabelText('Name');
    input.focus();
    resize(vv, { height: 450 });
    input.blur();
    resize(vv, { height: 460 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(true);
    expect(surface.style.getPropertyValue('--keyboard-viewport-height')).toBe('460px');
    resize(vv, { height: 800 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
    expect(surface.style.getPropertyValue('--keyboard-viewport-height')).toBe('');
  });

  it('focusing a field after the keyboard is already up fits (focusin path)', () => {
    const vv = fakeViewport({ height: 450 });
    install(vv);
    render(<Surface />);
    const surface = screen.getByTestId('surface');
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
    act(() => { screen.getByLabelText('Name').focus(); });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(true);
  });

  it('clamps a negative offsetTop to 0', () => {
    const vv = fakeViewport();
    install(vv);
    render(<Surface />);
    screen.getByLabelText('Name').focus();
    resize(vv, { height: 450, offsetTop: -20 });
    expect(screen.getByTestId('surface').style.getPropertyValue('--keyboard-viewport-top')).toBe('0px');
  });

  it('inactive does nothing; cleanup on unmount removes listeners and resets the surface', () => {
    const vv = fakeViewport();
    install(vv);
    const { rerender, unmount } = render(<Surface active={false} />);
    const surface = screen.getByTestId('surface');
    screen.getByLabelText('Name').focus();
    resize(vv, { height: 450 });
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
    rerender(<Surface active />);
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(true);
    rerender(<Surface active={false} />);
    expect(surface.hasAttribute('data-keyboard-viewport')).toBe(false);
    rerender(<Surface active />);
    unmount();
    // listeners are gone: a later resize must not throw or touch anything
    resize(vv, { height: 300 });
  });

  it('is a no-op when the browser has no visualViewport', () => {
    install(undefined);
    render(<Surface />);
    fireEvent.focusIn(screen.getByLabelText('Name'));
    expect(screen.getByTestId('surface').hasAttribute('data-keyboard-viewport')).toBe(false);
  });
});
