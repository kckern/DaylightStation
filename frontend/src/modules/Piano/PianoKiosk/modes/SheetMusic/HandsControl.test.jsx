import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HandsControl from './HandsControl.jsx';

// Two independent L/R hand toggles replace the old Both/RH/LH radio row.
// External value vocabulary is unchanged: both | rh | lh.
describe('HandsControl', () => {
  it('lights both toggles for "both" and turning one off selects the other hand', () => {
    const onChange = vi.fn();
    render(<HandsControl value="both" onChange={onChange} />);
    expect(screen.getByRole('group', { name: /hands/i })).toBeInTheDocument();
    const left = screen.getByRole('button', { name: 'Left hand' });
    const right = screen.getByRole('button', { name: 'Right hand' });
    expect(left).toHaveAttribute('aria-pressed', 'true');
    expect(right).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(right); // both minus RH → LH only
    expect(onChange).toHaveBeenCalledWith('lh');
  });

  it('turning the second hand on selects "both"', () => {
    const onChange = vi.fn();
    render(<HandsControl value="lh" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Right hand' }));
    expect(onChange).toHaveBeenCalledWith('both');
  });

  it('always refuses to turn off the last lit hand', () => {
    const onChange = vi.fn();
    render(<HandsControl value="rh" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Right hand' })); // would be 'none'
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Left hand' }));
    expect(onChange).toHaveBeenCalledWith('both');
  });

  it('renders hand icons, not text glyphs', () => {
    render(<HandsControl value="both" onChange={vi.fn()} />);
    const left = screen.getByRole('button', { name: 'Left hand' });
    expect(left.querySelector('.piano-icon')).not.toBeNull();
  });

  it('carries no visible text label — the group aria-label alone names the control (wave-2 T8)', () => {
    render(<HandsControl value="both" onChange={vi.fn()} />);
    expect(screen.queryByText('Hands')).toBeNull();
    expect(screen.getByRole('group', { name: /hands/i })).toBeInTheDocument();
  });

  it('group is always labelled Hands', () => {
    render(<HandsControl value="both" onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Hands' })).toBeInTheDocument();
  });
});
