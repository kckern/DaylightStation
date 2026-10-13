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

  it('disabled disables every step', () => {
    render(<StepGrid steps={steps} activeIndex={0} onPick={() => {}} ariaLabel="Tempo" disabled />);
    screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
  });
});
