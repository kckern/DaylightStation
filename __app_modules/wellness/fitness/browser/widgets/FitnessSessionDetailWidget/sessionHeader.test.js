import { describe, it, expect } from 'vitest';
import { headerFromDetail, headerFromListRow, mergeHeaders } from './sessionHeader.js';

// The same session as the list row and as the detail: what the header shows
// must not change when the detail lands.
const row = {
  sessionId: '20261015060031', date: '2026-10-15', timezone: 'UTC',
  startTime: Date.parse('2026-10-15T06:00:31Z'), endTime: Date.parse('2026-10-15T06:38:27Z'), elapsedMs: 2276000,
  participants: { kckern: { displayName: 'KC Kern', measuredDurationMs: 2200200 } },
  media: { primary: { contentId: 'plex:738359', title: 'Week 1 Day 1', showTitle: 'Boxing Academy', grandparentId: 'plex:738357', description: 'Shadowboxing.' } },
  totalRings: 258, maxSufferScore: 5, stravaActivityId: 205,
  voiceMemos: [{ transcript: 'It has been a while.' }],
  stravaNotes: null, isGroup: false, activities: [], segments: [{}],
};
const detail = {
  sessionId: '20261015060031', timezone: 'UTC',
  session: { date: '2026-10-15', start: '2026-10-15T06:00:31Z', end: '2026-10-15T06:38:27Z', duration_seconds: 2276 },
  participants: { kckern: { display_name: 'KC Kern', measuredDurationMs: 2200200, strava: { sufferScore: 5, activityId: 205 } } },
  summary: {
    media: [{ contentId: 'plex:738359', title: 'Week 1 Day 1', showTitle: 'Boxing Academy', grandparentId: 'plex:738357', description: 'Shadowboxing.', primary: true }],
    voiceMemos: [{ transcript: 'It has been a while.' }],
  },
  treasureBox: { totalRings: 258 },
  segments: [{}],
};

const SHOWN = ['title', 'showTitle', 'posterUrl', 'thumbUrl', 'description', 'date', 'time', 'endTime',
  'elapsedLabel', 'totalRings', 'sufferScore', 'stravaActivityId', 'isGroup', 'raceCount'];

describe('session header — list row vs detail', () => {
  it('renders the same visible fields from either source', () => {
    const a = headerFromListRow(row);
    const b = headerFromDetail(detail, null);
    for (const k of SHOWN) expect(a[k], k).toEqual(b[k]);
    expect(a.riders).toEqual(b.riders);
    expect(a.voiceMemos.map((m) => m.transcript)).toEqual(b.voiceMemos.map((m) => m.transcript));
  });

  it('marks what the row cannot know as pending', () => {
    const a = headerFromListRow(row);
    expect(a.hasRecap).toBe(false);
    expect(a.preview).toBe(true);
    expect(headerFromListRow({ ...row, media: null, strava: { type: 'Run', name: 'Coal Creek' } }).pendingStrava).toBe(true);
  });
});

describe('mergeHeaders', () => {
  it('fills a group detail\'s missing media, memos and suffer score from the row', () => {
    const groupDetail = headerFromDetail({ sessionId: 'group:1', isGroup: true, participants: {}, summary: {} }, null);
    expect(groupDetail.title).toBe('Workout');
    const merged = mergeHeaders(groupDetail, headerFromListRow({ ...row, isGroup: true }));
    expect(merged.title).toBe('Week 1 Day 1');
    expect(merged.showTitle).toBe('Boxing Academy');
    expect(merged.voiceMemos.map((m) => m.transcript)).toEqual(['It has been a while.']);
    expect(merged.sufferScore).toBe(5);
  });

  it('keeps the detail wherever it has data', () => {
    const d = headerFromDetail(detail, null);
    const r = headerFromListRow({ ...row, totalRings: 1, voiceMemos: [{ transcript: 'stale' }] });
    const merged = mergeHeaders(d, r);
    expect(merged.totalRings).toBe(258);
    expect(merged.voiceMemos.map((m) => m.transcript)).toEqual(['It has been a while.']);
  });
});

