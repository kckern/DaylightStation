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

describe('EquationStrip — the ruler', () => {
  const ranged = { budget: 1791, maintenance: 2291, range: { floor: 1200, top: 1791 }, declared: null };

  it('draws the band, the zone-coloured food block, the hatch and the run', () => {
    strip({ budget: { ...ranged, food: 1390, exercise: 247, net: 1143, zone: 'in-range', remaining: 648, status: 'under' } });
    expect(screen.getByText('Goal 1,200–1,791')).toBeTruthy();
    expect(screen.getByTestId('budget-food').className).toMatch(/food--in-range/);
    expect(screen.getByTestId('budget-earned')).toBeTruthy();
    expect(screen.getByTestId('budget-run')).toBeTruthy();
    expect(screen.getByTestId('budget-ruler').getAttribute('aria-label')).toMatch(/648 left$/);
  });

  it('no exercise, no hatch; a declared day has no run', () => {
    strip({ budget: { ...ranged, food: 600, exercise: 0, net: 600, zone: 'declared', declared: 'done', remaining: 1191, status: 'under' } });
    expect(screen.queryByTestId('budget-earned')).toBeNull();
    expect(screen.queryByTestId('budget-run')).toBeNull();
    expect(screen.getByTestId('budget-food').className).toMatch(/food--declared/);
  });

  it('a negative net is stated with a minus, and the deficit counts it', () => {
    strip({ budget: { ...ranged, food: 100, exercise: 400, net: -300, zone: 'incomplete', remaining: 1100, status: 'under' } });
    expect(screen.getByTestId('budget-terms').textContent).toMatch(/−300 net/);
    expect(screen.getByTestId('budget-terms').textContent).toMatch(/2,591 deficit/);
  });

  it('a budget without a range keeps the legacy bar', () => {
    strip({ budget: { budget: 1791, maintenance: 2291, food: 1000, exercise: 0, remaining: 791, status: 'under' } });
    expect(screen.queryByTestId('budget-ruler')).toBeNull();
  });
});

describe('EquationStrip — the headline names its segment', () => {
  const ranged = { budget: 1791, maintenance: 2291, range: { floor: 1200, top: 1791 }, exercise: 0, declared: null };

  it('an under-logged day still reads what is left to the ceiling', () => {
    strip({ budget: { ...ranged, food: 700, net: 700, zone: 'incomplete', remaining: 1091, status: 'under' } });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/1,091\s*kcal left/);
  });

  it('a declared day says so instead of a number', () => {
    strip({ budget: { ...ranged, food: 600, net: 600, zone: 'declared', declared: 'fasting', remaining: 1191, status: 'under' } });
    expect(screen.getByTestId('budget-headline').textContent).toBe('Fasted');
  });

  it('past break-even says so', () => {
    strip({ budget: { ...ranged, food: 2400, net: 2400, zone: 'past-even', remaining: 109, status: 'over' } });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/109\s*kcal past break even/);
  });
});
