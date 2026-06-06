import { describe, it, expect } from 'vitest';
import { groupSessions, GROUP_MAX_GAP_MS } from './groupSessions.mjs';

const H = (h, m) => Date.parse(`2026-06-05T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-07:00`);
const sess = (id, start, durMin, riders, media = null, coins = 0) => ({
  sessionId: id, date: '2026-06-05', startTime: start, durationMs: durMin * 60000,
  participants: Object.fromEntries(riders.map(r => [r, { displayName: r }])), media, totalCoins: coins,
});

const today = [
  sess('s1', H(14,54), 5.5, ['milo'], null, 60),
  sess('s2', H(16,12), 10,  ['milo','alan'], null, 8),
  sess('s3', H(16,22), 37.5,['alan','milo'], null, 1139),
  sess('s4', H(16,59), 12.4,['milo','alan'], null, 466),
  sess('s5', H(17,19), 9.9, ['felix'], null, 151),
  sess('s6', H(18,35), 8,   ['alan','milo'], null, 194),
  sess('s7', H(19,10), 46.4,['kckern','milo','alan','felix','soren'],
       { primary: { contentId: 'plex:674286', title: 'Looney Tunes Racing' } }, 2745),
];

describe('groupSessions', () => {
  it('merges ALL no-video sessions of the day into one (roster changes do not split) and leaves the video session standalone', () => {
    const groups = groupSessions(today);
    const ids = groups.map(g => g.segments.map(x => x.sessionId));
    // s5 is felix-only (disjoint roster) but still merges — only the video session (s7) splits
    expect(ids).toEqual([['s1','s2','s3','s4','s5','s6'], ['s7']]);
  });

  it('flags video groups and sums coins + unions rosters across rotating riders', () => {
    const [g1] = groupSessions(today);
    expect(g1.id).toBe('group:s1');
    expect(g1.isGroup).toBe(true);
    expect(g1.totalCoins).toBe(60 + 8 + 1139 + 466 + 151 + 194);
    expect(Object.keys(g1.participants).sort()).toEqual(['alan','felix','milo']);
    expect(g1.media).toBeNull();
    expect(g1.segments[0].gapBeforeMs).toBe(0);
    expect(g1.segments[1].gapBeforeMs).toBeGreaterThan(0);
    // merged groups must carry the group id as sessionId too, so the frontend list
    // (which keys clicks/selection on sessionId) can open the group's detail
    expect(g1.sessionId).toBe('group:s1');
    expect(g1.sessionId).toBe(g1.id);
  });

  it('breaks the chain when the gap exceeds the ceiling', () => {
    const far = [...today.slice(0,1),
      sess('late', today[0].startTime + today[0].durationMs + GROUP_MAX_GAP_MS + 60000, 5, ['milo'])];
    expect(groupSessions(far).length).toBe(2);
  });

  it('breaks across calendar days', () => {
    const nextDay = sess('d2', Date.parse('2026-06-06T08:00:00-07:00'), 5, ['milo']);
    expect(groupSessions([today[0], { ...nextDay, date: '2026-06-06' }]).length).toBe(2);
  });

  it('returns a singleton group with the real session id (not group:) when isGroup is false', () => {
    const one = groupSessions([today[6]]); // the video session, alone
    expect(one[0].isGroup).toBe(false);
    expect(one[0].id).toBe('s7');
  });
});
