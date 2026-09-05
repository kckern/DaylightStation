import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { EquationStrip } from './EquationStrip.jsx';

const budget = { budget: 2100, food: 1280, exercise: 320, remaining: 1140, status: 'under' };
const wrapper = ({ children }) => <MantineProvider>{children}</MantineProvider>;

describe('EquationStrip', () => {
  it('renders the full equation with under status', () => {
    render(<EquationStrip budget={budget} date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />, { wrapper });
    expect(screen.getByText('2,100')).toBeTruthy();
    expect(screen.getByText('1,280')).toBeTruthy();
    expect(screen.getByText('320')).toBeTruthy(); // exercise term (ops render as separate spans)
    expect(screen.getByText('1,140 kcal')).toBeTruthy();
    expect(screen.getByText(/under/)).toBeTruthy();
  });

  it('over status gets the over class', () => {
    const { container } = render(
      <EquationStrip budget={{ ...budget, remaining: -200, status: 'over' }}
        date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />, { wrapper });
    expect(container.querySelector('.health-equation--over')).toBeTruthy();
  });

  it('budget failure renders a setup notice, not a crash', () => {
    const err = new Error('conflict'); err.status = 409;
    render(<EquationStrip budget={null} budgetError={err} onSetupGoals={() => {}}
      date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />, { wrapper });
    expect(screen.getByRole('button', { name: /set up goals/i })).toBeTruthy();
  });
});
