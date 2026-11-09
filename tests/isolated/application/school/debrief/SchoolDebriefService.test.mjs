// tests/isolated/application/school/debrief/SchoolDebriefService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { SchoolDebriefService } from "../../../../../__app_modules/learning/school/server/application/debrief/SchoolDebriefService.mjs";
import { debriefConfigOf, PROMPTS } from "../../../../../__app_modules/learning/school/server/domain/schoolDebrief.mjs";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const QS = [
  { id: 'q1', kind: 'choice', prompt: 'P1', options: ['A', 'B', 'C'], answer: 'B' },
  { id: 'q2', kind: 'choice', prompt: 'P2', options: ['A', 'B', 'C'], answer: 'A' },
];
function memStore() {
  const days = {}; const statuses = {};
  return { days, statuses,
    read: async (l, d) => (statuses[`${l}/${d}`] ? { status: statuses[`${l}/${d}`], events: [] } : { status: days[`${l}/${d}`] ? 'ok' : 'missing', events: [...(days[`${l}/${d}`] ?? [])] }),
    append: async (l, d, e) => { (days[`${l}/${d}`] ??= []).push(e); return days[`${l}/${d}`]; },
    listDays: async () => Object.keys(days).map((k) => k.split('/')[1]).sort(),
  };
}
function make({ level = 4, probe = null, notify = null, today = '2026-10-21', transcribe = async () => 'hello', owed = [] } = {}) {
  const debriefs = memStore();
  const launcher = { today, studyDay() { return this.today; }, owedDays: vi.fn(async () => owed) };
  const logger = { info: vi.fn(), warn: vi.fn(), error() {}, debug() {} };
  const questioner = { ask: vi.fn(async () => ({ level, levelReason: 'r', probe, hook: 'a hook', questions: QS, questioner: 'model', questionSource: 'model', model: 'm', ms: 1 })) };
  const judge = { grade: vi.fn(async (q, r) => ({ correct: r === q.answer, grade: null, reason: null })) };
  const svc = new SchoolDebriefService({
    debriefs, launcher, questioner, judge,
    transcribe, notify, saveAudio: async () => 'media/x.webm',
    config: debriefConfigOf({}), clock: () => new Date('2026-10-21T22:00:00Z'), logger,
  });
  return { svc, debriefs, questioner, judge, launcher, logger };
}
async function fill(svc, day = '2026-10-21') {
  for (const p of PROMPTS) await svc.entry('test-learner', day, { promptId: p.id, text: `t-${p.id}`, via: 'typed' });
}

