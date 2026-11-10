import { describe, it, expect } from 'vitest';
import { countHrReadings, evaluateJunkSession, evaluateJunkSessionRecord, MIN_HR_READINGS } from './junkSession.mjs';

// The 2026-11-08 record as it sits on disk: a guest strap gave 3 readings, then 50 empty ticks.
const strayStrap = {
  participants: { 'device:2747': { display_name: '#2747', hr_device: '2747', is_guest: true } },
  timeline: { series: { 'device:2747:heart-rate': '[[120,3],[null,50]]' }, events: [] },
  treasureBox: { totalRings: 0 },
  summary: { media: [], rings: { total: 0 }, voiceMemos: [] },
};

describe('junkSession', () => {
  it('counts HR readings across decoded, RLE and RLE-string series', () => {
    expect(countHrReadings({ 'a:hr': [100, null, 101] })).toBe(2);
    expect(countHrReadings({ 'a:heart_rate': [[100, 5], [null, 3], 110] })).toBe(6);
    expect(countHrReadings({ 'a:heart-rate': '[[120,3],[null,50]]', 'b:hr': '[[0,40]]' })).toBe(3);
  });

  it('flags a stray strap that flashed a few seconds of HR', () => {
    expect(evaluateJunkSessionRecord(strayStrap)).toMatchObject({ junk: true, hrReadings: 3 });
  });

  it('flags a stuck equipment value as no movement', () => {
    const record = structuredClone(strayStrap);
    record.timeline.series['vib:punching-bag:intensity'] = '[[1150,50],[null,1]]';
    record.timeline.series['vib:punching-bag:impacts'] = '[[9,50],0]';
    expect(evaluateJunkSessionRecord(record).junk).toBe(true);
  });

  it('keeps a session with a minute of HR', () => {
    const series = { 'kc:hr': Array(MIN_HR_READINGS).fill(130) };
    expect(evaluateJunkSession({ series }).junk).toBe(false);
  });

  it.each([
    ['events', { events: [{ type: 'media' }] }],
    ['voice memos', { voiceMemos: [{ transcript: 'hi' }] }],
    ['rings', { totalRings: 4 }],
    ['strength runs', { strengthRuns: [{}] }],
    ['an outside record', { external: true }],
    ['equipment that moved', { series: { 'bike:rpm': [60, 72, 80] } }],
  ])('keeps a short session with %s', (_label, extra) => {
    expect(evaluateJunkSession({ series: { 'kc:hr': [120, 121] }, ...extra }).junk).toBe(false);
  });

  it('keeps Strava imports, which carry no series at all', () => {
    expect(evaluateJunkSessionRecord({ strava: { activityId: 1 }, timeline: { series: {}, events: [] } }).junk).toBe(false);
    expect(evaluateJunkSessionRecord({ session: { source: 'strava' }, timeline: { series: {} } }).junk).toBe(false);
  });
});
