import { describe, expect, it } from 'vitest';
import {
  CHECK_GAPS, applyCheck, applyMark, applyReviewView, applyStudy, emptyStatus, emptyWord, isScheduledCheck, readWord,
} from './index.mjs';

const at = (day, time = '16:00:00') => `${day}T${time}-07:00`;
const claimedOn = (day) => applyMark(applyStudy(emptyWord(), { at: at(day), day, recording: 'taken' }), { at: at(day), day, mark: 'know' });

describe('word ladder transitions', () => {
  it('studying a NEW word makes it LEARNING and records the recording outcome', () => {
    const word = applyStudy(emptyWord(), { at: at('2026-09-22'), day: '2026-09-22', recording: 'unavailable', reason: 'no-device' });
    expect(word.state).toBe('learning');
    expect(word.history.at(-1)).toEqual({ at: at('2026-09-22'), day: '2026-09-22', event: 'study', recording: 'unavailable', reason: 'no-device' });
  });
  it('"I know it" claims the word for today; "Still learning" keeps it learning', () => {
    const claimed = claimedOn('2026-09-22');
    expect(claimed).toMatchObject({ state: 'claimed', claimedDay: '2026-09-22', step: 0, nextCheckDay: null });
    expect(claimed.history.at(-1).event).toBe('claim');
    const learning = applyMark(claimed, { at: at('2026-09-22'), day: '2026-09-22', mark: 'learning' });
    expect(learning).toMatchObject({ state: 'learning', claimedDay: null });
    expect(learning.history.at(-1).event).toBe('still-learning');
  });
  it('CLAIMED is checkable only on a LATER study day', () => {
    const claimed = claimedOn('2026-09-22');
    expect(isScheduledCheck(claimed, '2026-09-22')).toBe(false);
    expect(isScheduledCheck(claimed, '2026-09-23')).toBe(true);
  });
  it('a scheduled pass on CLAIMED becomes KNOWN at step 0, next check +3', () => {
    const known = applyCheck(claimedOn('2026-09-22'), { at: at('2026-09-23'), day: '2026-09-23', correct: true, phase: 'check', direction: 'term_to_gloss' });
    expect(known).toMatchObject({ state: 'known', step: 0, nextCheckDay: '2026-09-26', claimedDay: null });
    expect(known.history.at(-1)).toMatchObject({ event: 'check-pass', phase: 'check', direction: 'term_to_gloss' });
  });
  it('scheduled KNOWN passes widen through 3 / 7 / 14 / 30 and cap at step 3', () => {
    let word = applyCheck(claimedOn('2026-09-01'), { at: at('2026-09-02'), day: '2026-09-02', correct: true, phase: 'check' });
    const days = [];
    for (let i = 0; i < 4; i += 1) {
      const day = word.nextCheckDay;
      word = applyCheck(word, { at: at(day), day, correct: true, phase: 'check' });
      days.push([word.step, word.nextCheckDay]);
    }
    expect(CHECK_GAPS).toEqual([3, 7, 14, 30]);
    expect(days).toEqual([[1, '2026-09-12'], [2, '2026-09-26'], [3, '2026-10-26'], [3, '2026-11-25']]);
  });
  it('an early pass (review quiz or a not-yet-due check) changes nothing but the log', () => {
    const known = applyCheck(claimedOn('2026-09-22'), { at: at('2026-09-23'), day: '2026-09-23', correct: true, phase: 'check' });
    const early = applyCheck(known, { at: at('2026-09-24'), day: '2026-09-24', correct: true, phase: 'review' });
    expect({ ...early, history: undefined }).toEqual({ ...known, history: undefined });
    expect(early.history.at(-1).event).toBe('check-pass-early');
  });
  it('paper never promotes: a quiz pass is logged only', () => {
    const claimed = claimedOn('2026-09-22');
    const passed = applyCheck(claimed, { at: at('2026-09-26'), day: '2026-09-26', correct: true, phase: 'paper', attemptId: 'att_1' });
    expect(passed.state).toBe('claimed');
    expect(passed.history.at(-1)).toMatchObject({ event: 'quiz-pass', attemptId: 'att_1', phase: 'paper' });
  });
  it('any miss from any source resets to LEARNING step 0 with no next check', () => {
    const known = applyCheck(claimedOn('2026-09-01'), { at: at('2026-09-02'), day: '2026-09-02', correct: true, phase: 'check' });
    for (const [phase, event] of [['check', 'check-miss'], ['review', 'check-miss'], ['paper', 'quiz-miss']]) {
      const missed = applyCheck(known, { at: at('2026-09-05'), day: '2026-09-05', correct: false, phase });
      expect(missed).toMatchObject({ state: 'learning', step: 0, nextCheckDay: null, claimedDay: null });
      expect(missed.history.at(-1).event).toBe(event);
    }
  });
  it('a review-run view is logged and changes no state', () => {
    const known = applyCheck(claimedOn('2026-09-22'), { at: at('2026-09-23'), day: '2026-09-23', correct: true, phase: 'check' });
    const viewed = applyReviewView(known, { at: at('2026-09-23', '17:00:00'), day: '2026-09-23' });
    expect({ ...viewed, history: undefined }).toEqual({ ...known, history: undefined });
    expect(viewed.history.at(-1)).toEqual({ at: at('2026-09-23', '17:00:00'), day: '2026-09-23', event: 'review' });
  });
  it('rejects an unknown mark or phase', () => {
    expect(() => applyMark(emptyWord(), { at: at('2026-09-22'), day: '2026-09-22', mark: 'maybe' })).toThrow(/unknown mark/);
    expect(() => applyCheck(emptyWord(), { at: at('2026-09-22'), day: '2026-09-22', correct: true, phase: 'x' })).toThrow(/unknown check phase/);
  });
  it('reads a missing word as NEW without mutating the status', () => {
    const status = emptyStatus();
    expect(readWord(status, 'gawi')).toEqual(emptyWord());
    expect(status.words).toEqual({});
  });
});
