// frontend/src/modules/WeeklyReview/components/DayContextPanel.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DayContextPanel from "./DayContextPanel.jsx";

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

  const schoolAll = [
    { learnerId: 'kid-a', learnerName: 'Mara', kind: 'book', verb: 'finished', title: 'Wonder', subtitle: 'R. J. Palacio',
      at: '2026-04-21T15:00:00Z', studyDay: '2026-04-21', imageUrl: null, groupKey: 'book:wonder', subject: 'reading' },
    { learnerId: 'kid-b', learnerName: 'Theo', kind: 'course', verb: 'worked', title: 'Math 2', subtitle: null,
      at: '2026-04-21T16:00:00Z', studyDay: '2026-04-21', imageUrl: null, groupKey: 'course:math', subject: 'math' },
    { learnerId: 'kid-a', learnerName: 'Mara', kind: 'activity', verb: 'completed', title: 'Maze', subtitle: null,
      at: '2026-04-21T17:00:00Z', studyDay: '2026-04-21', imageUrl: null, groupKey: 'activity:maze', subject: 'activity' },
  ];

  it('lists the day\'s school work grouped by child', () => {
    const { container } = render(<DayContextPanel day={{ ...day, schoolAll }} open={true} learnerColors={{ 'kid-a': '#2f6fde' }} />);
    const section = container.querySelector('section.context-school');
    expect(section).not.toBeNull();
    expect(section.querySelector('h3').textContent).toBe('School');
    const groups = section.querySelectorAll('.context-school-learner');
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector('.context-school-name').textContent).toBe('Mara');
    expect(groups[0].style.getPropertyValue('--kid')).toBe('#2f6fde');
    expect([...groups[0].querySelectorAll('.context-school-line')].map(l => l.textContent))
      .toEqual(['Finished Wonder — R. J. Palacio', 'Completed Maze']);
    expect(groups[1].textContent).toContain('Worked on Math 2');
  });

  it('has no School section when the day has no school work', () => {
    const { container } = render(<DayContextPanel day={{ ...day, schoolAll: [] }} open={true} />);
    expect(container.querySelector('.context-school')).toBeNull();
  });

  it('does not call a school-only day quiet', () => {
    const bare = { date: '2026-04-21', weather: null, calendar: [], fitness: [], photos: [], photoCount: 0, schoolAll };
    render(<DayContextPanel day={bare} open={true} />);
    expect(screen.queryByText(/Quiet day/i)).toBeNull();
    expect(screen.getByText('3 school items')).toBeInTheDocument();
  });
});
