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
function make({ substance = 7, clarify = null, today = '2026-10-21', transcribe = async () => 'hello', owed = [] } = {}) {
  const debriefs = memStore();
  const launcher = { today, studyDay() { return this.today; }, owedDays: vi.fn(async () => owed) };
  const logger = { info: vi.fn(), warn: vi.fn(), error() {}, debug() {} };
  const questioner = { ask: vi.fn(async ({ clarify: c }) => ({ substance: c ? 7 : substance, substanceReason: 'r', clarify: c ? null : clarify, questions: QS, questioner: 'model', model: 'm', ms: 1 })) };
  const judge = { grade: vi.fn(async (q, r) => ({ correct: r === q.answer, grade: null, reason: null })) };
  const svc = new SchoolDebriefService({
    debriefs, launcher, questioner, judge,
    transcribe, saveAudio: async () => 'media/x.webm',
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
    expect(done.summary).toEqual({ substance: 7, substantive: true, quiz: { right: 1, graded: 2 } });
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
  it('low substance asks to clarify exactly once', async () => {
    const { svc, questioner } = make({ substance: 2, clarify: 'What experiment?' });
    await fill(svc);
    const v = await svc.submit('test-learner', '2026-10-21');
    expect(v).toMatchObject({ phase: 'clarify', clarify: { prompt: 'What experiment?' } });
    const after = await svc.clarify('test-learner', '2026-10-21', { text: 'we grew beans', via: 'typed' });
    expect(after.phase).toBe('questions');
    expect(questioner.ask).toHaveBeenCalledTimes(2);
    expect(questioner.ask.mock.calls[1][0].clarify).toEqual({ prompt: 'What experiment?', text: 'we grew beans' });
  });
  it('submit refuses when the required prompt is empty', async () => {
    const { svc } = make();
    await svc.entry('test-learner', '2026-10-21', { promptId: 'classes', text: 'math', via: 'typed' });
    await expect(svc.submit('test-learner', '2026-10-21')).rejects.toThrow(/learned/);
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
    questioner.ask.mockResolvedValueOnce({ substance: null, substanceReason: null, clarify: null, questions: QS, questioner: 'fallback', model: null, ms: 1 });
    await fill(svc); await svc.submit('test-learner', '2026-10-21');
    const v = await svc.rescore('test-learner', '2026-10-21', { by: 'parent' });
    expect(v.substance ?? v.summary.substance).toBe(7);
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
    const FALLBACK = { substance: null, substanceReason: null, clarify: null, questions: QS, questioner: 'fallback', model: null, ms: 1 };
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
      expect((await svc.history('test-learner'))[0]).toMatchObject({ studyDay: '2026-10-21', late: false, summary: { substantive: true } });
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
    questioner.ask.mockResolvedValueOnce({ substance: null, substanceReason: null, clarify: null, questions: QS, questioner: 'fallback', model: null, ms: 1 });
    await fill(svc); await svc.submit('test-learner', '2026-10-21');
    await svc.rescore('test-learner', '2026-10-21', { by: 'parent' });
    await svc.reject('test-learner', '2026-10-21', { by: 'parent', reason: 'junk' });
    await svc.excuse('test-learner', '2026-10-21', { by: 'parent', reason: 'sick' });
    for (const ev of ['school.debrief.rescored', 'school.debrief.rejected', 'school.debrief.excused']) {
      expect(logger.info).toHaveBeenCalledWith(ev, expect.objectContaining({ learnerId: 'test-learner', day: '2026-10-21', by: 'parent' }));
    }
  });
});
