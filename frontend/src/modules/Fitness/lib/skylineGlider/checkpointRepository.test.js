import { beforeEach, describe, expect, it } from 'vitest';
import { clearFlightCheckpoint, readFlightCheckpoint, writeFlightCheckpoint } from './checkpointRepository.js';

describe('Skyline Glider checkpoint repository', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips a resumable checkpoint by rider and course', () => {
    writeFlightCheckpoint('dad', 'mountain-pass', { courseTime: 75, collectedIds: ['a'] });
    expect(readFlightCheckpoint('dad', 'mountain-pass')).toMatchObject({ courseTime: 75, collectedIds: ['a'] });
    clearFlightCheckpoint('dad', 'mountain-pass');
    expect(readFlightCheckpoint('dad', 'mountain-pass')).toBeNull();
  });
  it('drops corrupt checkpoints', () => {
    localStorage.setItem('fitness:skyline-glider:dad:mountain-pass', '{oops');
    expect(readFlightCheckpoint('dad', 'mountain-pass')).toBeNull();
  });
});
