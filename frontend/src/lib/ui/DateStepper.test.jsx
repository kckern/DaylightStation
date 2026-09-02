import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateStepper } from './DateStepper.jsx';

describe('DateStepper', () => {
  it('steps back and forward a day', () => {
    const change = vi.fn();
    render(<DateStepper date="2026-09-02" onChange={change} max="2026-09-02" />);
    fireEvent.click(screen.getByLabelText('Previous day'));
    expect(change).toHaveBeenCalledWith('2026-09-01');
  });

  it('disables forward at max and labels max as Today', () => {
    render(<DateStepper date="2026-09-02" onChange={() => {}} max="2026-09-02" />);
    expect(screen.getByLabelText('Next day').disabled).toBe(true);
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('label click jumps back to max', () => {
    const change = vi.fn();
    render(<DateStepper date="2026-08-20" onChange={change} max="2026-09-02" />);
    fireEvent.click(screen.getByRole('button', { name: /Aug/ }));
    expect(change).toHaveBeenCalledWith('2026-09-02');
  });
});
