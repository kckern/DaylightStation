import { render, fireEvent, screen } from '@testing-library/react';
import TempoSheet, { TEMPO_STEPS, nearestStep } from './TempoSheet.jsx';

describe('TempoSheet', () => {
  it('exposes the canonical ladder and nearestStep', () => {
    expect(TEMPO_STEPS.map((s) => s.value)).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
    expect(nearestStep(TEMPO_STEPS, 1.2)).toBe(3);
  });

  it('lights the current step, shows derived BPM, and picks a multiplier', () => {
    const onPick = vi.fn();
    render(<TempoSheet open onClose={() => {}} value={1.25} onPick={onPick} baseBpm={80} />);
    expect(screen.getByRole('dialog', { name: 'Tempo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^125%/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('100')).toBeInTheDocument(); // 80 × 1.25
    fireEvent.click(screen.getByRole('button', { name: /^50%/ }));
    expect(onPick).toHaveBeenCalledWith(0.5);
  });
});
