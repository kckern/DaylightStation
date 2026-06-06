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
    participants: [{ id: 'milo', displayName: 'Milo', avatarSrc: '/a' },
                   { id: 'felix', displayName: 'Felix', avatarSrc: '/b' }]
  };
  it('a distance race marks the distance cell as the goal', () => {
    const r = buildRecordRow({ ...base, winCondition: 'distance',
      goalLabel: '1.00 km', scoreLabel: '5:13' }, '2026-06-03');
    expect(r.distanceLabel).toBe('1.00 km');
    expect(r.timeLabel).toBe('5:13');
    expect(r.goalColumn).toBe('distance');
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
        { id: 'ghost:20260601:milo', displayName: 'Milo 👻', avatarSrc: '/a', isGhost: true },
        { id: 'felix', displayName: 'Felix', avatarSrc: '/b', isGhost: false }
      ],
      winCondition: 'distance', goalLabel: '1.00 km', scoreLabel: '5:13' }, '2026-06-03');
    expect(r.winnerIsGhost).toBe(true);
    expect(r.others).toEqual([{ id: 'felix', displayName: 'Felix', avatarSrc: '/b', isGhost: false }]);
  });
  it('a time race marks the time cell as the goal', () => {
    const r = buildRecordRow({ ...base, winCondition: 'time',
      goalLabel: '1:00', scoreLabel: '105 m' }, '2026-06-03');
    expect(r.distanceLabel).toBe('105 m');
    expect(r.timeLabel).toBe('1:00');
    expect(r.goalColumn).toBe('time');
  });
  it('handles a solo field (no others)', () => {
    const r = buildRecordRow({ ...base, participants: [base.participants[0]],
      winCondition: 'time', goalLabel: '1:00', scoreLabel: '105 m' }, '2026-06-03');
    expect(r.others).toEqual([]);
    expect(r.winnerId).toBe('milo');
  });
});
