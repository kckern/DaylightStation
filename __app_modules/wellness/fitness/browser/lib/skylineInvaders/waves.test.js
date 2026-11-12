import { describe, expect, it } from 'vitest';
import { waveRows } from './waves.js';

const level = (id, spawn, kills = 18, duration_s = 180) => ({ id, name: id, duration_s, pass: { kills }, waves: [{ at: 0, rate_s: 3, spawn }] });

describe('waveRows', () => {
  it('names what each wave brings in first, so waves are told apart', () => {
    const rows = waveRows([level('a', { meteor: 1 }), level('b', { meteor: 2, drone: 1 }, 20), level('c', { meteor: 1, drone: 1 })]);
    expect(rows.map((row) => row.detail)).toEqual(['New: Meteors · Shoot down 18 · 3:00', 'New: Drones · Shoot down 20 · 3:00', 'Shoot down 18 · 3:00']);
  });

  it('carries the world map status, a status word and the best stars', () => {
    const world = { levels: [{ id: 'a', status: 'completed', best: { stars: 2 } }, { id: 'b', status: 'locked' }] };
    const rows = waveRows([level('a', { meteor: 1 }), level('b', { drone: 1 }), level('c', { pod: 1 })], world);
    expect(rows.map(({ status, word, stars }) => [status, word, stars])).toEqual([['completed', 'Done', 2], ['locked', 'Locked', 0], ['open', 'New', 0]]);
  });
});
