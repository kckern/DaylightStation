import { beforeEach, describe, expect, it } from 'vitest';
import { clearFlightCheckpoint, readFlightCheckpoint, writeFlightCheckpoint } from './checkpointRepository.js';

const course = { id: 'mountain-pass', version: 2 };
const identity = { fitnessSessionId: 'fs-1', riderId: 'test-rider', equipmentId: 'niceday', calibration: { lowRpm: 30, highRpm: 100 }, runId: 'run-1', startedAt: '2026-10-07T18:00:00Z' };

describe('Skyline Glider checkpoint repository', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips only an exactly compatible active checkpoint', () => {
    writeFlightCheckpoint('test-rider', course, { identity, state: { courseTime: 75, collectedIds: ['a'] } });
    expect(readFlightCheckpoint('test-rider', course, identity)).toMatchObject({ status: 'compatible', identity: { runId: 'run-1' }, state: { courseTime: 75 } });
    for (const [field, value] of [['fitnessSessionId', 'fs-2'], ['riderId', 'alex'], ['equipmentId', 'cycle_ace'], ['runId', 'run-2']]) {
      expect(readFlightCheckpoint('test-rider', course, { ...identity, [field]: value }).status).toBe('incompatible');
    }
    expect(readFlightCheckpoint('test-rider', course, { ...identity, calibration: { lowRpm: 20, highRpm: 90 } }).status).toBe('incompatible');
  });
  it('returns explicit missing, invalid, legacy, and course mismatch states', () => {
    expect(readFlightCheckpoint('test-rider', course, identity).status).toBe('missing');
    localStorage.setItem('fitness:skyline-glider:test-rider:mountain-pass', '{oops');
    expect(readFlightCheckpoint('test-rider', course, identity).status).toBe('invalid');
    localStorage.setItem('fitness:skyline-glider:test-rider:mountain-pass', JSON.stringify({ schema: 'skyline-glider-checkpoint/v2', state: {} }));
    expect(readFlightCheckpoint('test-rider', course, identity)).toMatchObject({ status: 'incompatible', reason: 'legacy-schema' });
    writeFlightCheckpoint('test-rider', { ...course, version: 1 }, { identity, state: { courseTime: 1 } });
    expect(readFlightCheckpoint('test-rider', course, identity)).toMatchObject({ status: 'incompatible', reason: 'course-identity' });
  });
  it('preserves the exact terminal record for retry and never exposes it as resumable', () => {
    const record = { schema: 'skyline-glider-run/v1', run: { id: 'run-1', status: 'completed' } };
    writeFlightCheckpoint('test-rider', course, { identity, state: { courseTime: 300 }, lifecycle: 'pending_terminal', terminalRecord: record });
    const loaded = readFlightCheckpoint('test-rider', course, identity);
    expect(loaded).toMatchObject({ status: 'pending_terminal', terminalRecord: record });
    expect(loaded.terminalRecord).toEqual(record);
    expect(readFlightCheckpoint('test-rider', course, { ...identity, fitnessSessionId: 'fs-2', equipmentId: 'cycle_ace' })).toMatchObject({ status: 'pending_terminal', terminalRecord: record });
    clearFlightCheckpoint('test-rider', course);
    expect(readFlightCheckpoint('test-rider', course, identity).status).toBe('missing');
  });
});
