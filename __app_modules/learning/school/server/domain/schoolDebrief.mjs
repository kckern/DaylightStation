/**
 * The after-school debrief program (spec 2026-10-21-school-debrief-design).
 * A learner who attends an outside school tells what they did; an AI asks
 * frozen follow-up questions. Pure: no clock, no I/O.
 */
import { SUBJECT_IDS } from "./curriculum/unitValidation.mjs";

export const SCHOOL_DEBRIEF_PROGRAM_ID = 'school-debrief';
export const SCHOOL_DEBRIEF_UNIT_ID = 'school-debrief:daily';
export const SCHOOL_DEBRIEF_TITLE = 'After-school debrief';
const DEFAULT_SUBJECT = 'writing';

export const PROMPTS = Object.freeze([
  Object.freeze({ id: 'classes', text: 'What classes or subjects did you have today?', required: false }),
  Object.freeze({ id: 'learned', text: 'Tell me one thing you learned.', required: true }),
  Object.freeze({ id: 'notable', text: 'What was hard, funny, or interesting?', required: false }),
]);

export function validateSchoolDebriefEnrollment(raw = {}) {
  const errors = [];
  const subject = raw.subject ?? DEFAULT_SUBJECT;
  if (!SUBJECT_IDS.includes(subject)) errors.push(`school-debrief subject must be one of ${SUBJECT_IDS.join(', ')}`);
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : SCHOOL_DEBRIEF_TITLE;
  if (errors.length) return { errors };
  return { errors: [], enrollment: { programId: SCHOOL_DEBRIEF_PROGRAM_ID, corpusId: null, subject, title } };
}

export function debriefConfigOf(schoolConfig = {}) {
  const d = schoolConfig?.debrief ?? {};
  const num = (v, dflt) => (Number.isFinite(v) ? v : dflt);
  return {
    questioner: { model: d.questioner?.model ?? 'gpt-5-mini', timeoutMs: num(d.questioner?.timeout_ms, 30000) },
    judge: { model: d.judge?.model ?? 'gpt-5-nano', timeoutMs: num(d.judge?.timeout_ms, 8000) },
    substantiveScore: num(d.substantive_score, 6),
    clarifyBelow: num(d.clarify_below, 4),
    quizPassRatio: num(d.quiz_pass_ratio, 0.67),
  };
}

/** Calendar step on a YYYY-MM-DD label (UTC components, no ISO slicing). */
export function previousStudyDay(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const pad = (n) => String(n).padStart(2, '0');
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
}

const QUESTION_EVENTS = new Set(['questions', 'rescored']);
/** Grown-up actions (spec §2 events table). Never late: a teacher acting tomorrow must not make today late. */
export const TEACHER_EVENTS = Object.freeze(new Set(['excused', 'rejected', 'rescored']));

export function deriveDebriefState(events = []) {
  const s = {
    phase: 'not-started', late: false, entries: {}, clarify: null, questions: null, substance: null,
    substanceReason: null, questioner: null, answers: {}, next: null, summary: null, completedAt: null,
  };
  let completed = false; let override = null;
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (e.late === true && !TEACHER_EVENTS.has(e.type)) s.late = true;
    if (e.type === 'entry' && e.promptId) s.entries[e.promptId] = { text: e.text ?? '', via: e.via ?? null, audioRef: e.audioRef ?? null };
    else if (e.type === 'clarify-asked') s.clarify = { prompt: e.prompt, text: null };
    else if (e.type === 'clarify' && s.clarify) s.clarify = { ...s.clarify, text: e.text ?? '' };
    else if (QUESTION_EVENTS.has(e.type)) {
      s.questions = Array.isArray(e.questions) ? e.questions : [];
      s.substance = Number.isInteger(e.substance) ? e.substance : null;
      s.substanceReason = e.substanceReason ?? null;
      s.questioner = e.questioner ?? null;
    } else if (e.type === 'answer' && e.questionId && !(e.questionId in s.answers)) {
      s.answers[e.questionId] = { response: e.response ?? null, correct: e.correct ?? null };
    } else if (e.type === 'completed') { completed = true; s.completedAt = e.at ?? null; }
    else if (e.type === 'excused' || e.type === 'rejected') override = e.type;
  }
  if (s.questions) {
    const graded = s.questions.filter((q) => s.answers[q.id] && s.answers[q.id].correct !== null);
    s.summary = { substance: s.substance, substantive: null, quiz: { right: graded.filter((q) => s.answers[q.id].correct === true).length, graded: graded.length } };
  }
  if (override) { s.phase = override; s.next = null; return s; }
  if (completed) { s.phase = 'completed'; s.next = null; return s; }
  if (s.questions) {
    const open = s.questions.find((q) => !(q.id in s.answers));
    s.phase = 'answering';
    s.next = open ? { kind: 'question', id: open.id } : { kind: 'complete', id: null };
    if (!Object.keys(s.answers).length && open) s.phase = 'questions';
    return s;
  }
  if (s.clarify && s.clarify.text === null) { s.phase = 'clarify'; s.next = { kind: 'clarify', id: null }; return s; }
  const missing = PROMPTS.find((p) => !(p.id in s.entries));
  s.phase = Object.keys(s.entries).length || events.some((e) => e?.type === 'opened') ? 'entry' : 'not-started';
  s.next = missing ? { kind: 'prompt', id: missing.id } : { kind: 'submit', id: null };
  return s;
}

/** A small stable hash of the entries' text, so the fallback's option order is pure but not fixed. */
function textHash(entries) {
  const text = PROMPTS.map((p) => String(entries[p.id]?.text ?? '')).join('\u0000');
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}
const FALLBACK_DISTRACTORS = ['Lunch', 'Recess', 'Music', 'Library', 'Gym', 'Art'];

/**
 * Deterministic questions when the AI is unavailable: built only from what the learner said.
 * f1 names one class they said among classes they did not; its position rotates with the
 * text, so "always pick the first" is not a strategy. f3 is a real reflection. A fallback
 * day never earns the quiz bonus (SchoolDebriefProgramLauncher.weekFacts).
 */
export function fallbackQuestions(entries = {}) {
  const classes = String(entries.classes?.text ?? '').split(/,|\band\b|\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
  const learned = String(entries.learned?.text ?? '').trim();
  const qs = [];
  if (classes.length) {
    const h = textHash(entries);
    const said = new Set(classes.map((c) => c.toLowerCase()));
    const answer = classes[h % classes.length];
    const distractors = FALLBACK_DISTRACTORS.filter((d) => !said.has(d.toLowerCase())).slice(0, 3);
    const options = [answer, ...distractors];
    const shift = h % options.length;
    const rotated = [...options.slice(shift), ...options.slice(0, shift)];
    qs.push({ id: 'f1', kind: 'choice', prompt: 'Which of these did you say you had today?', options: rotated, answer });
  }
  if (learned) qs.push({ id: 'f3', kind: 'short', prompt: 'Explain the thing you learned in one sentence, as if teaching a younger kid.', expected: learned });
  return qs;
}
