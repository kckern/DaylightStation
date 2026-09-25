import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { EquationStrip } from './EquationStrip.jsx';

const budget = { budget: 1791, food: 1603, exercise: 231, remaining: 419, status: 'under' };
const wrapper = ({ children }) => <MantineProvider>{children}</MantineProvider>;
const coverage = (protein, carbs, fat) => ({
  protein: { value: protein, covered: 3, total: 3 },
  carbs: { value: carbs, covered: 3, total: 3 },
  fat: { value: fat, covered: 3, total: 3 },
});
const strip = props => render(<EquationStrip date="2026-09-22" today="2026-09-23" onDateChange={() => {}} {...props} />, { wrapper });

describe('EquationStrip — budget bar', () => {
  const width = el => parseFloat(el.style.width);
  const left = el => parseFloat(el.style.left);

  it('headlines what is left and states the terms without a negative number', () => {
    strip({ budget: { ...budget, maintenance: 2291 }, macroCoverage: coverage(88, 135, 82) });
    expect(screen.getByTestId('budget-headline')).toHaveTextContent('419 kcal left');
    const terms = screen.getByTestId('budget-terms').textContent;
    expect(terms).toContain('1,603 eaten');
    expect(terms).toContain('231 burned');
    expect(terms).toContain('1,372 net');
    expect(terms).toContain('919 deficit');
    expect(document.body.textContent).not.toMatch(/[−-]\s?\d/);
  });

  it('marks the goal and break even on a fixed scale and fills net calories', () => {
    const { container } = strip({ budget: { ...budget, maintenance: 2291 } });
    const scale = 2291 * 1.12;
    const bar = screen.getByRole('img', { name: /1,372 net kcal of 1,791 goal, break even 2,291/ });
    expect(width(bar.querySelector('.health-budget__net'))).toBeCloseTo((1372 / scale) * 100, 1);
    // Exercise: the light band from net up to what was eaten.
    const burned = bar.querySelector('.health-budget__burned');
    expect(left(burned)).toBeCloseTo((1372 / scale) * 100, 1);
    expect(width(burned)).toBeCloseTo((231 / scale) * 100, 1);
    expect(bar.querySelector('.health-budget__over-goal')).toBeNull();
    expect(left(container.querySelector('.health-budget__mark--goal'))).toBeCloseTo((1791 / scale) * 100, 1);
    expect(left(container.querySelector('.health-budget__mark--even'))).toBeCloseTo((2291 / scale) * 100, 1);
    expect(container.querySelector('.health-budget__mark--goal').textContent).toBe('Goal 1,791');
    expect(container.querySelector('.health-budget__mark--even').textContent).toBe('Break even 2,291');
  });

  it('past the goal: amber up to break even, red beyond it, and a surplus', () => {
    const { container } = strip({ budget: { budget: 1800, maintenance: 2300, food: 2600, exercise: 100, remaining: -700, status: 'over' } });
    expect(container.querySelector('.health-equation--over')).toBeTruthy();
    expect(screen.getByTestId('budget-headline')).toHaveTextContent('700 kcal over goal');
    expect(screen.getByTestId('budget-terms')).toHaveTextContent('200 surplus');
    const scale = 2600 * 1.12;
    const bar = screen.getByRole('img', { name: /2,500 net kcal of 1,800 goal/ });
    expect(width(bar.querySelector('.health-budget__net'))).toBeCloseTo((1800 / scale) * 100, 1);
    expect(width(bar.querySelector('.health-budget__over-goal'))).toBeCloseTo((500 / scale) * 100, 1);
    expect(width(bar.querySelector('.health-budget__surplus-fill'))).toBeCloseTo((200 / scale) * 100, 1);
  });

  it('one mark when there is no planned deficit, and no break even when the server sends none', () => {
    const { container, unmount } = strip({ budget: { ...budget, maintenance: 1791 } });
    expect(container.querySelectorAll('.health-budget__mark')).toHaveLength(1);
    expect(container.querySelector('.health-budget__mark').textContent).toBe('Goal · break even 1,791');
    unmount();
    const again = strip({ budget });
    expect(again.container.querySelectorAll('.health-budget__mark')).toHaveLength(1);
    expect(screen.getByTestId('budget-terms').textContent).not.toMatch(/deficit|surplus/);
  });

  it('rounds readouts without touching the precise data', () => {
    const precise = Object.freeze({ budget: 2100.4, food: 1280.7, exercise: 0, remaining: 819.7, status: 'under' });
    strip({ budget: precise });
    expect(screen.getByTestId('budget-headline')).toHaveTextContent('820 kcal left');
    expect(screen.getByTestId('budget-terms')).toHaveTextContent('1,281 eaten');
    expect(screen.getByTestId('budget-terms').textContent).not.toContain('burned');
    expect(precise.food).toBe(1280.7);
  });

  it('budget failure renders a setup notice, not a crash', () => {
    const err = new Error('conflict'); err.status = 409;
    strip({ budget: null, budgetError: err, onSetupGoals: () => {} });
    expect(screen.getByRole('button', { name: /set up goals/i })).toBeTruthy();
  });
});

describe('EquationStrip — macros', () => {
  it('shows grams without a bar when no goal is set, keeping the partial marker', () => {
    strip({ budget, macroCoverage: { ...coverage(60, 100, 30), protein: { value: 60, covered: 2, total: 3 } } });
    expect(screen.getByLabelText(/^Protein/)).toHaveTextContent('60+ g');
    expect(screen.getByLabelText(/^Carbs/)).toHaveTextContent('100 g');
    expect(document.querySelector('.health-macro-meter__track')).toBeNull();
  });

  it('draws a bar against each macro goal and flags over-goal', () => {
    strip({ budget, macroCoverage: coverage(88, 135, 82), goals: { macroGoals: { proteinG: 140, carbsG: 180, fatG: 70 } } });
    expect(screen.getByLabelText(/^Protein/)).toHaveTextContent('88 / 140 g');
    const fat = screen.getByLabelText(/^Fat/);
    expect(fat).toHaveTextContent('82 / 70 g');
    expect(fat.className).toContain('health-macro-meter--over');
    const fill = el => parseFloat(el.querySelector('.health-macro-meter__fill').style.width);
    expect(fill(screen.getByLabelText(/^Protein/))).toBeCloseTo((88 / 140) * 100, 1);
    expect(fill(fat)).toBe(100);
  });

  it('unknown macros read as a dash', () => {
    strip({ budget });
    expect(screen.getByLabelText(/^Protein/)).toHaveTextContent('— g');
  });
});
