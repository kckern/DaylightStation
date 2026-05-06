import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { WeightHeroCard } from './WeightHeroCard.jsx';
import { WorkoutsHeroCard } from './WorkoutsHeroCard.jsx';
import { CaloriesHeroCard } from './CaloriesHeroCard.jsx';

function r(ui) { return render(<MantineProvider defaultColorScheme="dark">{ui}</MantineProvider>); }

describe('WeightHeroCard', () => {
  it('renders current value, unit, and trend', () => {
    r(<WeightHeroCard data={{
      current: { lbs: 170.7, date: '2026-05-06' },
      trend: { direction: 'down', slopePerWeek: -0.04 },
      history: [170.5, 170.6, 170.7, 170.6, 170.7],
    }} onClick={vi.fn()} />);
    expect(screen.getByText('WEIGHT')).toBeInTheDocument();
    expect(screen.getByText('170.7')).toBeInTheDocument();
    expect(screen.getAllByText(/lbs/).length).toBeGreaterThan(0);
    expect(screen.getByText(/0.04/)).toBeInTheDocument();
  });

  it('invokes onClick when clicked', () => {
    const onClick = vi.fn();
    r(<WeightHeroCard data={{ current: { lbs: 170.7 }, trend: { direction: 'down', slopePerWeek: -0.04 }, history: [] }} onClick={onClick} />);
    fireEvent.click(screen.getByText('WEIGHT').closest('button'));
    expect(onClick).toHaveBeenCalled();
  });

  it('handles missing trend gracefully', () => {
    r(<WeightHeroCard data={{ current: { lbs: 170.7 } }} onClick={vi.fn()} />);
    expect(screen.getByText('170.7')).toBeInTheDocument();
  });
});

describe('WorkoutsHeroCard', () => {
  it('renders weekly count + breakdown', () => {
    r(<WorkoutsHeroCard data={{
      weekCount: 10,
      breakdown: [{ type: 'run', count: 3 }, { type: 'lift', count: 3 }],
    }} onClick={vi.fn()} />);
    expect(screen.getByText('WORKOUTS')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});

describe('CaloriesHeroCard', () => {
  it('renders avg calories + protein', () => {
    r(<CaloriesHeroCard data={{ avg: { calories: 1470, protein: 103 } }} onClick={vi.fn()} />);
    expect(screen.getByText('CALORIES')).toBeInTheDocument();
    expect(screen.getByText(/1,470/)).toBeInTheDocument();
  });
});
