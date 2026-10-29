// __backend/src/2_domains/school/cardLadder/admin.mjs
/**
 * Grown-up word controls (spec §6): the pure parts. `markMastered` sets a word
 * mastered at a chosen stage; `typedAnswers` lists a day file's judged typed
 * answers so a grown-up can read and re-grade them. Nothing reads a clock.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { addDays } from "../termVerdict.mjs";
import { GAPS, TYPED_TASKS } from "./mastery.mjs";

/**
 * Mastered at `stage`, due after that stage's gap scaled by the day's tuned
 * `gapScale` (as a recheck pass, never under a day); the miss flags a pass
 * would clear are cleared. A word never introduced counts as introduced
 * `day` (by `admin`), so a later recheck miss (→ familiar) is carried like any
 * other, without spending the child's new-word allowance for `day`.
 */
export function markMastered(word, { stage, day, gapScale = 1 }) {
  if (!Number.isInteger(stage) || stage < 0) throw new ValidationError('stage must be a whole number, 0 or more');
  const gap = Math.max(1, Math.round(GAPS[Math.min(stage, GAPS.length - 1)] * (gapScale ?? 1)));
  // `introducedBy: 'admin'` keeps a grown-up's mark out of the day's intro count
  // (it must not use up the child's new-word allowance); carry still sees it.
  const intro = word.introducedDay ? {} : { introducedDay: day, introducedBy: 'admin' };
  // A grown-up's mark is a sign-off (ruling 2026-09-23): the word reads
  // Mastered, and its prerequisites stand met so later rechecks stay typed.
  return {
    ...word, ...intro, state: 'mastered', stage, dueDay: addDays(day, gap),
    missStreak: 0, tricky: false, trickySince: null, notYetCarry: false,
    recognizedCount: Math.max(2, word.recognizedCount ?? 0), matched: true, typedSignedOff: word.typedSignedOff ?? day,
  };
}

// Records written before items carried their word and task: recover them from
// the day's plan (a recheck's id names its word; a quiz item indexes its
// round's queue; a practice item indexes the day's latest run).
function legacyMeta(dayFile, itemId) {
  if (itemId.startsWith('rc:')) {
    const wordId = itemId.slice(3);
    return { wordId, task: dayFile.rechecks?.answered?.[wordId]?.task ?? null, source: 'recheck' };
  }
  const quiz = /^(r\d+):q:(\d+)$/.exec(itemId);
  if (quiz) {
    const task = (dayFile.rounds ?? []).find((round) => round.id === quiz[1])?.quiz?.queue?.[Number(quiz[2])];
    return task ? { wordId: task.wordId, task: task.task, source: 'verify' } : null;
  }
  const practice = /^(p\d+):(\d+)$/.exec(itemId);
  if (practice && dayFile.practice?.id === practice[1]) {
    const task = dayFile.practice.queue?.[Number(practice[2])];
    if (task?.kind === 'graded') return { wordId: task.wordId, task: task.task, source: 'practice' };
    if (task?.kind === 'type-practice') return { wordId: task.wordId, task: '3.3', source: 'practice' };
  }
  return null;
}

/** Every judged typed answer (3.3, or 1.4 graded dictation) recorded in `dayFile`, in answer order. Pure. */
export function typedAnswers(dayFile) {
  const rows = [];
  for (const [itemId, record] of Object.entries(dayFile?.items ?? {})) {
    if (typeof record?.response?.typed !== 'string') continue;
    const meta = record.wordId && record.task ? { wordId: record.wordId, task: record.task, source: record.source ?? null } : legacyMeta(dayFile, itemId);
    if (!meta?.wordId || !TYPED_TASKS.includes(meta.task)) continue;
    rows.push({
      day: dayFile.day, itemId, at: record.at ?? null, wordId: meta.wordId, task: meta.task, source: meta.source,
      typed: record.response.typed, correct: record.result?.correct ?? null, score: record.result?.score ?? null,
      judge: record.result?.judge ?? null, reason: record.reason ?? null, regraded: record.regraded ?? null,
    });
  }
  return rows.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
}

// Item ids that carry no answer: the post-goal summary card. (A round's drill
// offer IS listed — taking or skipping the drill is the child's choice.)
const UNANSWERED = new Set(['summary']);

// A practice item names no task or step; what the child did says which it was.
function stepFromResponse(response) {
  if (typeof response?.typed === 'string') return 'type';
  if (Array.isArray(response?.tiles)) return 'tiles';
  if (response?.choice != null || response?.dontKnow) return 'choice';
  if (response?.sort) return 'sort';
  return null;
}

