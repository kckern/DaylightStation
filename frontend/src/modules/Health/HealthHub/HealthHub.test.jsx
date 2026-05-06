import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import HealthHub from './index.jsx';

function r(ui) { return render(<MantineProvider defaultColorScheme="dark">{ui}</MantineProvider>); }

const FULL_DASHBOARD = {
  userId: 'testuser',
  today: {
    weight: { lbs: 170.7, trend: -0.006 },
    nutrition: { calories: 1500, protein: 100, carbs: 180, fat: 50 },
    sessions: [{ sessionId: 's1', title: 'Run', type: 'run', totalCoins: 5 }],
  },
  recency: [{ source: 'weight', name: 'Weight', daysSince: 0, status: 'recent' }],
  goals: [],
  history: {
    daily: [
      { date: '2026-05-05', weight: { lbs: 170.5 }, nutrition: { calories: 1470, protein: 103 } },
      { date: '2026-05-04', weight: { lbs: 170.6 }, nutrition: { calories: 1490, protein: 101 } },
    ],
    weekly: [{ weekCount: 4, sessionCount: 4 }],
    monthly: [],
  },
};

describe('HealthHub', () => {
  it('renders skeleton when loading', () => {
    const { container } = r(<HealthHub loading={true} dashboard={null} />);
    expect(container.querySelector('.health-hub')).toBeTruthy();
    // Mantine Skeleton renders div elements — confirm at least one is present
    const skeletons = container.querySelectorAll('[class*="mantine"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders nothing visible when not loading and no dashboard', () => {
    const { container } = r(<HealthHub loading={false} dashboard={null} />);
    expect(container.querySelector('.health-hub')).toBeNull();
  });

  it('renders three hero cards from dashboard data', () => {
    r(<HealthHub loading={false} dashboard={FULL_DASHBOARD} />);
    expect(screen.getByText('WEIGHT')).toBeInTheDocument();
    expect(screen.getByText('WORKOUTS')).toBeInTheDocument();
    expect(screen.getByText('CALORIES')).toBeInTheDocument();
  });

  it('renders the hero layout structure', () => {
    const { container } = r(<HealthHub loading={false} dashboard={FULL_DASHBOARD} />);
    expect(container.querySelector('.health-hub')).toBeTruthy();
    expect(container.querySelector('.health-hub__hero')).toBeTruthy();
    expect(container.querySelector('.health-hub__secondary')).toBeTruthy();
  });

  it('invokes onCardClick("weight") when weight hero card clicked', () => {
    const onCardClick = vi.fn();
    r(<HealthHub loading={false} dashboard={FULL_DASHBOARD} onCardClick={onCardClick} />);
    fireEvent.click(screen.getByText('WEIGHT').closest('button'));
    expect(onCardClick).toHaveBeenCalledWith('weight');
  });

  it('invokes onCardClick("sessions") when workouts hero card clicked', () => {
    const onCardClick = vi.fn();
    r(<HealthHub loading={false} dashboard={FULL_DASHBOARD} onCardClick={onCardClick} />);
    fireEvent.click(screen.getByText('WORKOUTS').closest('button'));
    expect(onCardClick).toHaveBeenCalledWith('sessions');
  });

  it('invokes onCardClick("nutrition") when calories hero card clicked', () => {
    const onCardClick = vi.fn();
    r(<HealthHub loading={false} dashboard={FULL_DASHBOARD} onCardClick={onCardClick} />);
    fireEvent.click(screen.getByText('CALORIES').closest('button'));
    expect(onCardClick).toHaveBeenCalledWith('nutrition');
  });

  it('renders secondary grid with existing detail cards', () => {
    const { container } = r(<HealthHub loading={false} dashboard={FULL_DASHBOARD} />);
    const secondary = container.querySelector('.health-hub__secondary');
    expect(secondary).toBeTruthy();
    // At least some child nodes in the secondary section
    expect(secondary.children.length).toBeGreaterThan(0);
  });

  it('renders with minimal dashboard (no history, no sessions)', () => {
    r(<HealthHub loading={false} dashboard={{
      userId: 'x',
      today: {},
      recency: [],
      goals: [],
      history: { daily: [], weekly: [], monthly: [] },
    }} />);
    expect(screen.getByText('WEIGHT')).toBeInTheDocument();
    expect(screen.getByText('WORKOUTS')).toBeInTheDocument();
    expect(screen.getByText('CALORIES')).toBeInTheDocument();
  });
});
