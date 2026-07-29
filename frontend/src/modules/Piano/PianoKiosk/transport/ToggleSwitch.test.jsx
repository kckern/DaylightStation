import { render, screen, fireEvent } from '@testing-library/react';
import ToggleSwitch from './ToggleSwitch.jsx';

describe('ToggleSwitch', () => {
  it('is a switch with aria-checked reflecting checked', () => {
    const { rerender } = render(<ToggleSwitch label="Keyboard" checked={false} onChange={vi.fn()} />);
    const sw = screen.getByRole('switch', { name: 'Keyboard' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    rerender(<ToggleSwitch label="Keyboard" checked onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Keyboard' })).toHaveAttribute('aria-checked', 'true');
  });

  it('fires onChange with the flipped value', () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="Keyboard" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders the label on the left and a track element', () => {
    render(<ToggleSwitch label="Keyboard" checked onChange={vi.fn()} />);
    const sw = screen.getByRole('switch');
    expect(sw.firstChild).toHaveTextContent('Keyboard');
    expect(sw.querySelector('.piano-toggle__track')).not.toBeNull();
    expect(sw.classList.contains('is-on')).toBe(true);
  });

  it('disabled switch does not fire', () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="Keyboard" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
