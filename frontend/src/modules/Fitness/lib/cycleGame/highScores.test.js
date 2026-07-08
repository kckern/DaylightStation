import { describe, it, expect } from 'vitest';
import { buildHighScores } from './highScores.js';

describe('buildHighScores', () => {
  const races = [
    // short effort (<5 min): 120 s
    { raceId: 'A', day: '2026-06-04', timeOfDay: '8:30 am', participants: [
      { id: 'user_3', displayName: 'User_3', avatarSrc: '/m', finalDistanceM: 1200, finalTimeS: 120 }, // 36.0 km/h
      { id: 'user_2', displayName: 'User_2', avatarSrc: '/f', finalDistanceM: 600, finalTimeS: 120 }  // 18.0 km/h
    ] },
    // long effort (>=5 min): 360 s
    { raceId: 'B', day: '2026-06-05', timeOfDay: '9:06 pm', participants: [
      { id: 'user_3', displayName: 'User_3', avatarSrc: '/m', finalDistanceM: 4000, finalTimeS: 360 } // 40.0 km/h
    ] }
  ];

  it('splits into fastest under-5-min and 5-min+ km/h, each tied to its race + day', () => {
    const hs = buildHighScores(races, '2026-06-05');
    const sprint = hs.find((h) => h.key === 'sprint');
    const endurance = hs.find((h) => h.key === 'endurance');
    expect(sprint.valueLabel).toBe('36 km/h'); // user_3 1200 m / 120 s, race A
    expect(sprint.raceId).toBe('A');
    expect(sprint.holderName).toBe('User_3');
    expect(sprint.whenDay).toBe('Yest'); // race A is the day before todayYmd
    expect(sprint.whenTime).toBe('8:30a');
    expect(endurance.valueLabel).toBe('40 km/h'); // user_3 4000 m / 360 s, race B
    expect(endurance.raceId).toBe('B');
    expect(endurance.whenDay).toBe('Today');
  });

  it('falls back to the race time cap when a participant has no finish time', () => {
    const hs = buildHighScores([
      { raceId: 'C', timeCapS: 600, participants: [
        { id: 'user_3', displayName: 'User_3', avatarSrc: '/m', finalDistanceM: 5000, finalTimeS: null } // 5000 m / 600 s = 30.0 km/h
      ] }
    ]);
    expect(hs.find((h) => h.key === 'endurance').valueLabel).toBe('30 km/h');
    expect(hs.find((h) => h.key === 'sprint')).toBeUndefined();
  });

  it('ignores ghost participants (replays do not set records)', () => {
    const hs = buildHighScores([
      { raceId: 'A', participants: [{ id: 'user_3', displayName: 'User_3', avatarSrc: '/m', finalDistanceM: 1000, finalTimeS: 100 }] }, // 36.0 km/h
      { raceId: 'B', participants: [{ id: 'ghost:X:user_3', displayName: 'User_3 👻', avatarSrc: '/m', isGhost: true, finalDistanceM: 99999, finalTimeS: 100 }] }
    ]);
    const sprint = hs.find((h) => h.key === 'sprint');
    expect(sprint.valueLabel).toBe('36 km/h'); // ghost 99999 ignored
    expect(sprint.raceId).toBe('A');
  });

  it('returns an empty list when there is no live data', () => {
    expect(buildHighScores([])).toEqual([]);
    expect(buildHighScores([{ raceId: 'A', participants: [] }])).toEqual([]);
  });
});
