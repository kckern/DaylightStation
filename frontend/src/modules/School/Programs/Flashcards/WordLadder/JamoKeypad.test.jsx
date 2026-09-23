import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import JamoKeypad from './JamoKeypad.jsx';

const offerJamo = vi.fn();
const offerBackspace = vi.fn();

vi.mock('../../../ime/HangulTypingProvider.jsx', () => ({
  useHangulTyping: () => ({ offerJamo, offerBackspace }),
}));

beforeEach(() => {
  offerJamo.mockClear();
  offerBackspace.mockClear();
  document.body.innerHTML = '';
});

// Queried by `data-jamo`, not visible text: a key's label switches to its
// shifted glyph while ⇧ is armed, so the base jamo is not always on screen.
const keyFor = (container, base) => container.querySelector(`[data-jamo="${base}"]`);

describe('JamoKeypad', () => {
  it('renders nothing when closed', () => {
    render(<JamoKeypad open={false} />);
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
  });

  it('offers the base jamo on a plain tap', () => {
    const { container } = render(<JamoKeypad open />);
    fireEvent.pointerDown(keyFor(container, 'ㄱ'));
    expect(offerJamo).toHaveBeenCalledWith('ㄱ');
  });

  it('⇧ then ㄱ offers ㄲ, and Shift releases after the one key', () => {
    const { container } = render(<JamoKeypad open />);
    fireEvent.pointerDown(screen.getByLabelText('Shift'));
    fireEvent.pointerDown(keyFor(container, 'ㄱ'));
    expect(offerJamo).toHaveBeenCalledWith('ㄲ');
    offerJamo.mockClear();
    // Shift released: the same key now offers the plain jamo again.
    fireEvent.pointerDown(keyFor(container, 'ㄱ'));
    expect(offerJamo).toHaveBeenCalledWith('ㄱ');
  });

  it('the ㄱ key shows ㄲ while Shift is armed, and reverts once spent', () => {
    const { container } = render(<JamoKeypad open />);
    const key = keyFor(container, 'ㄱ');
    expect(key).toHaveTextContent('ㄱ');
    fireEvent.pointerDown(screen.getByLabelText('Shift'));
    expect(key).toHaveTextContent('ㄲ');
    fireEvent.pointerDown(key);
    expect(key).toHaveTextContent('ㄱ');
  });

  it('⇧ then ㅐ offers ㅒ, and ⇧ then ㅔ offers ㅖ', () => {
    const { container } = render(<JamoKeypad open />);
    fireEvent.pointerDown(screen.getByLabelText('Shift'));
    fireEvent.pointerDown(keyFor(container, 'ㅐ'));
    expect(offerJamo).toHaveBeenCalledWith('ㅒ');
    offerJamo.mockClear();
    fireEvent.pointerDown(screen.getByLabelText('Shift'));
    fireEvent.pointerDown(keyFor(container, 'ㅔ'));
    expect(offerJamo).toHaveBeenCalledWith('ㅖ');
  });

  it('Shift also releases on a key with no shifted form', () => {
    const { container } = render(<JamoKeypad open />);
    fireEvent.pointerDown(screen.getByLabelText('Shift'));
    fireEvent.pointerDown(keyFor(container, 'ㅗ')); // no Shift variant
    expect(offerJamo).toHaveBeenCalledWith('ㅗ');
    offerJamo.mockClear();
    fireEvent.pointerDown(screen.getByLabelText('Shift'));
    // re-armed by the line above; ㄱ now offers its shifted form again
    fireEvent.pointerDown(keyFor(container, 'ㄱ'));
    expect(offerJamo).toHaveBeenCalledWith('ㄲ');
  });

  it('⌫ calls offerBackspace and releases a pending Shift', () => {
    const { container } = render(<JamoKeypad open />);
    fireEvent.pointerDown(screen.getByLabelText('Shift'));
    fireEvent.pointerDown(screen.getByLabelText('Backspace'));
    expect(offerBackspace).toHaveBeenCalledTimes(1);
    offerJamo.mockClear();
    fireEvent.pointerDown(keyFor(container, 'ㄱ'));
    expect(offerJamo).toHaveBeenCalledWith('ㄱ'); // not ㄲ — Shift was released
  });

  it('Enter calls onSubmit and releases a pending Shift', () => {
    const onSubmit = vi.fn();
    const { container } = render(<JamoKeypad open onSubmit={onSubmit} />);
    fireEvent.pointerDown(screen.getByLabelText('Shift'));
    fireEvent.pointerDown(screen.getByText('Enter'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(keyFor(container, 'ㄱ'));
    expect(offerJamo).toHaveBeenCalledWith('ㄱ');
  });

  it('the close affordance calls onToggle when provided, and is absent otherwise', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<JamoKeypad open onToggle={onToggle} />);
    fireEvent.pointerDown(screen.getByLabelText('Close keypad'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<JamoKeypad open />);
    expect(screen.queryByLabelText('Close keypad')).toBeNull();
  });

  it('pressing a key does not blur a focused input — pointerdown is prevented', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    const { container } = render(<JamoKeypad open />);
    const key = keyFor(container, 'ㄱ');
    const notPrevented = fireEvent.pointerDown(key);
    // testing-library's fireEvent returns the DOM dispatchEvent() result,
    // which is false exactly when preventDefault() ran during dispatch — the
    // same call that keeps the browser from moving focus to the tapped
    // button.
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it('every jamo/shift/backspace key is a TouchButton at least 64px on a side', () => {
    render(<JamoKeypad open />);
    const keys = screen.getAllByRole('button').filter((b) => b.className.includes('wl-keypad__key'));
    expect(keys.length).toBeGreaterThan(0);
    for (const btn of keys) expect(btn.className).toMatch(/ds-touch/);
  });
});
