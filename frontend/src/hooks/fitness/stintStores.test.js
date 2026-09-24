import { describe, it, expect } from 'vitest';
import { FitnessTreasureBox } from './TreasureBox.js';
import { TimelineRecorder } from './TimelineRecorder.js';
import { ActivityMonitor } from '../../modules/Fitness/domain/ActivityMonitor.js';
import { ParticipantStatus } from '../../modules/Fitness/domain/types.js';

describe('TreasureBox.moveStint', () => {
  it('moves only the stint delta and conserves the total', () => {
    const tb = new FitnessTreasureBox(null);
    tb.perUser.set('a', { ...tb._createAccumulator(1), profileId: 'a', totalRings: 90, highestZone: { id: 'warm', min: 140 }, lastHR: 150, _lastHRTimestamp: Date.now() });
    tb.perUser.set('b', { ...tb._createAccumulator(1), profileId: 'b', totalRings: 5 });
    const moved = tb.moveStint('a', 'b', { baseRings: 2 });
    expect(moved).toBe(88);
    expect(tb.perUser.get('a').totalRings).toBe(2);
    expect(tb.perUser.get('b').totalRings).toBe(93);
    expect(tb.perUser.get('b').highestZone?.id).toBe('warm');
    expect(tb.perUser.get('a').highestZone).toBeNull();
  });

  it('creates the destination accumulator when missing', () => {
    const tb = new FitnessTreasureBox(null);
    tb.perUser.set('a', { ...tb._createAccumulator(1), profileId: 'a', totalRings: 10 });
    expect(tb.moveStint('a', 'b', { baseRings: 0 })).toBe(10);
    expect(tb.perUser.get('b').profileId).toBe('b');
  });

  it('has no transferAccumulator stub any more', () => {
    expect(FitnessTreasureBox.prototype.transferAccumulator).toBeUndefined();
    expect(FitnessTreasureBox.prototype.renameUser).toBeUndefined();
  });
});

describe('TimelineRecorder.moveStintBeats', () => {
  it('moves the beats delta', () => {
    const r = new TimelineRecorder();
    r._cumulativeBeats.set('a', 586.4);
    r._cumulativeBeats.set('b', 20.3);
    expect(r.moveStintBeats('a', 'b', 0)).toBeCloseTo(586.4);
    expect(r._cumulativeBeats.get('a')).toBe(0);
    expect(r._cumulativeBeats.get('b')).toBeCloseTo(606.7);
  });
});

describe('ActivityMonitor.moveStintActivity', () => {
  it('splits a straddling period at startTick and hands the tail to the destination', () => {
    const m = new ActivityMonitor();
    for (let t = 0; t <= 10; t += 1) m.recordTick(t, new Set(['a']));
    m.moveStintActivity('a', 'b', 6);
    expect(m.getActivityMask('a', 10).slice(0, 6).every(Boolean)).toBe(true);
    expect(m.getActivityMask('a', 10).slice(6).some(Boolean)).toBe(false);
    expect(m.getActivityMask('b', 10).slice(6).every(Boolean)).toBe(true);
    expect(m.isActive('b')).toBe(true);
    expect(m.getStatus('a')).toBe(ParticipantStatus.IDLE);
  });

  it('forgets the source entirely when all its activity moved', () => {
    const m = new ActivityMonitor();
    for (let t = 3; t <= 5; t += 1) m.recordTick(t, new Set(['a']));
    m.moveStintActivity('a', 'b', 3);
    expect(m.getActivityMask('a', 5).some(Boolean)).toBe(false);
    expect(m.wasActiveLastTick('b')).toBe(true);
    expect(m.wasActiveLastTick('a')).toBe(false);
  });
});
