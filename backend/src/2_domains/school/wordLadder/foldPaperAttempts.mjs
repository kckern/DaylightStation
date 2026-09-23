/**
 * Scanned printed-quiz rows → word status (spec §1 Transitions, paper rows).
 * Paper only demotes (rule 3); a pass is logged on the word. Idempotent by id.
 *
 * A scanned row's `bankId` is `<docId>@<rev>`. `docId` is accepted when it is
 * a legacy per-deck id (`quizDocumentIds`, exact match) OR a per-learner id
 * (spec §8 Printed quiz) parsed by `parseLearnerQuizId(docId, learner)` whose
 * `learnerId` matches `learner.learnerId` — segment-bounded, so learner `a`'s
 * doc never matches sibling `a-b`'s (a raw prefix `startsWith` would). A
 * `docId` that parses as a per-learner id under `learner`'s package but for a
 * DIFFERENT learner is refused, never folded, and recorded in
 * `paperAttemptsFolded` so it is not re-evaluated every day forever.
 */
import { applyGraded, emptyWordV3 } from './mastery.mjs';
import { parseLearnerQuizId } from './quizId.mjs';

export function foldPaperAttempts({
  status, attempts = [], quizDocumentIds = [], learner = null, dayOf, settings,
}) {
  const next = structuredClone(status);
  next.paperAttemptsFolded = [...(status?.paperAttemptsFolded ?? [])];
  const seen = new Set(next.paperAttemptsFolded);
  const idSet = new Set(quizDocumentIds);
  const folded = [];
  const refused = [];
  for (const attempt of [...attempts].sort((a, b) => String(a?.at).localeCompare(String(b?.at)))) {
    if (attempt?.transport !== 'paper' || typeof attempt.id !== 'string' || seen.has(attempt.id)) continue;
    if (typeof attempt.bankId !== 'string') continue;
    const at = attempt.bankId.lastIndexOf('@');
    const docId = at >= 0 ? attempt.bankId.slice(0, at) : attempt.bankId;
    let accepted = idSet.has(docId);
    let refusedRow = null;
    if (!accepted && learner) {
      const parsed = parseLearnerQuizId(docId, learner);
      if (parsed) {
        if (parsed.learnerId === learner.learnerId) accepted = true;
        else refusedRow = { attemptId: attempt.id, bankId: attempt.bankId };
      }
    }
    if (!accepted) {
      if (refusedRow) {
        seen.add(attempt.id);
        next.paperAttemptsFolded.push(attempt.id);
        refused.push(refusedRow);
      }
      continue;
    }
    if (typeof attempt.itemId !== 'string' || typeof attempt.correct !== 'boolean') continue;
    next.words[attempt.itemId] = applyGraded(next.words[attempt.itemId] ?? emptyWordV3(), {
      source: 'paper', correct: attempt.correct, day: dayOf(attempt.at), task: 'paper', settings,
    });
    seen.add(attempt.id);
    next.paperAttemptsFolded.push(attempt.id);
    folded.push({ attemptId: attempt.id, wordId: attempt.itemId, correct: attempt.correct });
  }
  return { status: next, folded, refused };
}
