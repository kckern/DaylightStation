import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { EquationStrip } from './EquationStrip.jsx';

const budget = { budget: 2100, food: 1280, exercise: 320, remaining: 1140, status: 'under' };
const wrapper = ({ children }) => <MantineProvider>{children}</MantineProvider>;

describe('EquationStrip', () => {
  it('renders seven stable daily metrics while preserving incomplete macro coverage', () => {
    const macroCoverage = {
      protein: { value: 60, covered: 2, total: 3 },
      carbs: { value: 100, covered: 3, total: 3 },
      fat: { value: 30, covered: 3, total: 3 },
    };
    render(<EquationStrip budget={budget} macroCoverage={macroCoverage}
      date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />, { wrapper });

    expect(screen.getAllByTestId('daily-metric')).toHaveLength(7);
    expect(screen.getByLabelText('Food calories')).toHaveTextContent('1,280');
    expect(screen.getByLabelText('Protein')).toHaveTextContent('60+');
    expect(screen.getByLabelText('Carbs')).toHaveTextContent('100');
    expect(screen.getByLabelText('Fat')).toHaveTextContent('30');
    expect(screen.getByLabelText('Under calories')).toHaveTextContent('1,140');
    expect(screen.queryByLabelText(/daily density/i)).not.toBeInTheDocument();
  });

  it('over status gets the over class', () => {
    const { container } = render(
      <EquationStrip budget={{ ...budget, remaining: -200, status: 'over' }}
        date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />, { wrapper });
    expect(container.querySelector('.health-equation--over')).toBeTruthy();
    expect(screen.getByLabelText('Protein')).toHaveTextContent('—');
  });

  it('budget failure renders a setup notice, not a crash', () => {
    const err = new Error('conflict'); err.status = 409;
    render(<EquationStrip budget={null} budgetError={err} onSetupGoals={() => {}}
      date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />, { wrapper });
    expect(screen.getByRole('button', { name: /set up goals/i })).toBeTruthy();
  });
});
