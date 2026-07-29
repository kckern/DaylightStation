import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HandsControl from './HandsControl.jsx';

// Two independent L/R hand toggles replace the old Both/RH/LH radio row.
// External value vocabulary is unchanged: both | rh | lh | none.
describe('HandsControl', () => {
  it('lights both toggles for "both" and turning one off selects the other hand', () => {
    const onChange = vi.fn();
    render(<HandsControl variant="hands" value="both" onChange={onChange} />);
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
    render(<HandsControl variant="hands" value="lh" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Right hand' }));
    expect(onChange).toHaveBeenCalledWith('both');
  });

  it('variant="hands" keeps at least one hand on — the last toggle is inert', () => {
    const onChange = vi.fn();
    render(<HandsControl variant="hands" value="rh" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Right hand' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('variant="mypart" allows both toggles off ("none") and labels the group "My part"', () => {
    const onChange = vi.fn();
    render(<HandsControl variant="mypart" value="rh" onChange={onChange} />);
    expect(screen.getByRole('group', { name: /my part/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Right hand' }));
    expect(onChange).toHaveBeenCalledWith('none');
  });

  it('renders hand icons, not text glyphs', () => {
    render(<HandsControl variant="hands" value="both" onChange={vi.fn()} />);
    const left = screen.getByRole('button', { name: 'Left hand' });
    expect(left.querySelector('.piano-icon')).not.toBeNull();
  });

  it('carries no visible text label — the group aria-label alone names the control (wave-2 T8)', () => {
    render(<HandsControl variant="hands" value="both" onChange={vi.fn()} />);
    expect(screen.queryByText('Hands')).toBeNull();
    expect(screen.getByRole('group', { name: /hands/i })).toBeInTheDocument();
  });

  it('"mypart" variant also carries no visible text label', () => {
    render(<HandsControl variant="mypart" value="rh" onChange={vi.fn()} />);
    expect(screen.queryByText('My part')).toBeNull();
    expect(screen.getByRole('group', { name: /my part/i })).toBeInTheDocument();
  });
});
