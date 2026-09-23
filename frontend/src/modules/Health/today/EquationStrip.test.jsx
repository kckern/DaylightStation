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
  it('headlines what is left and states the terms without a negative number', () => {
    strip({ budget, macroCoverage: coverage(88, 135, 82) });
    expect(screen.getByTestId('budget-headline')).toHaveTextContent('419 kcal left');
    const terms = screen.getByTestId('budget-terms').textContent;
    expect(terms).toContain('1,603 eaten of 2,022');
    expect(terms).toContain('budget 1,791');
    expect(terms).toContain('+231 exercise');
    expect(document.body.textContent).not.toMatch(/[−-]\s?1,603/);
  });

  it('fills food against budget + exercise, with exercise as its own segment', () => {
    strip({ budget, macroCoverage: coverage(88, 135, 82) });
    const bar = screen.getByRole('img', { name: /1,603 of 2,022 kcal/ });
    const pct = el => parseFloat(el.style.width);
    expect(pct(bar.querySelector('.health-budget__food'))).toBeCloseTo((1603 / 2022) * 100, 1);
    expect(pct(bar.querySelector('.health-budget__exercise'))).toBeCloseTo((231 / 2022) * 100, 1);
    expect(bar.querySelector('.health-budget__over')).toBeNull();
  });

  it('over budget: says how much over and draws the overage past the end marker', () => {
    const { container } = strip({ budget: { budget: 1800, food: 2200, exercise: 200, remaining: -200, status: 'over' } });
    expect(container.querySelector('.health-equation--over')).toBeTruthy();
    expect(screen.getByTestId('budget-headline')).toHaveTextContent('200 kcal over');
    const bar = screen.getByRole('img', { name: /2,200 of 2,000 kcal/ });
    const pct = el => parseFloat(el.style.width);
    // Scale is the food total once it passes capacity, so the marker moves in.
    expect(pct(bar.querySelector('.health-budget__food'))).toBeCloseTo((2000 / 2200) * 100, 1);
    expect(pct(bar.querySelector('.health-budget__over'))).toBeCloseTo((200 / 2200) * 100, 1);
  });

  it('rounds readouts without touching the precise data', () => {
    const precise = Object.freeze({ budget: 2100.4, food: 1280.7, exercise: 0, remaining: 819.7, status: 'under' });
    strip({ budget: precise });
    expect(screen.getByTestId('budget-headline')).toHaveTextContent('820 kcal left');
    expect(screen.getByTestId('budget-terms')).toHaveTextContent('1,281 eaten of 2,100');
    expect(screen.getByTestId('budget-terms').textContent).not.toContain('exercise');
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