/**
 * What kind of step an item id names, and its step within that kind.
 * `rc:<word>` recheck · `rN:i:<word>:<step>` intro · `rN:s:k` sort ·
 * `rN:q:k` quiz · `rN:m…` match · `rN:offer` drill offer · `dN:k` drill
 * step (named by the day's drill plan) · `pN:…` practice.
 */
function itemKind(dayFile, itemId) {
  if (itemId.startsWith('rc:')) return { kind: 'recheck', step: null };
  const intro = /^r\d+:i:[^:]+:([a-z-]+)$/.exec(itemId);
  if (intro) return { kind: 'intro', step: intro[1] };
  if (/^r\d+:s:\d+$/.test(itemId)) return { kind: 'sort', step: null };
  if (/^r\d+:q:\d+$/.test(itemId)) return { kind: 'quiz', step: null };
  if (/^r\d+:m(:|$)/.test(itemId)) return { kind: 'match', step: null };
  if (/^r\d+:offer$/.test(itemId)) return { kind: 'offer', step: null };
  const drill = /^(d\d+):(\d+)$/.exec(itemId);
  if (drill) {
    const plan = (dayFile.drills ?? []).find((entry) => entry?.id === drill[1]);
    return { kind: 'drill', step: plan?.steps?.[Number(drill[2])] ?? null };
  }
  if (/^p\d+:/.test(itemId)) return { kind: 'practice', step: null };
  return { kind: 'other', step: null };
}

/**
 * Every answer recorded in `dayFile`, in the order it was given, for a
 * grown-up to read: what was asked (kind / step / task), what the learner
 * did (`response`, verbatim), and what the engine made of it (`correct`,
 * `answer`, and for a judged typed answer its `score` / `judge` / `reason`).
 * `correct` is null for a step that is not graded (a flashcard seen, a
 * spoken take, a sort). Pure.
 */
export function dayAnswers(dayFile) {
  const rows = [];
  for (const [itemId, record] of Object.entries(dayFile?.items ?? {})) {
    if (UNANSWERED.has(itemId) || !record || typeof record !== 'object') continue;
    // Opening the practice menu is navigation, not an answer.
    if (record.response?.menu) continue;
    const legacy = record.wordId ? null : legacyMeta(dayFile, itemId);
    const kind = itemKind(dayFile, itemId).kind;
    const step = itemKind(dayFile, itemId).step ?? (kind === 'practice' ? stepFromResponse(record.response) : null);
    const result = record.result ?? {};
    const engineCorrect = typeof result.correct === 'boolean' ? result.correct : null;
    rows.push({
      itemId, at: record.at ?? null, kind, step,
      wordId: record.wordId ?? legacy?.wordId ?? null,
      task: record.task ?? legacy?.task ?? null,
      source: record.source ?? legacy?.source ?? null,
      response: record.response ?? null,
      // A grown-up's re-grade outranks the engine's verdict; both are kept.
      correct: typeof record.regraded?.pass === 'boolean' ? record.regraded.pass : engineCorrect,
      engineCorrect,
      answer: result.answer ?? null,
      score: result.score ?? null,
      judge: result.judge ?? null,
      reason: record.reason ?? null,
      regraded: record.regraded ?? null,
    });
  }
  return rows.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
}

/** One day at a glance: when, how long, and how the graded answers went. Pure. */
export function daySummary(dayFile) {
  const answers = dayAnswers(dayFile);
  const graded = answers.filter((row) => row.correct !== null);
  const sittings = Object.entries(dayFile?.sittings ?? {}).map(([id, sitting]) => ({
    id, deckId: sitting?.deckId ?? null, openedAt: sitting?.openedAt ?? null,
    closedAt: sitting?.closedAt ?? null, reason: sitting?.reason ?? null,
  })).sort((a, b) => String(a.openedAt ?? '').localeCompare(String(b.openedAt ?? '')));
  return {
    day: dayFile?.day ?? null,
    doneAt: dayFile?.doneAt ?? null,
    activeMs: Number.isFinite(dayFile?.activeMs) ? dayFile.activeMs : null,
    sittings,
    answered: answers.length,
    graded: graded.length,
    correct: graded.filter((row) => row.correct).length,
    // Each missed word once, however many times it was missed that day.
    missedWords: [...new Set(graded.filter((row) => !row.correct).map((row) => row.wordId).filter(Boolean))],
  };
}