describe('SchoolDebriefService', () => {
  it('runs prompts → questions (keys stripped) → answers → complete', async () => {
    const { svc } = make();
    await svc.open('test-learner', '2026-10-21');
    await fill(svc);
    const v = await svc.submit('test-learner', '2026-10-21');
    expect(v.phase).toBe('questions');
    expect(v.questions[0]).not.toHaveProperty('answer');
    expect(await svc.answer('test-learner', '2026-10-21', { questionId: 'q1', response: 'B' })).toMatchObject({ correct: true, answer: 'B' });
    await svc.answer('test-learner', '2026-10-21', { questionId: 'q2', response: 'C' });
    const done = await svc.complete('test-learner', '2026-10-21');
    expect(done.phase).toBe('completed');
    expect(done.summary).toEqual({ quiz: { right: 1, graded: 2 }, level: 4, levelReason: 'r', rich: true, teachable: true, substantive: true });
  });
  it('submit is idempotent once questions exist (no second AI call)', async () => {
    const { svc, questioner } = make();
    await fill(svc);
    await svc.submit('test-learner', '2026-10-21');
    await svc.submit('test-learner', '2026-10-21');
    expect(questioner.ask).toHaveBeenCalledTimes(1);
  });
  it('a repeated answer returns the stored grade without re-grading', async () => {
    const { svc, judge } = make();
    await fill(svc); await svc.submit('test-learner', '2026-10-21');
    await svc.answer('test-learner', '2026-10-21', { questionId: 'q1', response: 'B' });
    const again = await svc.answer('test-learner', '2026-10-21', { questionId: 'q1', response: 'A' });
    expect(again.correct).toBe(true);
    expect(judge.grade).toHaveBeenCalledTimes(1);
  });
  it('level 2 probes until the budget is spent, then freezes whatever the level', async () => {
    const { svc, questioner } = make({ level: 2 });
    questioner.ask.mockResolvedValueOnce({ level: 2, levelReason: 'r', probe: 'Which pieces?', questions: QS, questioner: 'model', questionSource: 'model', ms: 1 })
      .mockResolvedValueOnce({ level: 2, levelReason: 'r', probe: 'Where do they end up?', questions: QS, questioner: 'model', questionSource: 'model', ms: 1 })
      .mockResolvedValueOnce({ level: 2, levelReason: 'r', probe: 'A third?', questions: QS, questioner: 'model', questionSource: 'model', ms: 1 });
    await fill(svc);
    const v = await svc.submit('test-learner', '2026-10-21');
    expect(v).toMatchObject({ phase: 'clarify', clarify: { prompt: 'Which pieces?' } });
    const v2 = await svc.clarify('test-learner', '2026-10-21', { text: '종이, 카드보드, 패인트', via: 'typed' });
    expect(v2).toMatchObject({ phase: 'clarify', clarify: { prompt: 'Where do they end up?' } });
    expect(questioner.ask.mock.calls[1][0].probes[0]).toMatchObject({ prompt: 'Which pieces?', text: '종이, 카드보드, 패인트' });
    const v3 = await svc.clarify('test-learner', '2026-10-21', { text: 'the bin', via: 'typed' });
    expect(v3.phase).toBe('questions');
    expect(v3.probes).toHaveLength(2);
    expect(questioner.ask).toHaveBeenCalledTimes(3);
  });
  it('a resent probe reply after the probe was answered returns the day and appends nothing; other text still 409s', async () => {
    const { svc, questioner, debriefs } = make({ level: 2 });
    questioner.ask.mockResolvedValueOnce({ level: 2, levelReason: 'r', probe: 'Which pieces?', questions: QS, questioner: 'model', questionSource: 'model', ms: 1 })
      .mockResolvedValueOnce({ level: 4, levelReason: 'r', probe: null, questions: QS, questioner: 'model', questionSource: 'model', ms: 1 });
    await fill(svc);
    await svc.submit('test-learner', '2026-10-21');
    const v = await svc.clarify('test-learner', '2026-10-21', { text: 'paper and card', via: 'typed' });
    expect(v.phase).toBe('questions');
    const count = debriefs.days['test-learner/2026-10-21'].length;
    const again = await svc.clarify('test-learner', '2026-10-21', { text: '  paper and card ', via: 'typed' });
    expect(again).toEqual(v);
    expect(debriefs.days['test-learner/2026-10-21']).toHaveLength(count);
    expect(questioner.ask).toHaveBeenCalledTimes(2);
    await expect(svc.clarify('test-learner', '2026-10-21', { text: 'something else', via: 'typed' })).rejects.toMatchObject({ status: 409 });
  });
  it('level 4 asks no probe and freezes the questions', async () => {
    const { svc } = make({ level: 4, probe: 'ignored?' });
    await fill(svc);
    const v = await svc.submit('test-learner', '2026-10-21');
    expect(v.phase).toBe('questions');
    expect(v.probes).toEqual([]);
    expect(v).toMatchObject({ level: 4, levelReason: 'r' });
    expect(v.prompts.map((p) => p.id)).toEqual(['classes', 'moment', 'teach', 'hard']);
    expect(v.classOptions).toContain('Math');
  });
  it('submit refuses when a required prompt is empty', async () => {
    const { svc } = make();
    await svc.entry('test-learner', '2026-10-21', { promptId: 'classes', text: 'math', via: 'typed' });
    await expect(svc.submit('test-learner', '2026-10-21')).rejects.toThrow(/moment, teach/);
  });
  it('entry rejects unknown prompt ids', async () => {
    const { svc } = make();
    await expect(svc.entry('test-learner', '2026-10-21', { promptId: 'nonsense', text: 'x' })).rejects.toMatchObject({ status: 400 });
  });
  it.each([['learned', 'teach'], ['notable', 'hard']])('an old-bundle %s entry is saved as %s', async (legacy, current) => {
    const { svc, debriefs, logger } = make();
    await svc.open('test-learner', '2026-10-21');
    const v = await svc.entry('test-learner', '2026-10-21', { promptId: legacy, text: 'from the old kiosk', via: 'typed' });
    expect(v.entries[current].text).toBe('from the old kiosk');
    expect(v.entries[legacy]).toBeUndefined();
    expect(debriefs.days['test-learner/2026-10-21'].at(-1)).toMatchObject({ type: 'entry', promptId: current });
    expect(logger.info).toHaveBeenCalledWith('school.debrief.legacy-prompt-id', { learnerId: 'test-learner', day: '2026-10-21', from: legacy, to: current });
  });
  it('a legacy learned entry satisfies teach and reaches the questioner', async () => {
    const { svc, debriefs, questioner } = make();
    debriefs.days['test-learner/2026-10-21'] = [{ type: 'opened' }, { type: 'entry', promptId: 'learned', text: 'fractions', via: 'typed' }];
    await svc.entry('test-learner', '2026-10-21', { promptId: 'moment', text: 'at the table', via: 'typed' });
    const v = await svc.submit('test-learner', '2026-10-21');
    expect(v.phase).toBe('questions');
    expect(questioner.ask.mock.calls[0][0].entries.learned.text).toBe('fractions');
    expect(questioner.ask.mock.calls[0][0].teachTo).toBe('a younger kid');
  });
  describe('summary reasons', () => {
    const done = async (svc, day) => {
      await fill(svc, day); await svc.submit('test-learner', day);
      for (const q of QS) await svc.answer('test-learner', day, { questionId: q.id, response: q.answer });
      return svc.complete('test-learner', day);
    };
    it('level 3 on time is rich but not teachable', async () => {
      const { svc } = make({ level: 3 });
      expect((await done(svc, '2026-10-21')).summary).toMatchObject({ rich: true, teachable: false, level: 3 });
    });
    it('level 4 late is teachable but not rich', async () => {
      const { svc } = make({ level: 4 });
      expect((await done(svc, '2026-10-20')).summary).toMatchObject({ rich: false, teachable: true });
    });
    it('a legacy day with substance and no level is rich by substance', async () => {
      const { svc, debriefs } = make();
      debriefs.days['test-learner/2026-10-21'] = [{ type: 'entry', promptId: 'learned', text: 'x' }, { type: 'questions', substance: 7, questions: QS, questioner: 'model' },
        { type: 'answer', questionId: 'q1', response: 'B', correct: true }, { type: 'answer', questionId: 'q2', response: 'A', correct: true }];
      expect((await svc.day('test-learner', '2026-10-21')).summary).toMatchObject({ rich: true, teachable: false, level: null });
    });
  });
  describe('completion hook and metrics', () => {
    const finish = async (svc) => {
      await fill(svc); await svc.submit('test-learner', '2026-10-21');
      for (const q of QS) await svc.answer('test-learner', '2026-10-21', { questionId: q.id, response: q.answer });
      return svc.complete('test-learner', '2026-10-21');
    };
    it('a rejecting notify still completes and logs hook-failed once', async () => {
      const notify = vi.fn(async () => { throw new Error('down'); });
      const { svc, logger } = make({ notify });
      const v = await finish(svc);
      expect(v.phase).toBe('completed');
      await new Promise((r) => setTimeout(r, 0));
      expect(logger.warn.mock.calls.filter((c) => c[0] === 'school.debrief.hook-failed')).toHaveLength(1);
    });
    it('a resolving notify is called once with learner, day and hook', async () => {
      const notify = vi.fn(async () => {});
      const { svc } = make({ notify });
      await finish(svc);
      await new Promise((r) => setTimeout(r, 0));
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith({ learnerId: 'test-learner', day: '2026-10-21', hook: 'a hook' });
    });
    it('completed log carries metrics', async () => {
      const { svc, logger } = make();
      await finish(svc);
      expect(logger.info).toHaveBeenCalledWith('school.debrief.completed', expect.objectContaining({ words: expect.any(Number), markers: expect.any(Number), probes: 0, voiceEntries: 0, level: 4 }));
    });
  });
  it('reads prior prompts from at most 20 prior days', async () => {
    const { svc, debriefs, questioner } = make();
    for (let i = 1; i <= 25; i++) debriefs.days[`test-learner/2026-09-${String(i).padStart(2, '0')}`] = [{ type: 'questions', questions: [{ id: 'q', kind: 'short', prompt: `Prior ${i}` }], questioner: 'model' }];
    await fill(svc); await svc.submit('test-learner', '2026-10-21');
    const prior = questioner.ask.mock.calls[0][0].priorPrompts;
    expect(prior).toHaveLength(20);
    expect(prior[0]).toBe('Prior 6');
  });
  it('discussed appends a teacher event and is never late', async () => {
    const { svc, debriefs, launcher } = make();
    await svc.open('test-learner', '2026-10-21');
    launcher.today = '2026-10-22';
    await svc.discussed('test-learner', '2026-10-21', { by: 'parent' });
    expect(debriefs.days['test-learner/2026-10-21'].find((e) => e.type === 'discussed')).toMatchObject({ by: 'parent' });
    expect((await svc.history('test-learner'))[0]).toMatchObject({ discussedAt: expect.any(String), late: false });
  });
  it('late day: no substantive bonus, events marked late', async () => {
    const { svc, debriefs } = make();
    await fill(svc, '2026-10-20'); await svc.submit('test-learner', '2026-10-20');
    for (const q of QS) await svc.answer('test-learner', '2026-10-20', { questionId: q.id, response: q.answer });
    const done = await svc.complete('test-learner', '2026-10-20');
    expect(done.late).toBe(true);
    expect(done.summary.substantive).toBe(false);
    expect(debriefs.days['test-learner/2026-10-20'].every((e) => e.late === true)).toBe(true);
  });
  it('complete refuses with unanswered questions', async () => {
    const { svc } = make();
    await fill(svc); await svc.submit('test-learner', '2026-10-21');
    await expect(svc.complete('test-learner', '2026-10-21')).rejects.toThrow(/unanswered/);
  });
  it('take: transcription failure keeps the audio and returns text null', async () => {
    const { svc } = make({ transcribe: async () => { throw new Error('down'); } });
    expect(await svc.take('test-learner', '2026-10-21', { buffer: Buffer.alloc(2000), mimeType: 'audio/webm' })).toEqual({ audioRef: 'media/x.webm', text: null });
  });
  it('rescore only for fallback days with no answers (or a teacher)', async () => {
    const { svc, questioner } = make();
    questioner.ask.mockResolvedValueOnce({ level: null, probe: null, questions: QS, questioner: 'fallback', model: null, ms: 1 });
    await fill(svc); await svc.submit('test-learner', '2026-10-21');
    const v = await svc.rescore('test-learner', '2026-10-21', { by: 'parent' });
    expect(v.level).toBe(4);
  });
  it('concurrent answers to one question grade and append once', async () => {
    const { svc, judge, debriefs } = make();
    await fill(svc); await svc.submit('test-learner', '2026-10-21');
    const [a, b] = await Promise.all([1, 2].map(() => svc.answer('test-learner', '2026-10-21', { questionId: 'q1', response: 'B' })));
    expect(judge.grade).toHaveBeenCalledTimes(1);
    expect(a.correct).toBe(b.correct);
    expect(debriefs.days['test-learner/2026-10-21'].filter((e) => e.type === 'answer')).toHaveLength(1);
  });
  it('concurrent submits ask and freeze questions once', async () => {
    const { svc, questioner, debriefs } = make();
    await fill(svc);
    await Promise.all([1, 2].map(() => svc.submit('test-learner', '2026-10-21')));
    expect(questioner.ask).toHaveBeenCalledTimes(1);
    expect(debriefs.days['test-learner/2026-10-21'].filter((e) => e.type === 'questions')).toHaveLength(1);
  });

  describe('grown-up actions never make a day late', () => {
    const FALLBACK = { level: null, levelReason: null, probe: null, hook: null, questions: QS, questioner: 'fallback', questionSource: 'fallback', model: null, ms: 1 };
    it('a fallback day finished on time and re-scored the next day stays on time and can be substantive', async () => {
      const { svc, questioner, launcher, debriefs } = make();
      questioner.ask.mockResolvedValueOnce(FALLBACK);
      await fill(svc); await svc.submit('test-learner', '2026-10-21');
      for (const q of QS) await svc.answer('test-learner', '2026-10-21', { questionId: q.id, response: q.answer });
      await svc.complete('test-learner', '2026-10-21');
      launcher.today = '2026-10-22';
      const v = await svc.rescore('test-learner', '2026-10-21', { by: 'parent' });
      expect(debriefs.days['test-learner/2026-10-21'].find((e) => e.type === 'rescored')).not.toHaveProperty('late');
      expect(v.phase).toBe('completed');
      expect((await svc.history('test-learner'))[0]).toMatchObject({ studyDay: '2026-10-21', late: false, summary: { rich: true } });
    });
    it('an on-time day excused the next day is not late', async () => {
      const { svc, launcher, debriefs } = make();
      await svc.open('test-learner', '2026-10-21');
      launcher.today = '2026-10-22';
      await svc.excuse('test-learner', '2026-10-21', { by: 'parent', reason: 'sick' });
      expect(debriefs.days['test-learner/2026-10-21'].find((e) => e.type === 'excused')).not.toHaveProperty('late');
      expect((await svc.history('test-learner'))[0]).toMatchObject({ phase: 'excused', late: false });
    });
  });
  it('history lists an owed day with no file as not-started, and it can be excused', async () => {
    const { svc, debriefs, launcher } = make({ owed: ['2026-10-19', '2026-10-20', '2026-10-21'] });
    await svc.open('test-learner', '2026-10-21');
    const rows = await svc.history('test-learner');
    expect(launcher.owedDays).toHaveBeenCalledWith('test-learner', { from: null, to: null });
    expect(rows.map((r) => [r.studyDay, r.phase])).toEqual([['2026-10-21', 'entry'], ['2026-10-20', 'not-started'], ['2026-10-19', 'not-started']]);
    await svc.excuse('test-learner', '2026-10-19', { by: 'parent', reason: 'school closed' });
    expect(debriefs.days['test-learner/2026-10-19'].map((e) => e.type)).toEqual(['excused']);
    expect((await svc.history('test-learner')).find((r) => r.studyDay === '2026-10-19').phase).toBe('excused');
  });
  it('history marks a corrupt or unreadable day "unreadable" (read() reports, it does not throw)', async () => {
    const { svc, debriefs } = make({ owed: ['2026-10-20', '2026-10-21'] });
    debriefs.statuses['test-learner/2026-10-20'] = 'corrupt';
    debriefs.statuses['test-learner/2026-10-21'] = 'unreadable';
    expect((await svc.history('test-learner')).map((r) => [r.studyDay, r.phase])).toEqual([['2026-10-21', 'unreadable'], ['2026-10-20', 'unreadable']]);
  });
  it('excuse, reject and re-score each log who did it', async () => {
    const { svc, questioner, logger } = make();
    questioner.ask.mockResolvedValueOnce({ level: null, probe: null, questions: QS, questioner: 'fallback', model: null, ms: 1 });
    await fill(svc); await svc.submit('test-learner', '2026-10-21');
    await svc.rescore('test-learner', '2026-10-21', { by: 'parent' });
    await svc.reject('test-learner', '2026-10-21', { by: 'parent', reason: 'junk' });
    await svc.excuse('test-learner', '2026-10-21', { by: 'parent', reason: 'sick' });
    for (const ev of ['school.debrief.rescored', 'school.debrief.rejected', 'school.debrief.excused']) {
      expect(logger.info).toHaveBeenCalledWith(ev, expect.objectContaining({ learnerId: 'test-learner', day: '2026-10-21', by: 'parent' }));
    }
  });
});
