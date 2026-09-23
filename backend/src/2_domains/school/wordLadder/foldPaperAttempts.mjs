/**
 * Scanned printed-quiz rows → word status (spec §1 Transitions, paper rows).
 * Paper only demotes (rule 3); a pass is logged on the word. Idempotent by id.
 */
import { applyGraded, emptyWordV3 } from './mastery.mjs';

export function foldPaperAttempts({ status, attempts = [], quizDocumentIds = [], dayOf, settings }) {
  const next = structuredClone(status);
  next.paperAttemptsFolded = [...(status?.paperAttemptsFolded ?? [])];
  const seen = new Set(next.paperAttemptsFolded);
  const prefixes = quizDocumentIds.map((id) => `${id}@`);
  const folded = [];
  for (const attempt of [...attempts].sort((a, b) => String(a?.at).localeCompare(String(b?.at)))) {
    if (attempt?.transport !== 'paper' || typeof attempt.id !== 'string' || seen.has(attempt.id)) continue;
    if (typeof attempt.bankId !== 'string' || !prefixes.some((prefix) => attempt.bankId.startsWith(prefix))) continue;
    if (typeof attempt.itemId !== 'string' || typeof attempt.correct !== 'boolean') continue;
    next.words[attempt.itemId] = applyGraded(next.words[attempt.itemId] ?? emptyWordV3(), {
      source: 'paper', correct: attempt.correct, day: dayOf(attempt.at), task: 'paper', settings,
    });
    seen.add(attempt.id);
    next.paperAttemptsFolded.push(attempt.id);
    folded.push({ attemptId: attempt.id, wordId: attempt.itemId, correct: attempt.correct });
  }
  return { status: next, folded };
}
