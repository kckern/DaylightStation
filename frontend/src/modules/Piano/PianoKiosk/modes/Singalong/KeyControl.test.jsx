// KeyControl.test.jsx — karaoke key-change stepper on the singalong chrome.
//
// Discrete tap targets per the touch rules (never a slider), ASCII/SVG faces
// only. The audio side is useKeyShift's job — mocked here; these tests pin the
// control surface: stepping, clamping at ±6, the tap-to-reset value face, and
// that the current shift + media element actually reach the hook.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KeyControl from './KeyControl.jsx';
import { KEY_SHIFT_MAX } from './keyShift.js';

const useKeyShiftSpy = vi.hoisted(() => vi.fn());
vi.mock('./useKeyShift.js', () => ({ default: useKeyShiftSpy }));

beforeEach(() => useKeyShiftSpy.mockClear());

const raise = () => fireEvent.click(screen.getByRole('button', { name: 'Raise key' }));
const lower = () => fireEvent.click(screen.getByRole('button', { name: 'Lower key' }));
const value = () => screen.getByRole('button', { name: 'Reset key' });

describe('KeyControl', () => {
  it('starts at the natural key and feeds the hook the media element', () => {
    const el = document.createElement('video');
    render(<KeyControl mediaEl={el} />);
    expect(value().textContent).toBe('Key');
    expect(useKeyShiftSpy).toHaveBeenLastCalledWith(el, 0);
  });

  it('raise steps up a semitone and reaches the hook', () => {
    render(<KeyControl mediaEl={null} />);
    raise();
    expect(value().textContent).toBe('+1');
    expect(useKeyShiftSpy).toHaveBeenLastCalledWith(null, 1);
  });

  it('lower steps down a semitone', () => {
    render(<KeyControl mediaEl={null} />);
    lower();
    expect(value().textContent).toBe('-1');
    expect(useKeyShiftSpy).toHaveBeenLastCalledWith(null, -1);
  });

  it('disables raise at the top of the range and never exceeds it', () => {
    render(<KeyControl mediaEl={null} />);
    for (let i = 0; i < KEY_SHIFT_MAX + 3; i += 1) raise();
    expect(value().textContent).toBe(`+${KEY_SHIFT_MAX}`);
    expect(screen.getByRole('button', { name: 'Raise key' })).toBeDisabled();
    expect(useKeyShiftSpy).toHaveBeenLastCalledWith(null, KEY_SHIFT_MAX);
  });

  it('disables lower at the bottom of the range', () => {
    render(<KeyControl mediaEl={null} />);
    for (let i = 0; i < KEY_SHIFT_MAX + 3; i += 1) lower();
    expect(value().textContent).toBe(`-${KEY_SHIFT_MAX}`);
    expect(screen.getByRole('button', { name: 'Lower key' })).toBeDisabled();
  });

  it('tapping the value face resets to the natural key', () => {
    render(<KeyControl mediaEl={null} />);
    raise();
    raise();
    fireEvent.click(value());
    expect(value().textContent).toBe('Key');
    expect(useKeyShiftSpy).toHaveBeenLastCalledWith(null, 0);
  });
});
