import { describe, expect, it } from 'vitest';
import { buildBeatsSeries } from './chartHelpers.js';

describe('buildBeatsSeries exempt participant score', () => {
  const series = {
    heart_rate: [100, 101, 102, 103],
    heart_beats: [8, 16, 24, 32],
    zone_id: ['cool', 'cool', 'cool', 'cool'],
  };
  const getSeries = (_id, metric) => series[metric] || [];

  it('does not relabel cumulative heartbeats as rings when rings are intentionally absent', () => {
    const result = buildBeatsSeries(
      { profileId: 'soren', name: 'Soren' },
      getSeries,
      { intervalMs: 5000 },
      { requireRingSeries: true },
    );

    expect(result.beats).toEqual([0, 0, 0, 0]);
    expect(result.active).toEqual([true, true, true, true]);
  });

  it('retains the legacy heartbeat fallback for old non-exempt sessions', () => {
    expect(buildBeatsSeries({ profileId: 'milo' }, getSeries).beats).toEqual([0, 16, 24, 32]);
  });
});
