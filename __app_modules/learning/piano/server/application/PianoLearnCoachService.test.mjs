// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PianoLearnCoachService } from './PianoLearnCoachService.mjs';
import { pianoCoachFixture } from '../../../../../tests/_lib/pianoCoachFixture.mjs';

import captured from '../../../../../shared/music/__fixtures__/learnCoachCapturedPractice.json';
import { createCoachPlan } from '../../../../../shared/music/learnCoach.mjs';

const SCORE = 'files-test-musicxml';
describe('acknowledged piano coaching', () => {
  it('keeps the application readable when timezone configuration is missing and refuses an ambiguous-day write', async () => {
    const f = pianoCoachFixture();const s = new PianoLearnCoachService({ ...f, timezone: null });
    expect((await s.get('learner4', SCORE)).state).toBeNull();
    await expect(s.record('learner4', SCORE, f.outcome('attempt-one'))).rejects.toMatchObject({ status: 503 });
    expect(f.records.size).toBe(0);
  });
  it('persists equivalent passes once while preserving unrelated legacy progress', async () => {
    const f = pianoCoachFixture();
    f.records.set(`learner4/${SCORE}`, { learn: { revision: 'old', passages: { opening: { complete: false } } }, measures: { 0: { rh: { passes: 3 } } }, polish: { both: { full: 62 } } });
    const service = new PianoLearnCoachService(f);const body = f.outcome('attempt-one');
    const first = await service.record('learner4', SCORE, body);
    const duplicate = await service.record('learner4', SCORE, structuredClone(body));
    expect(duplicate).toMatchObject({ revision: first.revision, duplicate: true });
    await service.record('learner4', SCORE, f.outcome('attempt-two'));
    const record = f.records.get(`learner4/${SCORE}`);
    expect(record.learnCoach.evidence).toHaveLength(2);
    expect(record.measures['0'].rh.passes).toBe(3);
    expect(record.polish.both.full).toBe(62);
    expect(record.learn.revision).toBe('old');
  });

  it('rejects reuse of an event ID with a different task payload', async () => {
    const f = pianoCoachFixture();const s = new PianoLearnCoachService(f);const body = f.outcome('attempt-one');
    await s.record('learner4', SCORE, body);
    await expect(s.record('learner4', SCORE, { ...body, event: { ...body.event, task: { ...body.event.task, tempoPercent: 20 } } })).rejects.toMatchObject({ status: 409 });
  });

  it('recovers a durable pending event after a summary write fails, including after restart', async () => {
    const f = pianoCoachFixture();const s = new PianoLearnCoachService(f);const body = f.outcome('attempt-one');
    f.failNextSave();
    await expect(s.record('learner4', SCORE, body)).rejects.toThrow('disk full');
    expect(f.pending.size).toBe(1);
    const restarted = new PianoLearnCoachService(f);
    const state = await restarted.get('learner4', SCORE);
    expect(state.state.evidence).toHaveLength(1);
    expect((await restarted.record('learner4', SCORE, body)).duplicate).toBe(true);
    expect(f.pending.size).toBe(0);
  });

  it('serializes simultaneous takes without dropping either achievement input', async () => {
    const f = pianoCoachFixture();const s = new PianoLearnCoachService(f);
    await Promise.all(['one', 'two', 'three'].map((id) => s.record('learner4', SCORE, f.outcome(`attempt-${id}`))));
    const result = await s.get('learner4', SCORE);
    expect(result.state.evidence).toHaveLength(3);
    expect(result.revision).toBe(3);
  });

  it('checks the saved attempt rather than accepting a forged passed verdict in the coaching request', async () => {
    const f = pianoCoachFixture();const s = new PianoLearnCoachService(f);
    const body = f.outcome('attempt-one', { result: { criteria: { completeness: 0, cleanliness: 0, placement: 0 }, verdict: { passed: false } } });
    body.event.result.criteria = { completeness: 1, cleanliness: 1, placement: 1 };
    await s.record('learner4', SCORE, body);
    const result = await s.get('learner4', SCORE);
    expect(Object.keys(result.state.achievements)).toHaveLength(0);
    expect(result.state.evidence[0].passedCredits).toHaveLength(0);
  });

  it('requires acknowledged attempt evidence before applying an outcome', async () => {
    const f = pianoCoachFixture();const s = new PianoLearnCoachService(f);const body = f.outcome('attempt-missing');f.attempts.clear();
    await expect(s.record('learner4', SCORE, body)).rejects.toMatchObject({ status: 409 });
    expect(f.records.size).toBe(0);
  });

  it('never uses a voided assessment to establish achievement', async () => {
    const f = pianoCoachFixture();const s = new PianoLearnCoachService(f);
    for (const id of ['void-one', 'void-two']) {
      const body = f.outcome(id);f.attempts.get(id).voided = { reason: 'grader fault' };
      await s.record('learner4', SCORE, body);
    }
    expect((await s.get('learner4', SCORE)).state.evidence).toHaveLength(0);
  });

  it('rejects cross-profile, invalid task, unsupported policy and mismatched score identities', async () => {
    const f = pianoCoachFixture();const s = new PianoLearnCoachService(f);const body = f.outcome('attempt-one');
    await expect(s.record('learner5', SCORE, body)).rejects.toMatchObject({ status: 400 });
    await expect(s.record('learner4', 'another-score', body)).rejects.toMatchObject({ status: 400 });
    await expect(s.record('learner4', SCORE, { ...body, plan: { ...body.plan, version: 999 } })).rejects.toMatchObject({ status: 400 });
    await expect(s.record('learner4', SCORE, { ...body, event: { ...body.event, task: { ...body.event.task, range: { start: -1, end: 999 } } } })).rejects.toMatchObject({ status: 400 });
  });

  it('preserves different score content states and deduplicates old IDs after evidence eviction', async () => {
    const f = pianoCoachFixture();const s = new PianoLearnCoachService(f);const first = f.outcome('attempt-first');
    await s.record('learner4', SCORE, first);
    for (let i = 0; i < 130; i++)await s.record('learner4', SCORE, f.outcome(`attempt-${i}`));
    expect((await s.record('learner4', SCORE, first)).duplicate).toBe(true);
    expect((await s.get('learner4', SCORE)).state.evidence).toHaveLength(128);
    const next = f.outcome('attempt-new');next.plan = { ...next.plan, fingerprint: 'content-b' };
    next.event.task = { ...next.event.task, fingerprint: 'content-b' };
    f.attempts.get('attempt-new').context.learnCoachTask = next.event.task;
    await s.record('learner4', SCORE, next);
    expect((await s.get('learner4', SCORE, { scoreId: f.plan.scoreId, fingerprint: 'content-a' })).state.evidence).toHaveLength(128);
    expect((await s.get('learner4', SCORE, { scoreId: f.plan.scoreId, fingerprint: 'content-b' })).state.evidence).toHaveLength(1);
  });
  it('preserves all thirteen captured legacy summaries through an idempotent coaching write', async () => {
    for (const [index, fixture] of captured.entries()) {
      const f = pianoCoachFixture(); const key = `files-captured-score-${index}-musicxml`;
      const scoreId = `files:captured-score-${index}.musicxml`;
      f.records.set(`learner4/${key}`, structuredClone(fixture.record));
      const plan = createCoachPlan({ scoreId, fingerprint: fixture.record.fingerprint.contentSha256,
        segments: [{ id: 'm0-3', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }] });
      const body = { plan, event: { id: `migration-${index}`, profileId: 'learner4', type: 'selection', task: plan.tasks[0] } };
      const service = new PianoLearnCoachService(f);
      await service.record('learner4', key, body); await service.record('learner4', key, body);
      const saved = f.records.get(`learner4/${key}`);
      for (const field of ['learn', 'measures', 'polish', 'fingerprint']) expect(saved[field]).toEqual(fixture.record[field]);
      expect(saved.learnCoach.revision).toBe(1);
    }
  });

});
