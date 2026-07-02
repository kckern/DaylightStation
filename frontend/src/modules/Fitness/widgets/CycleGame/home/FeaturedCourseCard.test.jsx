import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import FeaturedCourseCard from './FeaturedCourseCard.jsx';

const LADDER = {
  course: { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 },
  week: { start: '2026-06-29', end: '2026-07-06' },
  standings: [
    { userId: 'dad', bestValue: 150, raceId: 'r1', attempts: 2 },
    { userId: 'user_3', bestValue: 190.4, raceId: 'r2', attempts: 1 }
  ],
  allTimeRecord: { userId: 'dad', bestValue: 141, raceId: 'r0', date: '2026-05-12' }
};
const names = { dad: 'Dad', user_3: 'User_3' };
const resolveName = (id) => names[id] || id;

afterEach(cleanup);

describe('FeaturedCourseCard', () => {
  it('renders course, standings with formatted times, record, and Ride It', () => {
    render(<FeaturedCourseCard ladder={LADDER} onRide={() => {}} resolveName={resolveName} />);
    expect(screen.getByTestId('featured-course-card')).toBeTruthy();
    expect(screen.getByText('Sprint 1500')).toBeTruthy();
    expect(screen.getByTestId('featured-row-dad').textContent).toContain('2:30');
    expect(screen.getByTestId('featured-row-user_3').textContent).toContain('3:10');
    expect(screen.getByText(/2:21/).textContent).toBeTruthy(); // all-time record
    expect(screen.getByTestId('featured-ride')).toBeTruthy();
  });

  it('formats time-course values as distance', () => {
    const l = {
      ...LADDER,
      course: { id: 'e5', label: 'Endurance 5', win_condition: 'time', time_cap_s: 300 },
      standings: [{ userId: 'dad', bestValue: 2140, raceId: 'r1', attempts: 1 }],
      allTimeRecord: null
    };
    render(<FeaturedCourseCard ladder={l} onRide={() => {}} resolveName={resolveName} />);
    expect(screen.getByTestId('featured-row-dad').textContent).toContain('2.14 km');
  });

  it('shows empty-standings copy when nobody has ridden this week', () => {
    const l = { ...LADDER, standings: [], allTimeRecord: null };
    render(<FeaturedCourseCard ladder={l} onRide={() => {}} resolveName={resolveName} />);
    expect(screen.queryByTestId('featured-row-dad')).toBeNull();
    expect(screen.getByTestId('featured-course-card').textContent).toMatch(/no rides yet/i);
  });

  it('shows the days-remaining chip based on the ladder week', () => {
    render(<FeaturedCourseCard ladder={LADDER} onRide={() => {}} resolveName={resolveName} />);
    expect(screen.getByTestId('featured-course-card').textContent).toMatch(/Ends in \d+d|Final day/);
  });

  it('fires onRide and renders nothing without a ladder', () => {
    const onRide = vi.fn();
    const { container, rerender } = render(
      <FeaturedCourseCard ladder={LADDER} onRide={onRide} resolveName={resolveName} />
    );
    fireEvent.click(screen.getByTestId('featured-ride'));
    expect(onRide).toHaveBeenCalledTimes(1);
    rerender(<FeaturedCourseCard ladder={null} onRide={onRide} resolveName={resolveName} />);
    expect(container.querySelector('[data-testid="featured-course-card"]')).toBeNull();
  });
});
