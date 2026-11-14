import { render, fireEvent, screen } from '@testing-library/react';
import StepGrid from './StepGrid.jsx';

const steps = [{ label: '50%' }, { label: '100%', sub: '90' }, { label: '150%' }];

describe('StepGrid', () => {
  it('lights the active step and fires onPick with the tapped index', () => {
    const onPick = vi.fn();
    render(<StepGrid steps={steps} activeIndex={1} onPick={onPick} ariaLabel="Tempo" />);
    const active = screen.getByRole('button', { name: /100%/ });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active.className).toContain('is-on');
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    expect(onPick).toHaveBeenCalledWith(0);
  });

  it('renders sub-labels and a group label', () => {
    render(<StepGrid steps={steps} activeIndex={0} onPick={() => {}} ariaLabel="Tempo" />);
    expect(screen.getByRole('group', { name: 'Tempo' })).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
  });

  it('meter variant lights every bar up to the active step and keeps plain names', () => {
    const levels = [{ label: 'Off' }, { label: 'Low' }, { label: 'Medium' }, { label: 'High' }];
    const { rerender } = render(<StepGrid variant="meter" steps={levels} activeIndex={2} onPick={() => {}} ariaLabel="Reverb" />);
    const lit = screen.getAllByRole('button').map((b) => b.classList.contains('is-lit'));
    expect(lit).toEqual([true, true, true, false]);
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
    // A level that matches no step lights nothing.
    rerender(<StepGrid variant="meter" steps={levels} activeIndex={-1} onPick={() => {}} ariaLabel="Reverb" />);
    expect(document.querySelectorAll('.is-lit')).toHaveLength(0);
  });

  it('disabled disables every step', () => {
    render(<StepGrid steps={steps} activeIndex={0} onPick={() => {}} ariaLabel="Tempo" disabled />);
    screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
  });
});
