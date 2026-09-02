import { describe, test, expect } from 'vitest';
import { ringsByContentId, parseClock } from './backfillMediaRings.mjs';

const START = '2026-09-01 10:00:00.000';
const startMs = parseClock(START);
// 60 ticks of 5s, +10 rings each, stored in the on-disk RLE-string form.
const cumulative = JSON.stringify(Array.from({ length: 60 }, (_, i) => i * 10));

const session = (events, series = { 'global:rings': cumulative }) => ({
  session: { start: START },
  timeline: { interval_seconds: 5, series, events },
});
const mediaEvent = (contentId, offsetStartSec, offsetEndSec, extra = {}) => ({
  type: 'media',
  data: { contentId, start: startMs + offsetStartSec * 1000, end: startMs + offsetEndSec * 1000, ...extra },
});

describe('ringsByContentId', () => {
  test('scores an item by the rings earned across its span', () => {
    const map = ringsByContentId(session([mediaEvent('plex:1', 60, 120)]));
    expect(map.get('plex:1')).toBe(120);
  });

  test('decodes the stored RLE string form, not just raw arrays', () => {
    // The series on disk is a JSON string; reading it as an array would index
    // into characters and score nonsense.
    const map = ringsByContentId(session([mediaEvent('plex:1', 0, 60)]));
    expect(map.get('plex:1')).toBe(110);
  });

  test('skips audio tracks', () => {
    const map = ringsByContentId(session([
      mediaEvent('plex:song', 0, 60, { contentType: 'track', artist: 'A' }),
    ]));
    expect(map.has('plex:song')).toBe(false);
  });

  test('scores nothing when there is no ring series', () => {
    expect(ringsByContentId(session([mediaEvent('plex:1', 0, 60)], {})).size).toBe(0);
  });

  test('leaves an item the series does not reach UNSCORED, not zero', () => {
    // A reload-truncated timeline: the workout ran before the surviving ticks.
    // Scoring it 0 would hand primary to whatever played afterwards, which is
    // the inversion this feature exists to prevent.
    const map = ringsByContentId(session([mediaEvent('plex:early', -1800, -1200)]));
    expect(map.has('plex:early')).toBe(false);
  });

  test('scores nothing without a parseable session start', () => {
    const s = session([mediaEvent('plex:1', 0, 60)]);
    s.session.start = null;
    expect(ringsByContentId(s).size).toBe(0);
  });

  test('ignores an event with no span', () => {
    const s = session([{ type: 'media', data: { contentId: 'plex:1', start: startMs, end: null } }]);
    expect(s && ringsByContentId(s).has('plex:1')).toBe(false);
  });

  test('separates two items that played back to back', () => {
    const map = ringsByContentId(session([
      mediaEvent('plex:a', 0, 60),
      mediaEvent('plex:b', 60, 120),
    ]));
    expect(map.get('plex:a')).toBe(110);
    expect(map.get('plex:b')).toBe(120);
  });
});
