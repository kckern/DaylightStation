import { describe, it, expect } from 'vitest';
import { ArcadeGameSession, ArcadeGameSessionStatus, ArcadeGameSessionEndReason } from './ArcadeGameSession.mjs';
import { ArcadeGameSessionState } from '../value-objects/ArcadeGameSessionState.mjs';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');
const at = (secs) => new Date(T0 + secs * 1000).toISOString();

const open = (trustedGapMs = 25_000) => ArcadeGameSession.open({
  id: 'ps_1', deviceId: 'livingroom-tv', surface: 'console-emulator',
  userId: 'test-learner', content: { contentId: 'game:1', title: 'Test Game' },
  loadId: 'retroarch__2026_09_11__20_00_00.log', loadedAt: at(0), trustedGapMs,
});

describe('ArcadeGameSession — starting', () => {
  it('opens pending with no played time', () => {
    const s = open();
    expect(s.status).toBe(ArcadeGameSessionStatus.PENDING);
    expect(s.playedMs).toBe(0);
    expect(s.startedAt).toBeNull();
  });

  it('does not start on paused or unknown observations', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PAUSED, observedAt: at(0) });
    s.observe({ state: ArcadeGameSessionState.UNKNOWN, observedAt: at(10) });
    expect(s.status).toBe(ArcadeGameSessionStatus.PENDING);
    expect(s.playedMs).toBe(0);
  });

  it('starts on the first playing observation, stamped at the OBSERVED time', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.UNKNOWN, observedAt: at(0) });
    const r = s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(30) });
    expect(r.started).toBe(true);
    expect(s.status).toBe(ArcadeGameSessionStatus.ACTIVE);
    expect(s.startedAt).toBe(at(30));
    // The start itself bills nothing; only spans between observations do.
    expect(s.playedMs).toBe(0);
  });

  it('a launch that never plays never bills', () => {
    const s = open();
    for (const sec of [0, 10, 20, 30]) s.observe({ state: ArcadeGameSessionState.UNKNOWN, observedAt: at(sec) });
    expect(s.status).toBe(ArcadeGameSessionStatus.PENDING);
    expect(s.playedMs).toBe(0);
  });
});

describe('ArcadeGameSession — played time is observed play, not wall clock', () => {
  it('accrues a playing→playing span', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(10) });
    expect(s.playedMs).toBe(10_000);
  });

  it('does not accrue across a pause', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(10) });  // +10s
    s.observe({ state: ArcadeGameSessionState.PAUSED,  observedAt: at(20) });  // paused span: nothing
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(30) });  // resume: nothing
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(40) });  // +10s
    expect(s.playedMs).toBe(20_000);
  });

  it('does not accrue across an unknown window', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.observe({ state: ArcadeGameSessionState.UNKNOWN, observedAt: at(10) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(20) });
    expect(s.playedMs).toBe(0);
  });

  it('playedMs is never endedAt - startedAt', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.observe({ state: ArcadeGameSessionState.PAUSED,  observedAt: at(10) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(600) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(610) });
    s.end({ endedAt: at(610), reason: ArcadeGameSessionEndReason.QUIT });
    const wallClock = 610_000;
    expect(s.playedMs).toBe(10_000);
    expect(s.playedMs).toBeLessThan(wallClock);
  });
});

describe('ArcadeGameSession — a silent observer cannot bill the silence', () => {
  it('credits only the trusted window across an oversized gap', () => {
    const s = open(25_000);
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    const r = s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(3600) }); // an hour of silence
    expect(r.accruedMs).toBe(25_000);
    expect(r.truncatedMs).toBe(3_600_000 - 25_000);
    expect(s.playedMs).toBe(25_000);
  });
});

describe('ArcadeGameSession — replay safety', () => {
  it('ignores duplicate observations without double counting', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(10) });
    const dup = s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(10) });
    expect(dup.stale).toBe(true);
    expect(dup.accruedMs).toBe(0);
    expect(s.playedMs).toBe(10_000);
  });

  it('ignores out-of-order observations', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(10) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(20) });
    const late = s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(5) });
    expect(late.stale).toBe(true);
    expect(s.playedMs).toBe(10_000);
  });
});

describe('ArcadeGameSession — reconciliation', () => {
  it('raises the high-water mark from after-the-fact evidence', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(10) });
    const r = s.reconcilePlayedMs(45_000, { confidenceMs: 30_000 });
    expect(r.raisedBy).toBe(35_000);
    expect(s.playedMs).toBe(45_000);
    expect(s.confidenceMs).toBe(30_000);
  });

  it('never lowers played time already witnessed', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(20) });
    const r = s.reconcilePlayedMs(5_000);
    expect(r.raisedBy).toBe(0);
    expect(s.playedMs).toBe(20_000);
  });
});

describe('ArcadeGameSession — ending', () => {
  it('records the end reason and refuses further observation', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.end({ endedAt: at(10), reason: ArcadeGameSessionEndReason.EXPIRED });
    expect(s.isEnded()).toBe(true);
    expect(s.endReason).toBe(ArcadeGameSessionEndReason.EXPIRED);
    expect(() => s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(20) })).toThrow(/ended/i);
  });

  it('rejects an unknown end reason and a second end', () => {
    const s = open();
    expect(() => s.end({ endedAt: at(1), reason: 'whatever' })).toThrow(/end reason/i);
    s.end({ endedAt: at(1), reason: ArcadeGameSessionEndReason.LOST });
    expect(() => s.end({ endedAt: at(2), reason: ArcadeGameSessionEndReason.QUIT })).toThrow(/already ended/i);
  });
});

