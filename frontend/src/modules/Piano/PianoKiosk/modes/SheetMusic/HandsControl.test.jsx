import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HandsControl from './HandsControl.jsx';

describe('HandsControl', () => {
  it('variant="hands" renders Both/RH/LH, marks the value, reports selection', () => {
    const onChange = vi.fn();
    render(<HandsControl variant="hands" value="both" onChange={onChange} />);
    expect(screen.getByRole('group', { name: /hands/i })).toBeInTheDocument();
    const both = screen.getByRole('radio', { name: 'Both' });
    expect(both).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'LH' }));
    expect(onChange).toHaveBeenCalledWith('lh');
  });

  it('variant="mypart" includes None and labels the group "My part"', () => {
    const onChange = vi.fn();
    render(<HandsControl variant="mypart" value="none" onChange={onChange} />);
    expect(screen.getByRole('group', { name: /my part/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'RH' }));
    expect(onChange).toHaveBeenCalledWith('rh');
    // mypart offers None + RH + LH + Both
    for (const n of ['None', 'RH', 'LH', 'Both']) {
      expect(screen.getByRole('radio', { name: n })).toBeInTheDocument();
    }
  });

  it('hands variant has no None option', () => {
    render(<HandsControl variant="hands" value="rh" onChange={vi.fn()} />);
    expect(screen.queryByRole('radio', { name: 'None' })).toBeNull();
  });
});
