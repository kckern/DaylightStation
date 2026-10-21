// S/application/debrief/SchoolDebriefService.mjs
/**
 * The debrief use cases (spec §2, §4, §7). Every write is one appended event;
 * state is always re-derived. Answer keys never leave here before the matching
 * answer is recorded.
 */
import { PROMPTS, TEACHER_EVENTS, deriveDebriefState } from "../../domain/schoolDebrief.mjs";

const MIN_TAKE_BYTES = 1000;
class DebriefError extends Error { constructor(message, status = 400) { super(message); this.name = 'DebriefError'; this.status = status; } }

export class SchoolDebriefService {
  #debriefs; #launcher; #questioner; #judge; #transcribe; #saveAudio; #config; #clock; #logger;
  constructor({ debriefs, launcher, questioner, judge, transcribe = null, saveAudio = null, config, clock = () => new Date(), logger = console }) {
    this.#debriefs = debriefs; this.#launcher = launcher; this.#questioner = questioner; this.#judge = judge;
    this.#transcribe = transcribe; this.#saveAudio = saveAudio; this.#config = config; this.#clock = clock; this.#logger = logger;
  }
  #inflight = new Map();
  // Collapse concurrent identical calls (double Enter) into one: later callers await the first.
  #once(key, fn) {
    const running = this.#inflight.get(key);
    if (running) return running;
    const p = (async () => { try { return await fn(); } finally { this.#inflight.delete(key); } })();
    this.#inflight.set(key, p);
    return p;
  }
  #now() { return this.#clock().toISOString(); }
  #late(day) { return day !== this.#launcher.studyDay(); }
  async #events(learnerId, day) {
    const { status, events } = await this.#debriefs.read(learnerId, day);
    if (status === 'unreadable' || status === 'corrupt') throw new DebriefError('The debrief record could not be read.', 503);
    return events;
  }
  // Only the child's own events carry `late`; a grown-up acting the next day must not make a day late.
  async #append(learnerId, day, event) {
    const late = !TEACHER_EVENTS.has(event.type) && this.#late(day);
    return this.#debriefs.append(learnerId, day, { ...event, at: this.#now(), ...(late ? { late: true } : {}) });
  }
  #view(day, events) {
    const s = deriveDebriefState(events);
    // A finished day's timeliness is what its own events say; only a day still being written
    // takes "is it today?" into account (its next child event will be stamped late).
    const finished = ['completed', 'excused', 'rejected'].includes(s.phase);
    const late = s.late || (!finished && this.#late(day));
    const strip = (q) => {
      const answered = s.answers[q.id];
      if (q.kind === 'choice') return answered ? q : { id: q.id, kind: q.kind, prompt: q.prompt, options: q.options };
      return answered ? q : { id: q.id, kind: q.kind, prompt: q.prompt };
    };
    const summary = s.summary ? { ...s.summary, substantive: !late && s.questioner === 'model' && Number.isInteger(s.substance) && s.substance >= this.#config.substantiveScore } : null;
    return {
      studyDay: day, late, phase: s.phase, entries: s.entries,
      clarify: s.clarify ? { prompt: s.clarify.prompt } : null,
      questions: s.questions ? s.questions.map(strip) : null,
      answers: s.answers, next: s.next, summary, questioner: s.questioner, substance: s.substance,
    };
  }
  async day(learnerId, day) { return this.#view(day, await this.#events(learnerId, day)); }
  async open(learnerId, day) {
    const events = await this.#events(learnerId, day);
    if (!events.some((e) => e.type === 'opened')) await this.#append(learnerId, day, { type: 'opened' });
    this.#logger.info?.('school.debrief.opened', { learnerId, day, late: this.#late(day) });
    return this.day(learnerId, day);
  }
  async take(learnerId, day, { buffer, mimeType = 'audio/webm' }) {
    if (!Buffer.isBuffer(buffer) || buffer.length < MIN_TAKE_BYTES) throw new DebriefError('Recording too short');
    const audioRef = this.#saveAudio ? await this.#saveAudio({ learnerId, studyDay: day, buffer, mimeType }) : null;
    let text = null;
    try { text = this.#transcribe ? (await this.#transcribe(buffer, { prompt: 'A child describing their school day.' }))?.trim() || null : null; }
    catch (err) { this.#logger.warn?.('school.debrief.transcribe-failed', { learnerId, day, error: err?.message }); }
    return { audioRef, text };
  }
  async #assertOpen(learnerId, day) {
    const s = deriveDebriefState(await this.#events(learnerId, day));
    if (['completed', 'excused', 'rejected'].includes(s.phase)) throw new DebriefError('This debrief is already finished.', 409);
    return s;
  }
  async entry(learnerId, day, { promptId, text, via = 'typed', audioRef = null }) {
    if (!PROMPTS.some((p) => p.id === promptId)) throw new DebriefError(`unknown prompt: ${promptId}`);
    const s = await this.#assertOpen(learnerId, day);
    if (s.questions) throw new DebriefError('Questions have started; the entry is closed.', 409);
    await this.#append(learnerId, day, { type: 'entry', promptId, text: String(text ?? '').slice(0, 4000), via, audioRef });
    this.#logger.info?.('school.debrief.entry', { learnerId, day, promptId, via, chars: String(text ?? '').length });
    return this.day(learnerId, day);
  }
  async #runQuestioner(learnerId, day, s) {
    const priorDays = (await this.#debriefs.listDays(learnerId, {})).filter((d) => d < day).slice(-5);
    const priorPrompts = [];
    for (const d of priorDays) {
      try { priorPrompts.push(...(deriveDebriefState((await this.#debriefs.read(learnerId, d)).events).questions ?? []).map((q) => q.prompt)); } catch { /* history is best-effort */ }
    }
    return this.#questioner.ask({ entries: s.entries, clarify: s.clarify, priorPrompts: priorPrompts.slice(-20) });
  }
  async submit(learnerId, day) {
    return this.#once(`${learnerId}/${day}/questions`, async () => {
    const s = await this.#assertOpen(learnerId, day);
    if (s.questions) return this.day(learnerId, day);
    if (s.clarify && s.clarify.text === null) return this.day(learnerId, day);
    const required = PROMPTS.filter((p) => p.required && !String(s.entries[p.id]?.text ?? '').trim());
    if (required.length) throw new DebriefError(`Please answer: ${required.map((p) => p.id).join(', ')}`);
    const out = await this.#runQuestioner(learnerId, day, s);
    if (out.questioner === 'model' && !s.clarify && out.clarify && out.substance < this.#config.clarifyBelow) {
      await this.#append(learnerId, day, { type: 'clarify-asked', prompt: out.clarify });
      this.#logger.info?.('school.debrief.clarify', { learnerId, day, substance: out.substance });
      return this.day(learnerId, day);
    }
    await this.#freeze(learnerId, day, out, 'questions');
    return this.day(learnerId, day);
      });
  }
  async #freeze(learnerId, day, out, type) {
    await this.#append(learnerId, day, { type, substance: out.substance, substanceReason: out.substanceReason ?? null, questions: out.questions, questioner: out.questioner, questionSource: out.questioner, model: out.model ?? null });
    this.#logger.info?.('school.debrief.questions', { learnerId, day, type, substance: out.substance, count: out.questions.length, questioner: out.questioner, model: out.model, ms: out.ms });
  }
  async clarify(learnerId, day, { text, via = 'typed', audioRef = null }) {
    return this.#once(`${learnerId}/${day}/questions`, async () => {
    const s = await this.#assertOpen(learnerId, day);
    if (!s.clarify || s.clarify.text !== null) throw new DebriefError('No clarification was asked.', 409);
    await this.#append(learnerId, day, { type: 'clarify', text: String(text ?? '').slice(0, 4000), via, audioRef });
    const after = deriveDebriefState(await this.#events(learnerId, day));
    await this.#freeze(learnerId, day, await this.#runQuestioner(learnerId, day, after), 'questions');
    return this.day(learnerId, day);
      });
  }
  async answer(learnerId, day, { questionId, response }) {
    return this.#once(`${learnerId}/${day}/answer/${questionId}`, () => this.#answer(learnerId, day, { questionId, response }));
  }
  async #answer(learnerId, day, { questionId, response }) {
    const s = await this.#assertOpen(learnerId, day);
    const q = (s.questions ?? []).find((x) => x.id === questionId);
    if (!q) throw new DebriefError(`unknown question: ${questionId}`, 404);
    const reveal = q.kind === 'choice' ? { answer: q.answer } : { expected: q.expected };
    if (s.answers[questionId]) return { ...s.answers[questionId], grade: null, reason: null, ...reveal };
    const graded = await this.#judge.grade(q, response);
    await this.#append(learnerId, day, { type: 'answer', questionId, response: String(response ?? '').slice(0, 1000), correct: graded.correct ?? null, grade: graded.grade ?? null, reason: graded.reason == null ? null : String(graded.reason).slice(0, 200) });
    this.#logger.info?.('school.debrief.answer', { learnerId, day, questionId, kind: q.kind, correct: graded.correct });
    return { ...graded, ...reveal };
  }
  async complete(learnerId, day) {
    return this.#once(`${learnerId}/${day}/complete`, async () => {
    const s = await this.#assertOpen(learnerId, day);
    if (!s.questions || s.next?.kind !== 'complete') throw new DebriefError('There are unanswered questions.', 409);
    await this.#append(learnerId, day, { type: 'completed' });
    const v = await this.day(learnerId, day);
    this.#logger.info?.('school.debrief.completed', { learnerId, day, late: v.late, ...v.summary });
    return v;
      });
  }
  async excuse(learnerId, day, { by, reason = null }) {
    await this.#append(learnerId, day, { type: 'excused', by: by ?? null, reason });
    this.#logger.info?.('school.debrief.excused', { learnerId, day, by: by ?? null });
    return this.day(learnerId, day);
  }
  async reject(learnerId, day, { by, reason = null }) {
    await this.#append(learnerId, day, { type: 'rejected', by: by ?? null, reason });
    this.#logger.info?.('school.debrief.rejected', { learnerId, day, by: by ?? null });
    return this.day(learnerId, day);
  }
  // Deliberately works on completed days too (teacher re-score).
  async rescore(learnerId, day, { by }) {
    const s = deriveDebriefState(await this.#events(learnerId, day));
    if (s.questioner !== 'fallback') throw new DebriefError('Only a fallback day can be re-scored.', 409);
    const out = await this.#runQuestioner(learnerId, day, s);
    if (out.questioner !== 'model') throw new DebriefError('The AI is still unavailable.', 503);
    // With answers already given the questions stay; only the score is replaced.
    // questionSource records that the kept questions are still the fallback's (no quiz bonus).
    const kept = Object.keys(s.answers).length > 0;
    const keep = kept ? s.questions : out.questions;
    await this.#append(learnerId, day, { type: 'rescored', by: by ?? null, substance: out.substance, substanceReason: out.substanceReason ?? null, questions: keep, questioner: 'model', questionSource: kept ? 'fallback' : 'model', model: out.model ?? null });
    this.#logger.info?.('school.debrief.rescored', { learnerId, day, by: by ?? null, substance: out.substance });
    return this.day(learnerId, day);
  }
  /**
   * Teacher history: every day with a file, plus every owed day in the range that has none
   * (phase 'not-started'), so a missed day can still be excused. Default range: the last 14
   * owed study days ending today.
   */
  async history(learnerId, { from = null, to = null } = {}) {
    const days = new Set(await this.#debriefs.listDays(learnerId, { from, to }));
    let owed = [];
    try { owed = (await this.#launcher.owedDays?.(learnerId, { from, to })) ?? []; }
    catch (err) { this.#logger.warn?.('school.debrief.history-owed-unavailable', { learnerId, error: err?.message }); }
    for (const d of owed) days.add(d);
    const rows = [];
    for (const d of [...days].sort()) {
      let read;
      try { read = await this.#debriefs.read(learnerId, d); } catch { read = { status: 'unreadable' }; }
      if (read.status === 'unreadable' || read.status === 'corrupt') { rows.push({ studyDay: d, phase: 'unreadable' }); continue; }
      rows.push({ studyDay: d, ...this.#teacherView(d, read.events ?? []) });
    }
    return rows.reverse();
  }
  #teacherView(day, events) {
    const s = deriveDebriefState(events);
    return { phase: s.phase, late: s.late, entries: s.entries, clarify: s.clarify, questions: s.questions, answers: s.answers, substance: s.substance, substanceReason: s.substanceReason, questioner: s.questioner, summary: this.#view(day, events).summary };
  }
}
export { DebriefError };
export default SchoolDebriefService;
