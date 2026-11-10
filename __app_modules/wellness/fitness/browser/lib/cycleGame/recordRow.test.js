import { describe, it, expect } from 'vitest';
import { relativeDay, compactTime, buildRecordRow } from "./recordRow.js";

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
    winnerName: 'User_3',
    participants: [{ id: 'user_3', displayName: 'User_3', avatarSrc: '/a', finalDistanceM: 1000, finalTimeS: 120 },
                   { id: 'user_2', displayName: 'User_2', avatarSrc: '/b', finalDistanceM: 800, finalTimeS: 130 }]
  };
  it('a distance race shows winner km/h as SPEED and the goal distance as RACE', () => {
    const r = buildRecordRow({ ...base, winCondition: 'distance', goalLabel: '1.00 km' }, '2026-06-03');
    expect(r.speedLabel).toBe('30 km/h'); // winner 1000 m / 120 s = 30 km/h
    expect(r.raceLabel).toBe('1.00 km');
    expect(r.raceKind).toBe('distance');
    expect(r.whenDay).toBe('Today');
    expect(r.whenTime).toBe('6:12p');
    expect(r.winnerId).toBe('user_3');
    expect(r.winnerName).toBe('User_3');
    expect(r.winnerIsGhost).toBe(false);
    expect(r.others).toEqual([{ id: 'user_2', displayName: 'User_2', avatarSrc: '/b', isGhost: false }]);
  });

  const ghostFirst = { id: 'ghost:20260601:user_3', displayName: 'User_3 👻', avatarSrc: '/a', isGhost: true, finalDistanceM: 1000, finalTimeS: 120 };
  const liveSecond = { id: 'user_2', displayName: 'User_2', avatarSrc: '/b', isGhost: false, finalDistanceM: 800, finalTimeS: 130 };

  it('a ride lost to a ghost still leads with the live rider; the ghost goes in others', () => {
    // The candidate is winner-first and names the ghost as winner (the ghost
    // picker's headline). The history row is about who actually rode.
    const r = buildRecordRow({ ...base, winnerName: 'User_3 👻',
      participants: [ghostFirst, liveSecond],
      winCondition: 'distance', goalLabel: '1.00 km' }, '2026-06-03');
    expect(r.winnerId).toBe('user_2');
    expect(r.winnerName).toBe('User_2');
    expect(r.winnerAvatar).toBe('/b');
    expect(r.winnerIsGhost).toBe(false);
    expect(r.speedLabel).toBe('22 km/h'); // the live rider's 800 m / 130 s, not the ghost's pace
    expect(r.others).toEqual([{ id: 'ghost:20260601:user_3', displayName: 'User_3 👻', avatarSrc: '/a', isGhost: true }]);
  });

  it('leads with the top-placed live rider and keeps everyone else in placement order', () => {
    const liveThird = { id: 'user_4', displayName: 'User_4', avatarSrc: '/c', isGhost: false, finalDistanceM: 700, finalTimeS: 140 };
    const r = buildRecordRow({ ...base, winnerName: 'User_3 👻',
      participants: [ghostFirst, liveSecond, liveThird],
      winCondition: 'distance', goalLabel: '1.00 km' }, '2026-06-03');
    expect(r.winnerId).toBe('user_2');
    expect(r.others.map((o) => o.id)).toEqual(['ghost:20260601:user_3', 'user_4']);
  });

  it('a ghost-only race leads with the top ghost, flagged so callers can apply .cg-ghost', () => {
    const ghostSecond = { id: 'ghost:20260601:user_2', displayName: 'User_2 👻', avatarSrc: '/b', isGhost: true, finalDistanceM: 800, finalTimeS: 130 };
    const r = buildRecordRow({ ...base, winnerName: 'User_3 👻',
      participants: [ghostFirst, ghostSecond],
      winCondition: 'distance', goalLabel: '1.00 km' }, '2026-06-03');
    expect(r.winnerId).toBe('ghost:20260601:user_3');
    expect(r.winnerName).toBe('User_3 👻');
    expect(r.winnerIsGhost).toBe(true);
    expect(r.others).toEqual([{ id: 'ghost:20260601:user_2', displayName: 'User_2 👻', avatarSrc: '/b', isGhost: true }]);
  });
  it('a time race uses the time cap for winner pace and flags RACE as time', () => {
    // Time races have no finish time → use the cap (60 s). 300 m / 60 s = 18.0 km/h.
    const r = buildRecordRow({ ...base, winCondition: 'time', timeCapS: 60, goalLabel: '1:00',
      participants: [{ id: 'user_3', displayName: 'User_3', avatarSrc: '/a', finalDistanceM: 300, finalTimeS: null }] }, '2026-06-03');
    expect(r.speedLabel).toBe('18 km/h');
    expect(r.raceLabel).toBe('1:00');
    expect(r.raceKind).toBe('time');
  });
  it('handles a solo field (no others)', () => {
    const r = buildRecordRow({ ...base, participants: [base.participants[0]],
      winCondition: 'time', timeCapS: 60, goalLabel: '1:00' }, '2026-06-03');
    expect(r.others).toEqual([]);
    expect(r.winnerId).toBe('user_3');
  });
});
