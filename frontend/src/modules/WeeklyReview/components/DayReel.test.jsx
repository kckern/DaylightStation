// frontend/src/modules/WeeklyReview/components/DayReel.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DayReel from './DayReel.jsx';

const photo = { id: 'p1', type: 'image', original: '/o.jpg', thumbnail: '/t.jpg', takenAt: '2026-04-21T14:30:00Z', people: ['Mara'] };
const video = { id: 'v1', type: 'video', original: '/v.mp4', thumbnail: '/vt.jpg', takenAt: '2026-04-21T15:00:00Z', people: [] };
const dayLabel = 'Tuesday, April 21';

describe('DayReel', () => {
  it('shows a fullscreen photo with index indicator', () => {
    render(<DayReel item={photo} index={0} total={3} dayLabel={dayLabel} playing={false} muted paused={false} />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText(dayLabel)).toBeInTheDocument();
  });

  it('shows a play hint on a video poster when not playing', () => {
    render(<DayReel item={video} index={1} total={3} dayLabel={dayLabel} playing={false} muted paused={false} />);
    expect(screen.getByText(/Enter/)).toBeInTheDocument();
  });

  it('renders a video element when playing', () => {
    const { container } = render(<DayReel item={video} index={1} total={3} dayLabel={dayLabel} playing={true} muted paused={false} onEnded={() => {}} />);
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('surfaces the day data points when there is no media', () => {
    const day = { date: '2026-04-21', weather: { code: 0, high: 22, low: 12, precip: 0 }, calendar: [{ time: '8:30 AM', summary: 'Standup' }], fitness: [], photos: [], photoCount: 0 };
    render(<DayReel item={null} day={day} index={0} total={0} dayLabel={dayLabel} playing={false} muted paused={false} />);
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText(/72°/)).toBeInTheDocument();
    expect(screen.getByText(dayLabel)).toBeInTheDocument();
  });

  it('shows a quiet-day fallback for a day with no data', () => {
    const day = { date: '2026-04-22', weather: null, calendar: [], fitness: [], photos: [], photoCount: 0 };
    render(<DayReel item={null} day={day} index={0} total={0} dayLabel={dayLabel} playing={false} muted paused={false} />);
    expect(screen.getByText(/Quiet day/i)).toBeInTheDocument();
  });
});
