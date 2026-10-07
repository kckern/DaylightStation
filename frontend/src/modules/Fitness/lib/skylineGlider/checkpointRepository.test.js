import { beforeEach, describe, expect, it } from 'vitest';
import { clearFlightCheckpoint, readFlightCheckpoint, writeFlightCheckpoint } from './checkpointRepository.js';

describe('Skyline Glider checkpoint repository', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips a resumable checkpoint by rider and course', () => {
    const course = { id: 'mountain-pass', version: 2 };
    writeFlightCheckpoint('dad', course, { courseTime: 75, collectedIds: ['a'] });
    expect(readFlightCheckpoint('dad', course)).toMatchObject({ courseTime: 75, collectedIds: ['a'] });
    clearFlightCheckpoint('dad', 'mountain-pass');
    expect(readFlightCheckpoint('dad', course)).toBeNull();
  });
  it('rejects legacy and differently-versioned checkpoints', () => {
    const key = 'fitness:skyline-glider:dad:mountain-pass';
    localStorage.setItem(key, JSON.stringify({ courseTime: 75, collectedIds: ['old'] }));
    expect(readFlightCheckpoint('dad', { id: 'mountain-pass', version: 2 })).toBeNull();

    writeFlightCheckpoint('dad', { id: 'mountain-pass', version: 1 }, { courseTime: 75 });
    expect(readFlightCheckpoint('dad', { id: 'mountain-pass', version: 2 })).toBeNull();
  });
  it('drops corrupt checkpoints', () => {
    localStorage.setItem('fitness:skyline-glider:dad:mountain-pass', '{oops');
    expect(readFlightCheckpoint('dad', { id: 'mountain-pass', version: 2 })).toBeNull();
  });
});
