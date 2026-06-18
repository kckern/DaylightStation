import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DayDataPoints from './DayDataPoints.jsx';

describe('DayDataPoints', () => {
  it('renders weather, timeline events and a summary for a day with data', () => {
    const day = {
      date: '2026-04-21',
      weather: { code: 0, high: 22, low: 12, precip: 0 },
      calendar: [{ time: '8:30 AM', summary: 'Standup' }],
      fitness: [{ sessionId: '20260421073000', durationMs: 1800000, media: { primary: { title: 'Peloton' } }, participants: {} }],
      photos: [], photoCount: 0,
    };
    render(<DayDataPoints day={day} />);
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText(/Peloton/)).toBeInTheDocument();
    expect(screen.getByText(/72°/)).toBeInTheDocument(); // 22C -> 72F
  });

  it('shows a quiet-day fallback when the day has no data at all', () => {
    const day = { date: '2026-04-22', weather: null, calendar: [], fitness: [], photos: [], photoCount: 0 };
    render(<DayDataPoints day={day} />);
    expect(screen.getByText(/Quiet day/i)).toBeInTheDocument();
  });
});
