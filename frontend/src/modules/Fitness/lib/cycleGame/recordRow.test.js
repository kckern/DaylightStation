import { describe, it, expect } from 'vitest';
import { relativeWhen, buildRecordRow } from './recordRow.js';

describe('relativeWhen', () => {
  // `todayYmd` is injected (pure — no Date.now()).
  it('labels today / yesterday / older', () => {
    expect(relativeWhen('2026-06-03', '6:12 pm', '2026-06-03')).toBe('Today 6:12p');
    expect(relativeWhen('2026-06-02', '7:22 pm', '2026-06-03')).toBe('Yest 7:22p');
    expect(relativeWhen('2026-05-28', '8:00 am', '2026-06-03')).toBe('May 28 8:00a');
  });
  it('tolerates missing/odd input', () => {
    expect(relativeWhen('unknown', '', '2026-06-03')).toBe('');
    expect(relativeWhen('2026-06-03', '', '2026-06-03')).toBe('Today');
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
    expect(r.when).toBe('Today 6:12p');
    expect(r.winnerId).toBe('milo');
    expect(r.winnerName).toBe('Milo');
    expect(r.others).toEqual([{ id: 'felix', displayName: 'Felix', avatarSrc: '/b' }]);
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
