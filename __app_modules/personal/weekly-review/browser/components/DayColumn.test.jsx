import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DayColumn from "./DayColumn.jsx";

const baseDay = {
  date: '2026-04-21', label: 'Tue', photoCount: 0, photos: [],
  calendar: [{ time: '8:30 AM', summary: 'Standup' }], fitness: [], weather: null, columnWeight: 1,
};

describe('DayColumn', () => {
  it('treats a calendar-only day as content (not dimmed --empty)', () => {
    const { container } = render(<DayColumn day={baseDay} isFocused={false} onClick={() => {}} />);
    expect(container.querySelector('.day-column--empty')).toBeNull();
  });

  it('includes events in the aria-label', () => {
    render(<DayColumn day={baseDay} isFocused={false} onClick={() => {}} />);
    const el = screen.getByRole('button');
    expect(el.getAttribute('aria-label')).toMatch(/1 event/);
  });

  it('marks a truly empty day as --empty', () => {
    const empty = { ...baseDay, calendar: [] };
    const { container } = render(<DayColumn day={empty} isFocused={false} onClick={() => {}} />);
    expect(container.querySelector('.day-column--empty')).not.toBeNull();
  });

  const school = [
    { learnerId: 'kid-a', learnerName: 'mara', kind: 'book', verb: 'finished', title: 'Wonder', subtitle: null,
      at: '2026-04-21T22:00:00Z', studyDay: '2026-04-21', imageUrl: '/work-a.jpg', groupKey: 'book:wonder', subject: 'reading' },
    { learnerId: 'kid-b', learnerName: 'Theo', kind: 'program', verb: 'worked', title: 'Korean', subtitle: null,
      at: '2026-04-21T23:00:00Z', studyDay: '2026-04-21', imageUrl: null, groupKey: 'program:korean', subject: 'language' },
  ];

  it('shows a strip of school chips in each child hue', () => {
    const day = { ...baseDay, calendar: [], school };
    const { container } = render(<DayColumn day={day} isFocused={false} onClick={() => {}} learnerColors={{ 'kid-a': '#2f6fde', 'kid-b': '#f28c28' }} />);
    const chips = container.querySelectorAll('.day-school .school-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0].style.getPropertyValue('--kid')).toBe('#2f6fde');
    expect(chips[0].getAttribute('title')).toBe('mara: Finished Wonder');
    expect(chips[0].querySelector('img').getAttribute('src')).toBe('/work-a.jpg');
    expect(chips[1].getAttribute('title')).toBe('Theo: Practiced Korean');
    expect(chips[1].querySelector('.school-chip-glyph').textContent).toBe('🔤');
    expect(chips[1].querySelector('.school-chip-initial').textContent).toBe('T');
    // School work alone makes the day count as content.
    expect(container.querySelector('.day-column--empty')).toBeNull();
  });

  it('has no strip when the day has no school work', () => {
    const { container } = render(<DayColumn day={{ ...baseDay, school: [] }} isFocused={false} onClick={() => {}} />);
    expect(container.querySelector('.day-school')).toBeNull();
  });

  it('falls back to the subject glyph when a chip image fails', () => {
    const day = { ...baseDay, calendar: [], school: [school[0]] };
    const { container } = render(<DayColumn day={day} isFocused={false} onClick={() => {}} />);
    fireEvent.error(container.querySelector('.school-chip img'));
    expect(container.querySelector('.school-chip img')).toBeNull();
    expect(container.querySelector('.school-chip-glyph').textContent).toBe('📕');
  });
});
