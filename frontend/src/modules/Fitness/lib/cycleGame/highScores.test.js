import { describe, it, expect } from 'vitest';
import { buildHighScores } from './highScores.js';

describe('buildHighScores', () => {
  const races = [
    { raceId: 'A', day: '2026-06-04', timeOfDay: '8:30 am', participants: [
      { id: 'milo', displayName: 'Milo', avatarSrc: '/m', finalDistanceM: 770, finalTimeS: 60 },
      { id: 'felix', displayName: 'Felix', avatarSrc: '/f', finalDistanceM: 600, finalTimeS: 60 }
    ] },
    { raceId: 'B', day: '2026-06-05', timeOfDay: '9:06 pm', participants: [
      { id: 'milo', displayName: 'Milo', avatarSrc: '/m', finalDistanceM: 2470, finalTimeS: 180 }
    ] }
  ];

  it('returns the furthest distance and longest time, each tied to its race + day', () => {
    const hs = buildHighScores(races, '2026-06-05');
    const dist = hs.find((h) => h.key === 'distance');
    const time = hs.find((h) => h.key === 'time');
    expect(dist.valueLabel).toBe('2.47 km'); // 2470 m furthest, from race B
    expect(dist.raceId).toBe('B');
    expect(dist.holderName).toBe('Milo');
    expect(dist.whenDay).toBe('Today'); // race B is on todayYmd
    expect(dist.whenTime).toBe('9:06p');
    expect(time.valueLabel).toBe('3:00'); // 180 s longest, from race B
    expect(time.raceId).toBe('B');
  });

  it('ignores ghost participants (replays do not set records)', () => {
    const hs = buildHighScores([
      { raceId: 'A', participants: [{ id: 'milo', displayName: 'Milo', avatarSrc: '/m', finalDistanceM: 500, finalTimeS: 60 }] },
      { raceId: 'B', participants: [{ id: 'ghost:X:milo', displayName: 'Milo 👻', avatarSrc: '/m', isGhost: true, finalDistanceM: 9999, finalTimeS: 9999 }] }
    ]);
    expect(hs.find((h) => h.key === 'distance').valueLabel).toBe('500 m'); // ghost 9999 ignored
    expect(hs.find((h) => h.key === 'distance').raceId).toBe('A');
  });

  it('returns an empty list when there is no live data', () => {
    expect(buildHighScores([])).toEqual([]);
    expect(buildHighScores([{ raceId: 'A', participants: [] }])).toEqual([]);
  });
});
