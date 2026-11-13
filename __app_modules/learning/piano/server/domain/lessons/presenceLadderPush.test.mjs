import { describe, it, expect } from 'vitest';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';
import { composePresenceLadderPush } from './presenceLadderPush.mjs';

const base = { child: 'Kid One', lesson: 'Right Hand C Position', minimalCheckIns: 4, startedAt: '2026-11-13T23:05:00Z', timezone: 'America/Los_Angeles', userId: 'learner_1', day: '2026-11-13' };

describe('composePresenceLadderPush', () => {
  it('names the child and lesson, says what happened, in the household time', () => {
    const p = composePresenceLadderPush(base);
    expect(p.title).toBe('🎹 Kid One — Right Hand C Position');
    expect(p.message).toBe('Came back only to dismiss 4 check-ins this lesson — it now asks for two hands-together scales. The lesson started at 3:05 PM.');
    expect(p.data).toEqual({ tag: 'piano-presence-learner_1-2026-11-13', channel: 'School needs you', importance: 'high' });
    expect(findPushTextDefects(p.title)).toEqual([]);
    expect(findPushTextDefects(p.message)).toEqual([]);
  });
  it('with no child the title is the lesson alone; the tag has no spaces', () => {
    const p = composePresenceLadderPush({ ...base, child: null, userId: 'a b' });
    expect(p.title).toBe('🎹 Right Hand C Position');
    expect(p.data.tag).not.toMatch(/\s/);
  });
  it('no lesson title falls back to plain words; a bad zone drops the time, not the push', () => {
    const p = composePresenceLadderPush({ ...base, lesson: '', timezone: 'Not/AZone' });
    expect(p.title).toBe('🎹 Kid One — Piano lesson');
    expect(p.message).toBe('Came back only to dismiss 4 check-ins this lesson — it now asks for two hands-together scales.');
    expect(findPushTextDefects(p.message)).toEqual([]);
  });
  it('no known start time drops the clause, not the push', () => {
    const p = composePresenceLadderPush({ ...base, startedAt: null });
    expect(p.message).toBe('Came back only to dismiss 4 check-ins this lesson — it now asks for two hands-together scales.');
  });
  it('one check-in reads singular', () => {
    expect(composePresenceLadderPush({ ...base, minimalCheckIns: 1 }).message).toMatch(/dismiss 1 check-in this lesson/);
  });
});
