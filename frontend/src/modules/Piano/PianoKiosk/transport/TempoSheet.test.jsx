import { render, fireEvent, screen } from '@testing-library/react';
import TempoSheet, { TEMPO_STEPS, nearestStep } from './TempoSheet.jsx';

describe('TempoSheet', () => {
  it('ladder is 60-175 with 100% dead-center', () => {
    expect(TEMPO_STEPS.map((s) => s.value)).toEqual([0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75]);
    expect(TEMPO_STEPS[4].value).toBe(1); // center cell of the middle row
  });

  it('renders a 3×3 ladder — three StepGrid rows', () => {
    render(<TempoSheet open onClose={() => {}} value={1} onPick={() => {}} baseBpm={80} />);
    expect(screen.getAllByRole('group')).toHaveLength(3);
  });

  it('lights the current step, shows derived BPM, and picks a multiplier', () => {
    const onPick = vi.fn();
    render(<TempoSheet open onClose={() => {}} value={1.25} onPick={onPick} baseBpm={80} />);
    expect(screen.getByRole('dialog', { name: 'Tempo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^125%/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('100')).toBeInTheDocument(); // 80 × 1.25
    fireEvent.click(screen.getByRole('button', { name: /^60%/ }));
    expect(onPick).toHaveBeenCalledWith(0.6);
  });
});
