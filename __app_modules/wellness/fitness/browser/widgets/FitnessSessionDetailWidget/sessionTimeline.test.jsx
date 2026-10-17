import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { buildSessionAxis, buildSessionMarks, axisOpts } from './sessionTimeline.js';
import { msToTickX } from './timelineOverlay.js';
import TimelineOverlay from './TimelineOverlay.jsx';

const START = Date.parse('2026-10-13T10:52:00Z');
const min = (m) => m * 60_000;
const session = {
  sessionId: 'group:1',
  session: { start: '2026-10-13T10:52:00Z' },
  timeline: {
    interval_seconds: 5,
    tick_count: 564, // 47 minutes
    series: {},
    events: [
      { type: 'challenge', data: { type: 'zone', zoneId: 'warm', start: START + min(10), end: START + min(12), requiredCount: 2 } },
      { type: 'media', data: { contentId: 'plex:1', title: 'Opening video', start: START } },
      { type: 'media', data: { contentId: 'plex:2', title: 'Second video', grandparentId: 'plex:20', start: START + min(18) } },
    ],
  },
  seams: [{ atMs: min(16), gapMs: 30_000 }],
  activities: [{ type: 'race', items: [{ startMs: START + min(20), endMs: START + min(30), meta: { raceId: 'r1' } }] }],
};

describe('session timeline — one axis, one mark list', () => {
  it('takes the axis from the session (tick_count, interval, start)', () => {
    const axis = buildSessionAxis(session);
    expect(axis.effectiveTicks).toBe(564);
    expect(axis.intervalMs).toBe(5000);
    expect(axis.sessionStartMs).toBe(START);
  });

  it('places every kind of mark on that one axis', () => {
    const axis = buildSessionAxis(session);
    const width = 845;
    const marks = buildSessionMarks(session, axis, width, 'plex:1');
    const x = (ms) => msToTickX(ms, axisOpts(axis, width));
    expect(marks.challenges).toHaveLength(1);
    expect(marks.challenges[0].x).toBeCloseTo(x(min(10)));
    expect(marks.challenges[0].badgeX).toBeGreaterThan(0);
    expect(marks.seams[0].x).toBeCloseTo(x(min(16)));
    // the opening (primary) video is the header's; only the change is marked
    expect(marks.videos).toHaveLength(1);
    expect(marks.videos[0].x).toBeCloseTo(x(min(18)));
    expect(marks.bands[0].x).toBeCloseTo(x(min(20)));
  });

  it('draws each mark once, full height', () => {
    const axis = buildSessionAxis(session);
    const marks = buildSessionMarks(session, axis, 845, 'plex:1');
    const { container } = render(<TimelineOverlay marks={marks} width={845} top={40} height={600} />);
    const svg = container.querySelector('svg.session-detail__overlay');
    expect(svg.style.top).toBe('40px');
    const fullHeight = [...svg.querySelectorAll('line')].filter((l) => l.getAttribute('y1') === '0' && l.getAttribute('y2') === '600');
    // challenge end + seam + video change
    expect(fullHeight).toHaveLength(3);
    const tallRects = [...svg.querySelectorAll('rect')].filter((r) => r.getAttribute('height') === '600');
    // challenge span + race band
    expect(tallRects).toHaveLength(2);
  });
});


it('aligns playback intervals with challenge markers on the existing axis at different widths', () => {
  const event = (at, state, observation) => ({ type: 'playback_state', timestamp: START + at, data: { version: 1, contentId: 'plex:1', playbackRunId: 'r1', state, observation } });
  const detail = { ...session, timeline: { ...session.timeline, events: [...session.timeline.events, event(0, 'waiting', 'begin'), event(min(10), 'playing', 'change'), event(min(15), 'none', 'end')] } };
  for (const width of [400, 845]) {
    const axis = buildSessionAxis(detail);
    const marks = buildSessionMarks(detail, axis, width, 'plex:1');
    expect(marks.playback.find(p => p.state === 'playing').x).toBeCloseTo(marks.challenges[0].x);
  }
});
