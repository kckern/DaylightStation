import { describe, expect, it } from 'vitest';
import {
  applyCheck, applyMark, applyStudy, checkDirection, dayProgress, emptyStatus, emptyWord, planDay, progressLabel,
} from './index.mjs';

const DECK = ['gawi', 'pul', 'chaek'];
const LEX = ['gawi', 'pul', 'chaek', 'ireum'];
const at = (day, time = '16:00:00') => `${day}T${time}-07:00`;
const claimed = (day) => applyMark(applyStudy(emptyWord(), { at: at(day), day, recording: 'taken' }), { at: at(day), day, mark: 'know' });
const plan = (status, today, media = {}) => planDay({ status, deckId: 'd', deckWordIds: DECK, lexiconIds: LEX, today, media });

describe('planDay', () => {
  it('a fresh deck is all study, no checks, no review quiz', () => {
    const p = plan(emptyStatus(), '2026-09-22');
    expect(p.checks).toEqual([]);
    expect([...p.study].sort()).toEqual([...DECK].sort());
    expect(p.reviewQuiz).toEqual([]);
    expect(p.deckId).toBe('d');
  });
  it('claim then rebuild the same day: not checked, not studied, and no review quiz while others remain', () => {
    const status = emptyStatus();
    status.words.gawi = claimed('2026-09-22');
    const p = plan(status, '2026-09-22');
    expect(p.checks).toEqual([]);
    expect(p.study).not.toContain('gawi');
    expect(p.reviewQuiz).toEqual([]);
  });
  it('checks CLAIMED-from-an-earlier-day and KNOWN-due words, across decks', () => {
    const status = emptyStatus();
    status.words.gawi = claimed('2026-09-22');
    status.words.ireum = applyCheck(claimed('2026-09-10'), { at: at('2026-09-11'), day: '2026-09-11', correct: true, phase: 'check' });
    const p = plan(status, '2026-09-23');
    expect(p.checks.map((c) => c.wordId).sort()).toEqual(['gawi', 'ireum']);
  });
  it('uses media to pick directions and falls back without it', () => {
    const status = emptyStatus();
    status.words.gawi = claimed('2026-09-22');
    const without = plan(status, '2026-09-23', {});
    expect(without.checks[0].direction).toBe('korean_to_english');
    const withMedia = plan(status, '2026-09-23', { gawi: { image: true, audio: true } });
    expect(withMedia.checks[0].direction).toBe(checkDirection('gawi', '2026-09-23'));
  });
  it('fires the review quiz when the current deck has nothing to check or study, despite a stuck carried word', () => {
    const status = emptyStatus();
    for (const id of DECK) status.words[id] = claimed('2026-09-22');
    status.words.ireum = applyStudy(emptyWord(), { at: at('2026-09-01'), day: '2026-09-01', recording: 'taken' });
    const p = plan(status, '2026-09-22');
    expect(p.study).toEqual(['ireum']);
    expect(p.checks).toEqual([]);
    expect(p.reviewQuiz.map((c) => c.wordId).sort()).toEqual([...DECK].sort());
  });
  it('is deterministic for one study day', () => {
    expect(plan(emptyStatus(), '2026-09-22')).toEqual(plan(emptyStatus(), '2026-09-22'));
  });
});

describe('dayProgress', () => {
  const day = '2026-09-23';
  const dayPlan = { deckId: 'd', checks: [{ wordId: 'gawi', direction: 'korean_to_english' }], study: ['pul'], reviewQuiz: [] };
  it('is incomplete until every check is answered and every study card studied and marked', () => {
    const words = { gawi: claimed('2026-09-22'), pul: emptyWord() };
    const before = dayProgress({ dayPlan, words, day });
    expect(before.remaining).toEqual({ checks: 1, study: 1, review: 0 });
    expect(before.complete).toBe(false);
    expect(progressLabel(before)).toBe('1 check · 1 to study');

    words.gawi = applyCheck(words.gawi, { at: at(day), day, correct: true, phase: 'check', direction: 'korean_to_english' });
    words.pul = applyStudy(words.pul, { at: at(day, '16:01:00'), day, recording: 'taken' });
    const studiedOnly = dayProgress({ dayPlan, words, day });
    expect(studiedOnly.study[0]).toMatchObject({ studied: true, recording: 'taken', marked: null, done: false });

    words.pul = applyMark(words.pul, { at: at(day, '16:02:00'), day, mark: 'learning' });
    const after = dayProgress({ dayPlan, words, day });
    expect(after.complete).toBe(true);
    expect(progressLabel(after)).toBe('Done for today');
  });
  it('credits a study card whose recording was unavailable', () => {
    const words = { pul: applyMark(applyStudy(emptyWord(), { at: at(day), day, recording: 'unavailable', reason: 'denied' }), { at: at(day, '16:01:00'), day, mark: 'know' }) };
    const progress = dayProgress({ dayPlan: { ...dayPlan, checks: [] }, words, day });
    expect(progress.study[0]).toMatchObject({ recording: 'unavailable', done: true });
    expect(progress.complete).toBe(true);
  });
  it('a check miss adds the word to today\'s study pass, needing work after the miss', () => {
    const words = { gawi: claimed('2026-09-22'), pul: emptyWord() };
    words.gawi = applyStudy(words.gawi, { at: at(day, '09:00:00'), day, recording: 'taken' });
    words.gawi = applyCheck(words.gawi, { at: at(day, '10:00:00'), day, correct: false, phase: 'check' });
    const progress = dayProgress({ dayPlan, words, day });
    expect(progress.study.map((s) => s.wordId)).toEqual(['pul', 'gawi']);
    expect(progress.study[1]).toMatchObject({ studied: false, done: false });
  });
  it('ignores review-run views and paper passes for credit', () => {
    const words = { pul: emptyWord() };
    words.pul = { ...words.pul, history: [{ at: at(day), day, event: 'review' }, { at: at(day), day, event: 'quiz-pass', phase: 'paper' }] };
    expect(dayProgress({ dayPlan: { ...dayPlan, checks: [] }, words, day }).complete).toBe(false);
  });
  it('no frozen plan is never complete', () => {
    expect(dayProgress({ dayPlan: null, words: {}, day }).complete).toBe(false);
  });
});
