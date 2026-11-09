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

const P = (id, text, required, kind) => Object.freeze({ id, text, required, kind });
export const PROMPTS = Object.freeze([
  P('classes', 'Which classes did you have today?', false, 'chips'),
  P('moment', 'Tell me about one moment from today. Where were you, who was there, what happened?', true, 'text'),
  P('teach', "What can you do or know now that you couldn't this morning? Explain it so {teachTo} could try it.", true, 'text'),
  P('hard', 'What was hard, and what did you do about it?', false, 'text'),
]);
/** Prompt ids from before the rich-answers redesign; their entries stay in a day's state untouched. */
export const LEGACY_PROMPT_IDS = Object.freeze(['learned', 'notable']);

export function promptsFor(config = {}) {
  const teachTo = config?.teachTo ?? 'a younger kid';
  return PROMPTS.map((p) => ({ ...p, text: p.text.replaceAll('{teachTo}', () => teachTo) }));
}

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
    quizPassRatio: num(d.quiz_pass_ratio, 0.67),
    richLevel: num(d.rich_level, 3),
    teachableLevel: num(d.teachable_level, 4),
    maxProbes: num(d.max_probes, 2),
    teachTo: typeof d.teach_to === 'string' && d.teach_to.trim() ? d.teach_to.trim() : 'a younger kid',
    classOptions: Array.isArray(d.class_options) && d.class_options.length ? d.class_options.map(String) : [...DEFAULT_CLASS_OPTIONS],
    priorPromptDays: num(d.prior_prompt_days, 20),
  };
}

const DEFAULT_CLASS_OPTIONS = ['Reading', 'Writing', 'Math', 'Typing', 'Spelling', 'Grammar', 'Science', 'P.E.', 'Art', 'Music', 'Quest', 'Field trip'];

/** Ask another probe only while the answer is below teachable and the budget is unspent. */
export function shouldProbe({ level, asked, maxProbes, teachableLevel }) {
  return Number.isInteger(level) && level < teachableLevel && asked < maxProbes;
}

const normPrompt = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ECHO_RE = /\b(the child|you said|did you say|did you have|according to you)\b/i;

/** Drop echo questions, repeats of earlier days' prompts, and duplicates within the list. */
export function filterQuestions(questions = [], priorPrompts = []) {
  const seen = new Set((priorPrompts ?? []).map(normPrompt));
  const out = [];
  for (const q of questions ?? []) {
    const prompt = String(q?.prompt ?? '');
    if (ECHO_RE.test(prompt)) continue;
    const n = normPrompt(prompt);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(q);
  }
  return out;
}

const countWords = (t) => (String(t ?? '').match(/\S+/g) ?? []).length;
const countMarkers = (t) => (String(t ?? '').match(/\b(because|so|then|how|first|next|after|why)\b/gi) ?? []).length + (String(t ?? '').match(/\d+/g) ?? []).length;

export function debriefMetrics(state = {}) {
  const entries = Object.values(state.entries ?? {});
  // Class chips are a picked list, not the child's words: they never count toward length or detail.
  const texts = [...entries.filter((e) => e.via !== 'chips').map((e) => e.text), ...(state.probes ?? []).map((p) => p.text)];
  return {
    level: Number.isInteger(state.level) ? state.level : null,
    words: texts.reduce((n, t) => n + countWords(t), 0),
    markers: texts.reduce((n, t) => n + countMarkers(t), 0),
    probes: (state.probes ?? []).filter((p) => p.text !== null && p.text !== undefined).length,
    voiceEntries: entries.filter((e) => e.via === 'voice').length,
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
export const TEACHER_EVENTS = Object.freeze(new Set(['excused', 'rejected', 'rescored', 'discussed']));

export function deriveDebriefState(events = []) {
  const s = {
    phase: 'not-started', late: false, entries: {}, clarify: null, probes: [], questions: null, level: null, levelReason: null, hook: null, discussedAt: null, substance: null,
    substanceReason: null, questioner: null, questionSource: null, answers: {}, next: null, summary: null, completedAt: null,
  };
  let completed = false; let override = null;
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (e.late === true && !TEACHER_EVENTS.has(e.type)) s.late = true;
    if (e.type === 'entry' && e.promptId) s.entries[e.promptId] = { text: e.text ?? '', via: e.via ?? null, audioRef: e.audioRef ?? null };
    else if (e.type === 'clarify-asked') s.probes.push({ prompt: e.prompt, text: null });
    else if (e.type === 'clarify') { const open = s.probes.find((p) => p.text === null); if (open) open.text = e.text ?? ''; }
    else if (e.type === 'discussed') s.discussedAt = e.at ?? null;
    else if (QUESTION_EVENTS.has(e.type)) {
      s.questions = Array.isArray(e.questions) ? e.questions : [];
      s.substance = Number.isInteger(e.substance) ? e.substance : null;
      s.substanceReason = e.substanceReason ?? null;
      s.questioner = e.questioner ?? null;
      s.level = Number.isInteger(e.level) ? e.level : null;
      s.levelReason = e.levelReason ?? null;
      s.hook = e.hook ?? null;
      // Where the QUESTIONS came from; old events predate the field, so they default to the questioner.
      s.questionSource = e.questionSource ?? e.questioner ?? null;
    } else if (e.type === 'answer' && e.questionId && !(e.questionId in s.answers)) {
      s.answers[e.questionId] = { response: e.response ?? null, correct: e.correct ?? null };
    } else if (e.type === 'completed') { completed = true; s.completedAt = e.at ?? null; }
    else if (e.type === 'excused' || e.type === 'rejected') override = e.type;
  }
  const openProbe = s.probes.find((p) => p.text === null);
  s.clarify = openProbe ? { prompt: openProbe.prompt, text: null } : null;
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
  if (s.clarify) { s.phase = 'clarify'; s.next = { kind: 'clarify', id: null }; return s; }
  const missing = PROMPTS.find((p) => !(p.id in s.entries));
  s.phase = Object.keys(s.entries).length || events.some((e) => e?.type === 'opened') ? 'entry' : 'not-started';
  s.next = missing ? { kind: 'prompt', id: missing.id } : { kind: 'submit', id: null };
  return s;
}

/**
 * Deterministic questions when the AI is unavailable: built only from what the learner said.
 * The old "which of these did you say" question was an echo and is gone; one real
 * reflection remains. A fallback day never earns the quiz bonus (SchoolDebriefProgramLauncher.weekFacts).
 */
export function fallbackQuestions(entries = {}) {
  const taught = String(entries.teach?.text ?? '').trim() || String(entries.learned?.text ?? '').trim();
  if (!taught) return [];
  return [{ id: 'f3', kind: 'short', prompt: 'What is one step someone would need to try what you explained?', expected: taught }];
}