describe('ArcadeGameSession — validation and persistence', () => {
  it('rejects an unknown play state', () => {
    const s = open();
    expect(() => s.observe({ state: 'sleeping', observedAt: at(0) })).toThrow(/play state/i);
  });

  it('requires a positive trusted gap', () => {
    expect(() => ArcadeGameSession.open({ id: 'x', deviceId: 'd', surface: 's', trustedGapMs: 0 }))
      .toThrow(/trustedGapMs/);
  });

  it('round-trips through a snapshot without losing played time', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(15) });
    const revived = ArcadeGameSession.fromSnapshot(s.toSnapshot());
    expect(revived.playedMs).toBe(15_000);
    expect(revived.status).toBe(ArcadeGameSessionStatus.ACTIVE);
    expect(revived.loadId).toBe('retroarch__2026_09_11__20_00_00.log');
    expect(revived.loadedAt).toBe(at(0));
    // and it keeps accruing correctly after a restart
    revived.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(25) });
    expect(revived.playedMs).toBe(25_000);
  });

  it('hydrates legacy snapshots with no load identity', () => {
    const snapshot = open().toSnapshot();
    delete snapshot.loadId;
    delete snapshot.loadedAt;
    const revived = ArcadeGameSession.fromSnapshot(snapshot);
    expect(revived.loadId).toBeNull();
    expect(revived.loadedAt).toBeNull();
  });
});

describe('ArcadeGameSession — late attribution', () => {
  it('fills an anonymous payer once without replacing an established payer', () => {
    const anonymous = ArcadeGameSession.open({
      id: 'ps_anon', deviceId: 'garage-tv', surface: 'browser-emulator', trustedGapMs: 25_000,
    });
    expect(anonymous.attributeUser('user_5')).toEqual({ attributed: true });
    expect(anonymous.userId).toBe('user_5');
    expect(anonymous.attributeUser('user_6')).toEqual({ attributed: false, reason: 'already attributed' });
    expect(anonymous.userId).toBe('user_5');
  });
});

describe('ArcadeGameSession — group play has a payer and a roster', () => {
  it('treats the attributed user as the payer', () => {
    const s = open();
    expect(s.payerId).toBe('test-learner');
  });

  it('records others as present without moving the bill', () => {
    const s = open();
    s.addParticipant('sibling-a');
    s.addParticipant('sibling-b');
    expect(s.participants).toEqual(['sibling-a', 'sibling-b']);
    expect(s.payerId).toBe('test-learner');   // unchanged
  });

  it('is idempotent — joining twice is joining once', () => {
    const s = open();
    s.addParticipant('sibling-a');
    s.addParticipant('sibling-a');
    expect(s.participants).toEqual(['sibling-a']);
  });

  it('ignores an empty participant', () => {
    const s = open();
    s.addParticipant(null);
    expect(s.participants).toEqual([]);
  });

  it('refuses to add someone to an ended session', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    s.end({ endedAt: at(10), reason: ArcadeGameSessionEndReason.QUIT });
    expect(() => s.addParticipant('sibling-a')).toThrow(/ended/i);
  });

  it('carries the roster through a snapshot, so history stays splittable later', () => {
    const s = open();
    s.addParticipant('sibling-a');
    const revived = ArcadeGameSession.fromSnapshot(s.toSnapshot());
    expect(revived.participants).toEqual(['sibling-a']);
    expect(revived.payerId).toBe('test-learner');
  });
});

describe('ArcadeGameSession — controllers seen', () => {
  it('records how many controllers were live', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0), controllers: 2 });
    expect(s.controllers).toBe(2);
  });

  it('keeps the HIGH-WATER mark, not the last reading', () => {
    // A four-player game stays a four-player game even if someone puts a pad
    // down before it ends.
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0), controllers: 4 });
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(10), controllers: 1 });
    expect(s.controllers).toBe(4);
  });

  it('stays null when controllers could not be counted', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
    expect(s.controllers).toBeNull();
  });

  it('survives a snapshot round trip', () => {
    const s = open();
    s.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0), controllers: 3 });
    expect(ArcadeGameSession.fromSnapshot(s.toSnapshot()).controllers).toBe(3);
  });
});

describe('ArcadeGameSession — naming a game it could not identify', () => {
  const named = { contentId: 'retroarch:gb/x', title: 'Recovered Title' };

  it('fills in a blank title', () => {
    const s = ArcadeGameSession.open({ id: 'p', deviceId: 'd', surface: 's', content: null, trustedGapMs: 25_000 });
    expect(s.attributeContent(named)).toEqual({ attributed: true });
    expect(s.content.title).toBe('Recovered Title');
  });

  it('never overwrites what was observed at the time', () => {
    // A later guess must not rewrite a title we actually knew.
    const s = open();
    const before = s.content.contentId;
    expect(s.attributeContent(named).attributed).toBe(false);
    expect(s.content.contentId).toBe(before);
  });

  it('ignores an empty attribution', () => {
    const s = ArcadeGameSession.open({ id: 'p', deviceId: 'd', surface: 's', content: null, trustedGapMs: 25_000 });
    expect(s.attributeContent(null).attributed).toBe(false);
  });
});
