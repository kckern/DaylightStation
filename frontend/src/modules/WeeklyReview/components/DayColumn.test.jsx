import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DayColumn from './DayColumn.jsx';

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
});
