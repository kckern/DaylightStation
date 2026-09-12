import { describe, it, expect } from 'vitest';
import { PlaySession, PlaySessionStatus, PlaySessionEndReason } from './PlaySession.mjs';
import { PlayState } from '../value-objects/PlayState.mjs';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');
const at = (secs) => new Date(T0 + secs * 1000).toISOString();

const open = (trustedGapMs = 25_000) => PlaySession.open({
  id: 'ps_1', deviceId: 'livingroom-tv', surface: 'console-emulator',
  userId: 'test-learner', content: { contentId: 'game:1', title: 'Test Game' }, trustedGapMs,
});

describe('PlaySession — starting', () => {
  it('opens pending with no played time', () => {
    const s = open();
    expect(s.status).toBe(PlaySessionStatus.PENDING);
    expect(s.playedMs).toBe(0);
    expect(s.startedAt).toBeNull();
  });

  it('does not start on paused or unknown observations', () => {
    const s = open();
    s.observe({ state: PlayState.PAUSED, observedAt: at(0) });
    s.observe({ state: PlayState.UNKNOWN, observedAt: at(10) });
    expect(s.status).toBe(PlaySessionStatus.PENDING);
    expect(s.playedMs).toBe(0);
  });

  it('starts on the first playing observation, stamped at the OBSERVED time', () => {
    const s = open();
    s.observe({ state: PlayState.UNKNOWN, observedAt: at(0) });
    const r = s.observe({ state: PlayState.PLAYING, observedAt: at(30) });
    expect(r.started).toBe(true);
    expect(s.status).toBe(PlaySessionStatus.ACTIVE);
    expect(s.startedAt).toBe(at(30));
    // The start itself bills nothing; only spans between observations do.
    expect(s.playedMs).toBe(0);
  });

  it('a launch that never plays never bills', () => {
    const s = open();
    for (const sec of [0, 10, 20, 30]) s.observe({ state: PlayState.UNKNOWN, observedAt: at(sec) });
    expect(s.status).toBe(PlaySessionStatus.PENDING);
    expect(s.playedMs).toBe(0);
  });
});

describe('PlaySession — played time is observed play, not wall clock', () => {
  it('accrues a playing→playing span', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(10) });
    expect(s.playedMs).toBe(10_000);
  });

  it('does not accrue across a pause', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(10) });  // +10s
    s.observe({ state: PlayState.PAUSED,  observedAt: at(20) });  // paused span: nothing
    s.observe({ state: PlayState.PLAYING, observedAt: at(30) });  // resume: nothing
    s.observe({ state: PlayState.PLAYING, observedAt: at(40) });  // +10s
    expect(s.playedMs).toBe(20_000);
  });

  it('does not accrue across an unknown window', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.observe({ state: PlayState.UNKNOWN, observedAt: at(10) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(20) });
    expect(s.playedMs).toBe(0);
  });

  it('playedMs is never endedAt - startedAt', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.observe({ state: PlayState.PAUSED,  observedAt: at(10) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(600) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(610) });
    s.end({ endedAt: at(610), reason: PlaySessionEndReason.QUIT });
    const wallClock = 610_000;
    expect(s.playedMs).toBe(10_000);
    expect(s.playedMs).toBeLessThan(wallClock);
  });
});

describe('PlaySession — a silent observer cannot bill the silence', () => {
  it('credits only the trusted window across an oversized gap', () => {
    const s = open(25_000);
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    const r = s.observe({ state: PlayState.PLAYING, observedAt: at(3600) }); // an hour of silence
    expect(r.accruedMs).toBe(25_000);
    expect(r.truncatedMs).toBe(3_600_000 - 25_000);
    expect(s.playedMs).toBe(25_000);
  });
});

describe('PlaySession — replay safety', () => {
  it('ignores duplicate observations without double counting', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(10) });
    const dup = s.observe({ state: PlayState.PLAYING, observedAt: at(10) });
    expect(dup.stale).toBe(true);
    expect(dup.accruedMs).toBe(0);
    expect(s.playedMs).toBe(10_000);
  });

  it('ignores out-of-order observations', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(10) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(20) });
    const late = s.observe({ state: PlayState.PLAYING, observedAt: at(5) });
    expect(late.stale).toBe(true);
    expect(s.playedMs).toBe(10_000);
  });
});

describe('PlaySession — reconciliation', () => {
  it('raises the high-water mark from after-the-fact evidence', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(10) });
    const r = s.reconcilePlayedMs(45_000, { confidenceMs: 30_000 });
    expect(r.raisedBy).toBe(35_000);
    expect(s.playedMs).toBe(45_000);
    expect(s.confidenceMs).toBe(30_000);
  });

  it('never lowers played time already witnessed', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(20) });
    const r = s.reconcilePlayedMs(5_000);
    expect(r.raisedBy).toBe(0);
    expect(s.playedMs).toBe(20_000);
  });
});

describe('PlaySession — ending', () => {
  it('records the end reason and refuses further observation', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.end({ endedAt: at(10), reason: PlaySessionEndReason.EXPIRED });
    expect(s.isEnded()).toBe(true);
    expect(s.endReason).toBe(PlaySessionEndReason.EXPIRED);
    expect(() => s.observe({ state: PlayState.PLAYING, observedAt: at(20) })).toThrow(/ended/i);
  });

  it('rejects an unknown end reason and a second end', () => {
    const s = open();
    expect(() => s.end({ endedAt: at(1), reason: 'whatever' })).toThrow(/end reason/i);
    s.end({ endedAt: at(1), reason: PlaySessionEndReason.LOST });
    expect(() => s.end({ endedAt: at(2), reason: PlaySessionEndReason.QUIT })).toThrow(/already ended/i);
  });
});

describe('PlaySession — validation and persistence', () => {
  it('rejects an unknown play state', () => {
    const s = open();
    expect(() => s.observe({ state: 'sleeping', observedAt: at(0) })).toThrow(/play state/i);
  });

  it('requires a positive trusted gap', () => {
    expect(() => PlaySession.open({ id: 'x', deviceId: 'd', surface: 's', trustedGapMs: 0 }))
      .toThrow(/trustedGapMs/);
  });

  it('round-trips through a snapshot without losing played time', () => {
    const s = open();
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(15) });
    const revived = PlaySession.fromSnapshot(s.toSnapshot());
    expect(revived.playedMs).toBe(15_000);
    expect(revived.status).toBe(PlaySessionStatus.ACTIVE);
    // and it keeps accruing correctly after a restart
    revived.observe({ state: PlayState.PLAYING, observedAt: at(25) });
    expect(revived.playedMs).toBe(25_000);
  });
});
