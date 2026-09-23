// backend/src/2_domains/school/wordLadder/admin.mjs
/**
 * Grown-up word controls (spec §6): the pure parts. `markMastered` sets a word
 * mastered at a chosen stage; `typedAnswers` lists a day file's judged 3.3
 * answers so a grown-up can read and re-grade them. Nothing reads a clock.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { addDays } from '../termVerdict.mjs';
import { GAPS } from './mastery.mjs';

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
  return {
    ...word, ...intro, state: 'mastered', stage, dueDay: addDays(day, gap),
    missStreak: 0, tricky: false, trickySince: null, notYetCarry: false,
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

/** Every typed 3.3 answer recorded in `dayFile`, in answer order. Pure. */
export function typedAnswers(dayFile) {
  const rows = [];
  for (const [itemId, record] of Object.entries(dayFile?.items ?? {})) {
    if (typeof record?.response?.typed !== 'string') continue;
    const meta = record.wordId && record.task ? { wordId: record.wordId, task: record.task, source: record.source ?? null } : legacyMeta(dayFile, itemId);
    if (!meta?.wordId || meta.task !== '3.3') continue;
    rows.push({
      day: dayFile.day, itemId, at: record.at ?? null, wordId: meta.wordId, task: meta.task, source: meta.source,
      typed: record.response.typed, correct: record.result?.correct ?? null, score: record.result?.score ?? null,
      judge: record.result?.judge ?? null, reason: record.reason ?? null, regraded: record.regraded ?? null,
    });
  }
  return rows.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
}
