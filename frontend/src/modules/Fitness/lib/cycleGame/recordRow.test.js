import { describe, it, expect } from 'vitest';
import { relativeDay, compactTime, buildRecordRow } from './recordRow.js';

describe('compactTime', () => {
  it('compacts a time-of-day, tolerating junk', () => {
    expect(compactTime('6:12 pm')).toBe('6:12p');
    expect(compactTime('8:00 am')).toBe('8:00a');
    expect(compactTime('')).toBe('');
  });
});

describe('relativeDay', () => {
  // `todayYmd` is injected (pure — no Date.now()).
  it('labels today / yesterday / older', () => {
    expect(relativeDay('2026-06-03', '2026-06-03')).toBe('Today');
    expect(relativeDay('2026-06-02', '2026-06-03')).toBe('Yest');
    expect(relativeDay('2026-05-28', '2026-06-03')).toBe('May 28');
    expect(relativeDay('unknown', '2026-06-03')).toBe('');
  });
});

describe('buildRecordRow', () => {
  const base = {
    raceId: '20260603181200', day: '2026-06-03', timeOfDay: '6:12 pm',
    winnerName: 'Milo',
    participants: [{ id: 'milo', displayName: 'Milo', avatarSrc: '/a', finalDistanceM: 1000, finalTimeS: 120 },
                   { id: 'felix', displayName: 'Felix', avatarSrc: '/b', finalDistanceM: 800, finalTimeS: 130 }]
  };
  it('a distance race shows winner km/h as SPEED and the goal distance as RACE', () => {
    const r = buildRecordRow({ ...base, winCondition: 'distance', goalLabel: '1.00 km' }, '2026-06-03');
    expect(r.speedLabel).toBe('30 km/h'); // winner 1000 m / 120 s = 30 km/h
    expect(r.raceLabel).toBe('1.00 km');
    expect(r.raceKind).toBe('distance');
    expect(r.whenDay).toBe('Today');
    expect(r.whenTime).toBe('6:12p');
    expect(r.winnerId).toBe('milo');
    expect(r.winnerName).toBe('Milo');
    expect(r.winnerIsGhost).toBe(false);
    expect(r.others).toEqual([{ id: 'felix', displayName: 'Felix', avatarSrc: '/b', isGhost: false }]);
  });

  it('flags ghost participants (winner + others) so callers can apply .cg-ghost', () => {
    const r = buildRecordRow({ ...base,
      participants: [
        { id: 'ghost:20260601:milo', displayName: 'Milo 👻', avatarSrc: '/a', isGhost: true, finalDistanceM: 1000, finalTimeS: 120 },
        { id: 'felix', displayName: 'Felix', avatarSrc: '/b', isGhost: false, finalDistanceM: 800, finalTimeS: 130 }
      ],
      winCondition: 'distance', goalLabel: '1.00 km' }, '2026-06-03');
    expect(r.winnerIsGhost).toBe(true);
    expect(r.others).toEqual([{ id: 'felix', displayName: 'Felix', avatarSrc: '/b', isGhost: false }]);
  });
  it('a time race uses the time cap for winner pace and flags RACE as time', () => {
    // Time races have no finish time → use the cap (60 s). 300 m / 60 s = 18.0 km/h.
    const r = buildRecordRow({ ...base, winCondition: 'time', timeCapS: 60, goalLabel: '1:00',
      participants: [{ id: 'milo', displayName: 'Milo', avatarSrc: '/a', finalDistanceM: 300, finalTimeS: null }] }, '2026-06-03');
    expect(r.speedLabel).toBe('18 km/h');
    expect(r.raceLabel).toBe('1:00');
    expect(r.raceKind).toBe('time');
  });
  it('handles a solo field (no others)', () => {
    const r = buildRecordRow({ ...base, participants: [base.participants[0]],
      winCondition: 'time', timeCapS: 60, goalLabel: '1:00' }, '2026-06-03');
    expect(r.others).toEqual([]);
    expect(r.winnerId).toBe('milo');
  });
});
