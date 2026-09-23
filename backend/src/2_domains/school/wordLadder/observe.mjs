// backend/src/2_domains/school/wordLadder/observe.mjs
/**
 * Sequencing observability (spec §8). Pure reads over the engine's own state,
 * so the service can log WHY an item came up and HOW the day's plan moved
 * without the engine ever touching a logger:
 *
 *  - `servedWhy(ctx, item)` — the reason an item is on screen, as data
 *    (`{ reason, ...detail }`). Reasons: `intro`, `stream`, `carry`,
 *    `stream:again-after-<pile>` / `carry:again-after-<pile>`,
 *    `verify-recognition`, `match-after-verify`, `drill-offer`,
 *    `recheck-typed-signoff`, `recheck-recognition:<unmet prerequisites>`,
 *    `drill:<step>`, `practice:<mode>`, `summary`, `menu`.
 *  - `dayChanges(beforeDay, afterDay)` — every change to the plan between two
 *    day files: `day.planned`, `round.planned`, `round.phase`,
 *    `drill.started`, `drill.finished`, `day.done`.
 *  - `prereqChanges(beforeWords, afterWords)` — a word's sign-off
 *    prerequisites (`recognizedCount`, `matched`, `typedSignedOff`) moving,
 *    with the whole snapshot, so a word's climb reads from the logs.
 */
import { TYPED_TASKS, readyForSignOff } from './mastery.mjs';
import { roundHasMatch } from './engine.mjs';

/**
 * What stands between a word and its typed sign-off (ruling 2026-09-23), in
 * a fixed order; empty when `readyForSignOff` is true.
 */
export function signOffGaps(word) {
  const gaps = [];
  if (word?.state !== 'mastered') gaps.push('not-mastered');
  if ((word?.recognizedCount ?? 0) < 2) gaps.push('recognized<2');
  if (word?.matched !== true) gaps.push('unmatched');
  if ((word?.stage ?? 0) < 1) gaps.push('stage<1');
  if (TYPED_TASKS.includes(word?.lastGraded?.task) && word.lastGraded.correct === false) gaps.push('typed-lapse');
  return gaps;
}

function streamWhy(round, wordId) {
  const kind = round.newWords?.includes(wordId) ? 'stream' : 'carry';
  const views = round.stream?.viewsPer?.[wordId] ?? 0;
  if (!views) return { reason: kind, pass: 1 };
  return { reason: `${kind}:again-after-${round.stream?.latest?.[wordId] ?? 'sort'}`, pass: views + 1 };
}

/** Why `item` (from `currentItem(ctx)`) is the one on screen. Pure. */
export function servedWhy(ctx, item) {
  if (!item) return { reason: null };
  if (item.type === 'summary') return { reason: 'summary' };
  if (item.type === 'menu') return { reason: 'menu' };
  if (item.source === 'practice') return { reason: `practice:${ctx.dayFile.practice?.mode ?? '?'}` };
  if (item.source === 'recheck') {
    if (TYPED_TASKS.includes(item.task)) return { reason: 'recheck-typed-signoff' };
    const gaps = signOffGaps(ctx.status.words?.[item.wordId]);
    return { reason: gaps.length ? `recheck-recognition:${gaps.join(',')}` : 'recheck-recognition' };
  }
  if (item.type === 'drill') {
    const drill = (ctx.dayFile.drills ?? []).find((d) => item.id.startsWith(`${d.id}:`));
    return { reason: `drill:${item.step}`, drillSource: drill?.source ?? null };
  }
  const round = ctx.dayFile.rounds?.at(-1);
  if (!round) return { reason: null };
  const base = { round: round.id };
  if (round.phase === 'intro') return { ...base, reason: 'intro', step: round.intro?.step ?? null };
  if (item.type === 'drill-offer') return { ...base, reason: 'drill-offer', notYet: round.stream?.notYetCount?.[item.wordId] ?? null };
  if (item.type === 'match') return { ...base, reason: 'match-after-verify' };
  if (round.phase === 'stream') return { ...base, ...streamWhy(round, item.wordId) };
  if (item.source === 'verify') return { ...base, reason: 'verify-recognition' };
  return { ...base, reason: null };
}

