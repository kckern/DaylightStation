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

  describe('mastery summary', () => {
    const silverTask = (f) => f.plan.tasks.find((task) => task.skill === 'silver');
    const withLog = (f) => { const info = []; return { info, service: new PianoLearnCoachService({ ...f, logger: { info: (name, data) => info.push([name, data]), warn() {} } }) }; };

    it('stores per-passage certification with each saved event', async () => {
      const f = pianoCoachFixture(); const { service } = withLog(f);
      await service.record('learner4', SCORE, f.outcome('silver-take', { task: silverTask(f) }));
      expect(f.records.get(`learner4/${SCORE}`).learnCoach.summary).toMatchObject({ total: 1, silver: 1, gold: 0, nextPassageId: null,
        passages: [{ id: 'opening', start: 0, end: 3, silver: '2026-10-26T18:00:00.000Z', gold: null }], updatedAt: '2026-10-26T18:00:00.000Z' });
    });

    it('keeps the summary through pending-write recovery', async () => {
      const f = pianoCoachFixture(); const { service } = withLog(f);
      f.failNextSave();
      await expect(service.record('learner4', SCORE, f.outcome('silver-take', { task: silverTask(f) }))).rejects.toThrow('disk full');
      await new PianoLearnCoachService(f).get('learner4', SCORE);
      expect(f.records.get(`learner4/${SCORE}`).learnCoach.summary.silver).toBe(1);
    });

    it('logs the check and a new certification once', async () => {
      const f = pianoCoachFixture(); const { service, info } = withLog(f);
      await service.record('learner4', SCORE, f.outcome('one', { task: silverTask(f) }));
      await service.record('learner4', SCORE, f.outcome('two', { task: silverTask(f) }));
      expect(info.filter(([name]) => name === 'piano.learn.silver-check')).toHaveLength(2);
      expect(info.find(([name]) => name === 'piano.learn.silver-check')[1]).toMatchObject({ passageId: 'opening', passed: true, cleanliness: 1 });
      expect(info.filter(([name]) => name === 'piano.learn.certified').map(([, data]) => data)).toEqual([expect.objectContaining({ userId: 'learner4', level: 'silver', passageId: 'opening', provenance: 'check' })]);
    });

    it('accepts and persists set-aside', async () => {
      const f = pianoCoachFixture(); const { service, info } = withLog(f);
      await service.record('learner4', SCORE, { plan: f.plan, event: { id: 'aside', type: 'set-aside', profileId: 'learner4', task: silverTask(f) } });
      const stored = f.records.get(`learner4/${SCORE}`).learnCoach;
      expect(stored.setAside).toEqual({ opening: '2026-10-26' });
      expect(stored.summary.setAside).toEqual({ opening: '2026-10-26' });
      expect(info.find(([name]) => name === 'piano.learn.set-aside')[1]).toMatchObject({ passageId: 'opening' });
    });

    it('rejects unknown event types and assist values', async () => {
      const f = pianoCoachFixture(); const { service } = withLog(f);
      await expect(service.record('learner4', SCORE, { plan: f.plan, event: { id: 'x', type: 'other', profileId: 'learner4', task: silverTask(f) } })).rejects.toMatchObject({ status: 400 });
      await expect(service.record('learner4', SCORE, { plan: f.plan, event: { id: 'y', type: 'selection', profileId: 'learner4', task: { ...silverTask(f), assist: 'some' } } })).rejects.toMatchObject({ status: 400 });
    });
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


  describe('whole-piece log', () => {
    const twoPassages = (f) => createCoachPlan({ scoreId: f.plan.scoreId, fingerprint: f.plan.fingerprint, tempoMap: f.plan.tempoMap,
      segments: [{ id: 'a', inMeasure: 0, outMeasure: 1, playableParts: ['rh', 'lh'] }, { id: 'b', inMeasure: 2, outMeasure: 3, playableParts: ['rh', 'lh'] }] });
    const setup = () => {
      const f = pianoCoachFixture(); const plan = twoPassages(f); const notes = []; const info = [];
      // `open`: these takes go straight to score tempo, which the default mode holds behind Silver.
      const service = new PianoLearnCoachService({ ...f, skipping: { default: 'open' }, pieceLog: { note: (entry) => { notes.push(entry); return entry; } },
        logger: { info: (name, data) => info.push([name, data]), warn() {} } });
      const take = (id, passage, skill) => { const body = f.outcome(id, { task: plan.tasks.find((task) => task.passageId === passage && task.skill === skill) }); return { ...body, plan }; };
      return { f, plan, notes, info, service, take };
    };

    it('notes Silver when one saved take finishes the last passage, and only once', async () => {
      const { notes, info, service, take } = setup();
      await service.record('learner4', SCORE, take('silver-a', 'a', 'silver'));
      expect(notes).toEqual([]);
      const last = take('silver-b', 'b', 'silver');
      await service.record('learner4', SCORE, last);
      expect(notes).toEqual([{ userId: 'learner4', scoreId: 'files:test.musicxml', level: 'silver', passages: 2, fingerprint: 'content-a', at: '2026-10-26T18:00:00.000Z' }]);
      expect(info).toContainEqual(['piano.learn.piece-certified', { userId: 'learner4', scoreId: 'files:test.musicxml', level: 'silver', passages: 2 }]);
      await service.record('learner4', SCORE, structuredClone(last)); // replayed receipt
      await service.record('learner4', SCORE, take('silver-b-again', 'b', 'silver')); // already all Silver
      expect(notes).toHaveLength(1);
    });

    it('notes Gold, and Silver with it, when a tempo take finishes both at once', async () => {
      const { notes, service, take } = setup();
      // Score tempo is earned on two passing takes out of three.
      for (const id of ['gold-a1', 'gold-a2']) await service.record('learner4', SCORE, take(id, 'a', 'mastery'));
      await service.record('learner4', SCORE, take('gold-b1', 'b', 'mastery'));
      expect(notes).toEqual([]);
      await service.record('learner4', SCORE, take('gold-b2', 'b', 'mastery'));
      expect(notes.map((note) => note.level)).toEqual(['silver', 'gold']);
    });

    it('never notes a piece that legacy credit already finished, a failed take, or a selection', async () => {
      const { f, plan, notes, service, take } = setup();
      f.records.set(`learner4/${SCORE}`, { learn: { passages: { a: { complete: true }, b: { complete: true } } } });
      await service.record('learner4', SCORE, take('silver-a', 'a', 'silver'));
      await service.record('learner4', SCORE, take('gold-a', 'a', 'mastery'));
      expect(notes).toEqual([]);
      const fresh = setup();
      await fresh.service.record('learner4', SCORE, fresh.take('silver-a', 'a', 'silver'));
      const missed = fresh.f.outcome('silver-b-miss', { task: fresh.plan.tasks.find((task) => task.passageId === 'b' && task.skill === 'silver'),
        result: { criteria: { completeness: 0.5, cleanliness: 1, placement: 1 } } });
      await fresh.service.record('learner4', SCORE, { ...missed, plan: fresh.plan });
      await fresh.service.record('learner4', SCORE, { plan: fresh.plan, event: { id: 'pick-b', type: 'selection', profileId: 'learner4', task: fresh.plan.tasks.find((task) => task.passageId === 'b' && task.skill === 'silver') } });
      expect(fresh.notes).toEqual([]);
      void plan;
    });

    it('still saves the take when there is no piece log', async () => {
      const f = pianoCoachFixture(); const service = new PianoLearnCoachService(f);
      const saved = await service.record('learner4', SCORE, f.outcome('silver-take', { task: f.plan.tasks.find((task) => task.skill === 'silver') }));
      expect(saved.state.summary.silver).toBe(1);
    });
  });

  describe('skipping steps', () => {
    const logged = (f, skipping) => { const warn = []; return { warn, service: new PianoLearnCoachService({ ...f, skipping: () => skipping, logger: { info() {}, warn: (name, data) => warn.push([name, data]) } }) }; };
    const of = (f, skill) => f.plan.tasks.find((task) => task.skill === skill);
    const select = (f, id, task) => ({ plan: f.plan, event: { id, type: 'selection', profileId: 'learner4', task } });

    it('rejects a Gold step before Silver by default, with a structured warning, and saves nothing', async () => {
      const f = pianoCoachFixture(); const { service, warn } = logged(f, undefined);
      await expect(service.record('learner4', SCORE, f.outcome('early-gold', { task: of(f, 'timed-75') }))).rejects.toMatchObject({ status: 403 });
      await expect(service.record('learner4', SCORE, select(f, 'pick-gold', of(f, 'mastery')))).rejects.toMatchObject({ status: 403 });
      expect(f.records.get(`learner4/${SCORE}`)?.learnCoach).toBeUndefined();
      expect(warn).toEqual([
        ['piano.learn.coach.locked', { userId: 'learner4', scoreId: 'files:test.musicxml', passageId: 'opening', skill: 'timed-75', type: 'outcome', mode: 'open-to-silver' }],
        ['piano.learn.coach.locked', expect.objectContaining({ skill: 'mastery', type: 'selection' })],
      ]);
    });

    it('accepts a skip to a later note step, and Gold once the passage has Silver', async () => {
      const f = pianoCoachFixture(); const { service, warn } = logged(f, { default: 'open-to-silver' });
      await service.record('learner4', SCORE, select(f, 'pick-together', of(f, 'together')));
      await service.record('learner4', SCORE, f.outcome('check', { task: of(f, 'silver') }));
      await service.record('learner4', SCORE, f.outcome('gold-75', { task: of(f, 'timed-75') }));
      expect(f.records.get(`learner4/${SCORE}`).learnCoach.evidence).toHaveLength(2);
      expect(warn).toEqual([]);
    });

    it('holds a strict learner to the current step, but lets a drill of it through', async () => {
      const f = pianoCoachFixture(); const { service } = logged(f, { learners: { learner4: 'strict' } });
      await expect(service.record('learner4', SCORE, select(f, 'pick-left', of(f, 'left')))).rejects.toMatchObject({ status: 403 });
      const right = of(f, 'right');
      await service.record('learner4', SCORE, select(f, 'pick-right', right));
      await service.record('learner4', SCORE, select(f, 'pick-drill', { ...right, key: 'drill', range: { start: 0, end: 1 }, depth: 1, parent: right }));
    });

    it('lets an open learner start score tempo from nothing', async () => {
      const f = pianoCoachFixture(); const { service } = logged(f, { default: 'strict', learners: { learner4: 'open' } });
      await service.record('learner4', SCORE, f.outcome('straight-to-gold', { task: of(f, 'mastery') }));
      expect(f.records.get(`learner4/${SCORE}`).learnCoach.evidence).toHaveLength(1);
    });
  });
});
