import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NumberPad from './NumberPad.jsx';

// NumberPad logs through nothing at runtime today (see its header); the mock
// mirrors Keypad's tests so the two pads stay testable the same way once the
// facade grows bookShelf methods.
vi.mock('../schoolLog.js', () => ({
  schoolLog: {
    selfService: vi.fn(), selfServiceError: vi.fn(), bookShelf: vi.fn(), bookShelfError: vi.fn(),
  },
}));

const press = (...keys) => keys.forEach((k) => fireEvent.click(screen.getByRole('button', { name: String(k) })));
const entry = () => screen.getByTestId('numberpad-entry').textContent.replace(/\s/g, '');

describe('NumberPad', () => {
  it('shows the label and submits only on the explicit button', () => {
    const onSubmit = vi.fn();
    render(<NumberPad label="What page are you on?" maxLength={4} submitLabel="Save" onSubmit={onSubmit} />);
    expect(screen.getByText('What page are you on?')).toBeInTheDocument();
    press(8, 4);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith('84');
  });

  it('keeps the entry after submit so a retry does not retype 13 digits', () => {
    render(<NumberPad label="ISBN" maxLength={13} submitLabel="Look it up" onSubmit={() => {}} />);
    for (const d of '9780064400558') press(d);
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));
    expect(entry()).toBe('9780064400558');
  });

  it('renders one slot per maxLength, so 13 fit', () => {
    render(<NumberPad label="ISBN" maxLength={13} onSubmit={() => {}} />);
    expect(screen.getAllByTestId('numberpad-slot')).toHaveLength(13);
    // The glyph size is derived from the slot count in SCSS; the count has to
    // reach the stylesheet as a custom property or thirteen overflow the row.
    expect(screen.getByTestId('numberpad-entry').style.getPropertyValue('--slots')).toBe('13');
  });

  it('refuses digits past maxLength and offers an X key only when asked', () => {
    const { unmount } = render(<NumberPad label="x" maxLength={2} onSubmit={() => {}} />);
    press(1, 2, 3);
    expect(entry()).toBe('12');
    expect(screen.queryByRole('button', { name: 'X' })).toBeNull();
    unmount();
    render(<NumberPad label="x" maxLength={10} allowX onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument();
  });

  it('backspace removes the last character', () => {
    render(<NumberPad label="x" maxLength={4} onSubmit={() => {}} />);
    press(1, 2, 3);
    fireEvent.click(screen.getByRole('button', { name: /backspace|⌫|delete/i }));
    expect(entry()).toBe('12');
  });

  it('disables submit when empty or when the parent says the entry is wrong, and shows the hint', () => {
    const { rerender } = render(<NumberPad label="x" maxLength={4} submitLabel="Go" onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    press(4);
    expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled();
    rerender(<NumberPad label="x" maxLength={4} submitLabel="Go" hint="Check that number" canSubmit={false} onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    expect(screen.getByText('Check that number')).toBeInTheDocument();
  });

  it('reports every change so a parent can validate per keystroke', () => {
    const onChange = vi.fn();
    render(<NumberPad label="x" maxLength={3} onChange={onChange} onSubmit={() => {}} />);
    press(9, 7);
    expect(onChange).toHaveBeenLastCalledWith('97');
  });

  it('accepts a controlled value reset from the parent (clear after "No")', () => {
    const { rerender } = render(<NumberPad label="x" maxLength={4} value="123" onSubmit={() => {}} />);
    expect(entry()).toBe('123');
    rerender(<NumberPad label="x" maxLength={4} value="" onSubmit={() => {}} />);
    expect(entry()).toBe('');
  });

  it('accepts a barcode scanner or paired keyboard and submits on Enter', () => {
    const onSubmit = vi.fn();
    render(<NumberPad label="ISBN" maxLength={13} allowX submitLabel="Look it up" onSubmit={onSubmit} />);
    for (const key of '9780064400558') fireEvent.keyDown(window, { key });
    expect(entry()).toBe('9780064400558');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('9780064400558');
  });

  it('can clear the full number without thirteen backspaces', () => {
    const onChange = vi.fn();
    render(<NumberPad label="ISBN" maxLength={13} value="9780064400558" onChange={onChange} onSubmit={() => {}} />);
    const clear = screen.getByRole('button', { name: 'Clear number' });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('freezes pointer and scanner input while a write is busy', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<NumberPad label="ISBN" maxLength={13} value="978" disabled onChange={onChange} onSubmit={onSubmit} />);
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear number' })).toBeDisabled();
    fireEvent.keyDown(window, { key: '0' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