const roundIndex = (dayFile, id) => dayFile.rounds.findIndex((r) => r.id === id) + 1;

function phaseDetail(round, to) {
  if (to === 'quiz') {
    const queue = (round.quiz?.queue ?? []).map((t) => `${t.wordId}:${t.task}`);
    return { queue, eligible: [...new Set((round.quiz?.queue ?? []).map((t) => t.wordId))], notQuizzed: round.words.filter((id) => !(round.quiz?.queue ?? []).some((t) => t.wordId === id)) };
  }
  if (to === 'match') return { wordIds: round.match?.wordIds ?? [] };
  if (to === 'offer') return { wordId: round.offer?.wordId ?? null };
  if (to === 'done') return { passed: round.quiz?.passed ?? [], failed: round.quiz?.failed ?? [] };
  return {};
}

/** Every change to the day's plan between two day files, in a stable order. Pure. */
export function dayChanges(before, after) {
  const out = [];
  if (!before?.atOpen && after?.atOpen) {
    out.push({ event: 'day.planned', data: {
      dueRechecks: after.rechecks?.order ?? [], tricky: after.atOpen.tricky ?? [], newAllowance: after.atOpen.newAllowance ?? null,
    } });
  }
  const prior = new Map((before?.rounds ?? []).map((r) => [r.id, r]));
  for (const round of after?.rounds ?? []) {
    const was = prior.get(round.id);
    const index = roundIndex(after, round.id);
    if (!was) {
      const newIds = round.newWords ?? [];
      out.push({ event: 'round.planned', data: {
        round: round.id, index, kind: round.kind ?? null, size: round.words.length, newIds,
        carryIds: round.words.filter((id) => !newIds.includes(id)), hasMatch: roundHasMatch(round), phase: round.phase,
      } });
      continue;
    }
    if (was.phase !== round.phase) {
      out.push({ event: 'round.phase', data: { round: round.id, index, from: was.phase, to: round.phase, ...phaseDetail(round, round.phase) } });
    }
  }
  const priorDrills = new Map((before?.drills ?? []).map((d) => [d.id, d]));
  for (const drill of after?.drills ?? []) {
    const was = priorDrills.get(drill.id);
    if (!was) out.push({ event: 'drill.started', data: { drillId: drill.id, wordId: drill.wordId, source: drill.source ?? null, steps: drill.steps ?? [] } });
    if (drill.done && !was?.done && was) {
      out.push({ event: 'drill.finished', data: { drillId: drill.id, wordId: drill.wordId, source: drill.source ?? null, excluded: drill.excluded === true } });
    }
  }
  if (!before?.doneAt && after?.doneAt) out.push({ event: 'day.done', data: { doneAt: after.doneAt, activeMs: after.activeMs ?? null } });
  return out;
}

const PREREQ_KEYS = ['recognizedCount', 'matched', 'typedSignedOff'];
const prereqOf = (word) => ({ recognizedCount: word?.recognizedCount ?? 0, matched: word?.matched === true, typedSignedOff: word?.typedSignedOff ?? null });

/** Words whose sign-off prerequisites moved, with the after-snapshot. Word-id order. Pure. */
export function prereqChanges(beforeWords = {}, afterWords = {}) {
  const ids = [...new Set([...Object.keys(beforeWords ?? {}), ...Object.keys(afterWords ?? {})])].sort();
  const out = [];
  for (const wordId of ids) {
    const from = prereqOf(beforeWords?.[wordId]);
    const to = prereqOf(afterWords?.[wordId]);
    const changed = PREREQ_KEYS.filter((key) => from[key] !== to[key]);
    if (!changed.length) continue;
    const word = afterWords?.[wordId];
    out.push({ wordId, changed, ...to, readyForSignOff: readyForSignOff(word), gaps: signOffGaps(word) });
  }
  return out;
}
