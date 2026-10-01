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

describe('EquationStrip — the card follows the job', () => {
  const ranged = { budget: 1791, maintenance: 2291, range: { floor: 1200, top: 1791 }, declared: null, status: 'under' };
  const live = { date: '2026-09-25', today: '2026-09-25' };
  const sept25 = { ...ranged, food: 1470, exercise: 311, net: 1159, zone: 'in-range', remaining: 632 };

  it('Afford: the 2026-09-25 day reads 321 free and prices the rest', () => {
    strip({ ...live, budget: sept25 });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/321\s*kcal free/);
    expect(screen.getByTestId('budget-sub').textContent).toBe('then 311 workout · 500 deficit · 1,132 to break even');
    for (const key of ['free', 'workout', 'deficit']) expect(screen.getByTestId(`budget-tier-${key}`)).toBeTruthy();
    expect(screen.getByTestId('budget-ruler').getAttribute('aria-label'))
      .toBe('1,470 kcal eaten; goal 1,200–2,102; 321 free, 311 workout, 500 deficit; break even 2,602; 321 kcal free');
  });

  it('the terms line is only what was eaten and burned', () => {
    strip({ ...live, budget: sept25 });
    const terms = screen.getByTestId('budget-terms').textContent;
    expect(terms).toContain('1,470 eaten');
    expect(terms).toContain('311 burned');
    expect(terms).not.toMatch(/net|deficit|surplus/);
  });

  it('the goal range, base and break even are marked at their values', () => {
    const { container } = strip({ ...live, budget: sept25 });
    expect(container.querySelector('.health-budget__goal-label').textContent).toBe('Goal 1,200–2,102');
    expect(screen.getByTestId('budget-range')).toBeTruthy();
    expect(screen.getByTestId('budget-range-band')).toBeTruthy();
    expect(container.querySelector('.health-budget__floor-line')).toBeTruthy();
    expect(container.querySelector('.health-budget__base-line')).toBeTruthy();
    expect(container.querySelector('.health-budget__even-label').textContent).toBe('Break even 2,602');
  });

  it('Trust: under the floor, the free number leads and the ruler is dimmed', () => {
    const { container } = strip({ ...live, budget: { ...ranged, food: 800, exercise: 0, net: 800, zone: 'incomplete', remaining: 991 } });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/991\s*kcal free/);
    expect(screen.getByTestId('budget-sub').textContent).toBe('400 under the 1,200 floor · prices assume the log is complete');
    expect(container.querySelector('.health-budget__ruler--tentative')).toBeTruthy();
  });

  it('Contain: past the plan, the headline counts down to break even and the base stays marked', () => {
    const { container } = strip({ ...live, budget: { ...sept25, food: 2300, net: 1989, zone: 'over', remaining: 198, status: 'over' } });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/302\s*kcal to break even/);
    expect(screen.getByTestId('budget-sub').textContent).toBe('198 over plan');
    expect(container.querySelector('.health-budget__base-line')).toBeTruthy();
  });

  it('Judge: a past day gives a verdict and names tiers as outcomes', () => {
    const { container } = strip({ budget: sept25 }); // strip() defaults to a past date
    expect(screen.getByTestId('budget-headline').textContent).toBe('On plan');
    expect(screen.getByTestId('budget-ruler').getAttribute('aria-label')).toContain('321 unused, 311 banked, 500 deficit');
    expect(container.querySelector('.health-budget__ruler--finished')).toBeTruthy();
  });

  it('while a portion is dragged, the sub-line prices it', () => {
    strip({ ...live, baseline: sept25, budget: { ...sept25, food: 1900, net: 1589, remaining: 202 } });
    expect(screen.getByTestId('budget-sub').textContent).toBe('this costs 321 free + 109 workout');
  });

  it('the eaten label rides above every tier, its right edge on the frontier', () => {
    strip({ ...live, budget: sept25 });
    const label = screen.getByTestId('budget-food-label');
    expect(label.textContent).toBe('1,470 eaten');
    const food = screen.getByTestId('budget-food');
    expect(parseFloat(label.style.right)).toBeCloseTo(100 - (parseFloat(food.style.left) + parseFloat(food.style.width)), 1);
  });

  it('no exercise: no workout tier and no base mark', () => {
    const { container } = strip({ ...live, budget: { ...ranged, food: 1470, exercise: 0, net: 1470, zone: 'in-range', remaining: 321 } });
    expect(screen.queryByTestId('budget-tier-workout')).toBeNull();
    expect(container.querySelector('.health-budget__base-line')).toBeNull();
  });

  it('a plan capped at break even: no base mark, and the goal says so', () => {
    const { container } = strip({ ...live, budget: { ...ranged, range: { floor: 1200, top: 1200 }, maintenance: 1100, food: 900, exercise: 0, net: 900, zone: 'incomplete', remaining: 300 } });
    expect(container.querySelector('.health-budget__base-line')).toBeNull();
    expect(container.querySelector('.health-budget__goal-label').textContent).toBe('Goal · break even 1,100');
  });

  it('a story with no sub-line renders no sub element', () => {
    // No maintenance, so no break even: over plan is the whole story.
    strip({ ...live, budget: { ...sept25, maintenance: 0, food: 2300, net: 1989, zone: 'over', remaining: 0, status: 'over' } });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/198\s*kcal over plan/);
    expect(screen.queryByTestId('budget-sub')).toBeNull();
  });

  it('a missed-plan verdict carries the judge and over classes', () => {
    strip({ budget: { ...sept25, food: 2300, net: 1989, zone: 'over', remaining: 198, status: 'over' } });
    const headline = screen.getByTestId('budget-headline');
    expect(headline.textContent).toBe('Missed plan by 198');
    expect(headline.classList.contains('health-budget__headline--job-judge')).toBe(true);
    expect(headline.classList.contains('health-budget__headline--over')).toBe(true);
  });

  it('a budget without a range keeps the legacy bar', () => {
    strip({ ...live, budget: { budget: 1791, maintenance: 2291, food: 1000, exercise: 0, remaining: 791, status: 'under' } });
    expect(screen.queryByTestId('budget-ruler')).toBeNull();
    expect(screen.queryByTestId('budget-sub')).toBeNull();
  });
});
