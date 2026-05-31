// frontend/src/modules/WeeklyReview/components/DayContextPanel.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DayContextPanel from './DayContextPanel.jsx';

const day = {
  date: '2026-04-21',
  weather: { code: 0, high: 22, low: 12, precip: 0 },
  calendar: [{ time: '8:30 AM', summary: 'Standup' }],
  fitness: [{ sessionId: '20260421073000', durationMs: 1800000, media: { primary: { title: 'Peloton' } }, participants: {} }],
  photos: [{ id: 'p1', people: ['Mara'], type: 'image', takenAt: '2026-04-21T14:30:00Z' }],
  photoCount: 1,
  sessions: [],
};

describe('DayContextPanel', () => {
  it('renders timeline, weather, people, and summary when open', () => {
    render(<DayContextPanel day={day} open={true} />);
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText('Weather')).toBeInTheDocument();
    expect(screen.getByText('Mara')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<DayContextPanel day={day} open={false} />);
    expect(container.firstChild).toBeNull();
  });
});
