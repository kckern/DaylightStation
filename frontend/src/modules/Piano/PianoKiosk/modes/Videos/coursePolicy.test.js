// coursePolicy.test.js — per-user course policy resolution + auto-advance target.
import { describe, it, expect } from 'vitest';
import { resolveCoursePolicy, nextLectureAfter } from './coursePolicy.js';

describe('resolveCoursePolicy', () => {
  const cfg = {
    user_policies: {
      kckern: { engagement_gate: false, auto_advance: true },
      felix: { engagement_gate: true },
    },
  };

  it('defaults: gate on, no auto-advance', () => {
    expect(resolveCoursePolicy(cfg, 'milo')).toEqual({ engagementGate: true, autoAdvance: false });
  });

  it('kckern: gate off, auto-advance on', () => {
    expect(resolveCoursePolicy(cfg, 'kckern')).toEqual({ engagementGate: false, autoAdvance: true });
  });

  it('partial entry only overrides what it names', () => {
    expect(resolveCoursePolicy(cfg, 'felix')).toEqual({ engagementGate: true, autoAdvance: false });
  });

  it('tolerates missing config and missing user', () => {
    expect(resolveCoursePolicy(null, 'kckern')).toEqual({ engagementGate: true, autoAdvance: false });
    expect(resolveCoursePolicy({}, null)).toEqual({ engagementGate: true, autoAdvance: false });
  });
});

describe('nextLectureAfter', () => {
  const items = [
    { plex: '100', label: 'One' },
    { plex: '101', label: 'Two' },
    { label: 'Broken (no id)' },
    { plex: '103', label: 'Four' },
  ];

  it('returns the next item in delivered order', () => {
    expect(nextLectureAfter(items, 'plex:100')?.plex).toBe('101');
  });

  it('skips items without a playable contentId', () => {
    expect(nextLectureAfter(items, 'plex:101')?.plex).toBe('103');
  });

  it('returns null at the end of the course', () => {
    expect(nextLectureAfter(items, 'plex:103')).toBe(null);
  });

  it('returns null when the current lecture is not in the list or the list is empty', () => {
    expect(nextLectureAfter(items, 'plex:999')).toBe(null);
    expect(nextLectureAfter(null, 'plex:100')).toBe(null);
  });
});
