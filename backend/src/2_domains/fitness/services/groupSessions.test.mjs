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

  it('reports active time (sum of segment durations) as durationMs, not the wall-clock span', () => {
    const [g1] = groupSessions(today);
    const activeMs = today.slice(0, 6).reduce((a, s) => a + s.durationMs, 0); // s1..s6 ride time
    expect(g1.durationMs).toBe(activeMs);
    // sanity: the wall-clock span (first start → last finish) is far larger — it counts
    // the idle gaps between blocks, which is exactly what the card must NOT show.
    expect(g1.endTime - g1.startTime).toBeGreaterThan(g1.durationMs);
  });

  it('keeps a non-cycling Strava workout (a run) standalone, never merged into a cycle block', () => {
    const run = { ...sess('run', H(15, 30), 41, ['kckern']), strava: { name: 'Afternoon Run', sportType: 'Run' } };
    // The run sits mid-block between s1 and s2; without the guard it would absorb in.
    const groups = groupSessions([today[0], run, today[1]]);
    expect(groups.map(g => g.segments.map(x => x.sessionId))).toEqual([['s1'], ['run'], ['s2']]);
    const runGroup = groups.find(g => g.segments[0].sessionId === 'run');
    expect(runGroup.isGroup).toBe(false);
    expect(runGroup.strava.sportType).toBe('Run'); // strava preserved → it titles as the run
  });

  it('still merges a cycling Strava session (VirtualRide) into the block', () => {
    const ride = { ...sess('ride', H(15, 5), 10, ['milo']), strava: { name: 'Zwift', sportType: 'VirtualRide' } };
    expect(groupSessions([today[0], ride]).length).toBe(1); // cycling sport → not foreign
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

  it('preserves voice memos / suffer / strava passthrough fields (singleton spreads, group concatenates)', () => {
    const vid = { ...sess('v', H(19,10), 46, ['kckern'], { primary: { contentId: 'plex:1', title: 'V' } }, 2745),
      voiceMemos: [{ transcript: 'we finished the course' }], maxSufferScore: 8, totalSufferScore: 8,
      stravaActivityId: 123, timezone: 'America/Los_Angeles' };
    const [g] = groupSessions([vid]);
    expect(g.isGroup).toBe(false);
    expect(g.voiceMemos).toEqual([{ transcript: 'we finished the course' }]); // not dropped
    expect(g.maxSufferScore).toBe(8);
    expect(g.stravaActivityId).toBe(123);
    expect(g.timezone).toBe('America/Los_Angeles');

    // merged group concatenates memos across segments and clears single-source strava
    const a = { ...sess('a', H(16,22), 10, ['milo']), voiceMemos: [{ transcript: 'memo a' }], stravaActivityId: 9 };
    const b = { ...sess('b', H(16,40), 10, ['milo']), voiceMemos: [{ transcript: 'memo b' }] };
    const [grp] = groupSessions([a, b]);
    expect(grp.isGroup).toBe(true);
    expect(grp.voiceMemos.map(m => m.transcript)).toEqual(['memo a', 'memo b']);
    expect(grp.stravaActivityId).toBeNull();
  });

  it('returns a singleton group with the real session id (not group:) when isGroup is false', () => {
    const one = groupSessions([today[6]]); // the video session, alone
    expect(one[0].isGroup).toBe(false);
    expect(one[0].id).toBe('s7');
  });
});
