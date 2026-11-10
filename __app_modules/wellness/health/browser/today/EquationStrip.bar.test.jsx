import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { EquationStrip } from "./EquationStrip.jsx";

const base = { budget: 1600, range: { floor: 1200, top: 1600 }, maintenance: 2000,
  exercise: 941, food: 2464, net: 1523, zone: 'in-range', declared: null, remaining: 77 };
const show = (budget, overrides = {}) => render(
  <MantineProvider><EquationStrip budget={budget} date="2026-10-03" today="2026-10-03"
    onDateChange={() => {}} {...overrides} /></MantineProvider>,
);

describe('hybrid budget ruler', () => {
  it.each([
    [800, 'under', '400 kcal under goal range', '1,368 kcal estimated deficit'],
    [1200, 'in-range', 'Within goal range', '968 kcal estimated deficit'],
    [1768, 'in-range', 'Within goal range', '400 kcal estimated deficit'],
    [2033, 'over', '265 kcal over goal range', '135 kcal estimated deficit'],
    [2168, 'even', '400 kcal over goal range', 'At estimated break-even'],
    [2300, 'past-even', '532 kcal over goal range', '132 kcal estimated surplus'],
  ])('shows one endpoint-colored eaten fill and independent comparisons at %s kcal', (food, tone, position, balance) => {
    show({ ...base, food, exercise: 168 });
    const bar = screen.getByTestId('budget-ruler');
    expect(bar.querySelectorAll('[data-budget-consumed]')).toHaveLength(1);
    expect(bar).toHaveAttribute('data-budget-tone', tone);
    expect(bar.querySelector('[data-budget-consumed]').style.left).toBe('0%');
    expect(bar.querySelectorAll('[data-budget-available], [data-budget-goal-band], [data-budget-bonus="available"]')).toHaveLength(0);
    expect(screen.getByTestId('budget-headline')).toHaveTextContent(position);
    expect(screen.getByTestId('budget-balance')).toHaveTextContent(balance);
    expect(screen.getByTestId('budget-key')).toHaveTextContent('Goal start 1,200');
    expect(screen.getByTestId('budget-key')).toHaveTextContent('Goal end 1,768');
    expect(screen.getByTestId('budget-key')).toHaveTextContent('Break even 2,168');
  });

  it('shows the goal range, exercise hatch, semantic intake, and exact posts together', () => {
    show(base);
    const bar = screen.getByTestId('budget-ruler');
    expect(bar.querySelectorAll('[data-budget-consumed]')).toHaveLength(1);
    expect(bar.querySelector('[data-budget-consumed="eaten"]')).toBeTruthy();
    expect(bar.querySelector('[data-budget-available="workout"]')).toBeNull();
    expect(bar).toHaveClass('health-budget__track--in-range');
    expect(screen.getByTestId('budget-goal-range')).toHaveTextContent('Goal 1,200–2,541');
    expect(bar.querySelector('[data-budget-goal-band]')).toBeNull();
    expect(bar.querySelector('[data-budget-bonus="spent"]')).toBeTruthy();
    expect(bar.querySelector('[data-budget-bonus="available"]')).toBeNull();
    expect(screen.getByTestId('budget-cursor').getAttribute('aria-label')).toBe('2,464 kcal eaten');
    expect(screen.getByTestId('budget-key').textContent).toContain('Goal start 1,200');
    expect(screen.getByTestId('budget-key').textContent).toContain('Base goal end 1,600');
    expect(screen.getByTestId('budget-key').textContent).toContain('Goal end 2,541');
    expect(screen.getByTestId('budget-key').textContent).toContain('Break even 2,941');
  });

  it('recolors the entire eaten fill amber when food goes beyond the boosted plan', () => {
    show({ ...base, food: 2624, net: 1683, zone: 'over', remaining: 83, status: 'over' });
    const bar = screen.getByTestId('budget-ruler');
    expect(bar).toHaveAttribute('data-budget-tone', 'over');
    expect(bar.querySelector('[data-budget-consumed="surplus"]')).toBeNull();
    expect(bar.querySelector('[data-budget-available="workout"]')).toBeNull();
    expect(screen.getByTestId('budget-headline')).toHaveTextContent('83 kcal over goal range');
  });

  it('shows a baseline cursor only during a portion preview', () => {
    show({ ...base, food: 2624, net: 1683, zone: 'over', remaining: 83 }, { baseline: base });
    expect(screen.getByTestId('budget-baseline-cursor')).toHaveAttribute('aria-label', 'Before preview: 2,464 kcal eaten');
    expect(screen.getByTestId('budget-ruler').getAttribute('aria-label')).toContain('before preview 2,464 kcal eaten');
  });

  it('gives clustered posts separate wrapping key entries', () => {
    show({ ...base, budget: 1200, range: { floor: 1200, top: 1200 },
      maintenance: 1210, exercise: 10, food: 1200, net: 1190, remaining: 10 });
    const key = screen.getByTestId('budget-key');
    expect(key.querySelectorAll('.health-budget__key-item')).toHaveLength(4);
    expect(key.textContent).toContain('Goal start 1,200');
    expect(key.textContent).toContain('Base goal end 1,200');
    expect(key.textContent).toContain('Goal end 1,210');
    expect(key.textContent).toContain('Break even 1,220');
    const posts = screen.getByTestId('budget-ruler').querySelectorAll('.health-budget__post');
    expect(posts).toHaveLength(4);
    const goal = screen.getByTestId('budget-ruler').querySelector('.health-budget__post--plan');
    const even = screen.getByTestId('budget-ruler').querySelector('.health-budget__post--even');
    expect(parseFloat(even.style.left)).toBeGreaterThan(parseFloat(goal.style.left));
  });

  it('keeps the spent bar and removes available fills on a finished day', () => {
    show(base, { date: '2026-10-02' });
    const bar = screen.getByTestId('budget-ruler');
    expect(bar.querySelectorAll('[data-budget-consumed]')).toHaveLength(1);
    expect(bar.querySelectorAll('[data-budget-available]')).toHaveLength(0);
    expect(bar.querySelector('[data-budget-bonus="available"]')).toBeNull();
  });
});
