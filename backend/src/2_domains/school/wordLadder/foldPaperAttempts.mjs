/**
 * Scanned printed-quiz rows → word status (design "Feedback into word status").
 * A pull, not an event: the application calls this at every plan build.
 * Paper can only demote: a miss → quiz-miss (LEARNING), a pass → quiz-pass
 * (logged only). Idempotent by attempt id.
 */
import { applyCheck, readWord } from './wordLadder.mjs';

export function foldPaperAttempts({ status, attempts = [], quizDocumentIds = [], dayOf }) {
  const next = structuredClone(status);
  next.words ??= {};
  next.paperAttemptsFolded = [...(status?.paperAttemptsFolded ?? [])];
  const seen = new Set(next.paperAttemptsFolded);
  const prefixes = quizDocumentIds.map((id) => `${id}@`);
  const folded = [];
  const ordered = [...attempts].sort((a, b) => String(a?.at).localeCompare(String(b?.at)));
  for (const attempt of ordered) {
    if (attempt?.transport !== 'paper' || typeof attempt.id !== 'string' || seen.has(attempt.id)) continue;
    if (typeof attempt.bankId !== 'string' || !prefixes.some((prefix) => attempt.bankId.startsWith(prefix))) continue;
    if (typeof attempt.itemId !== 'string' || typeof attempt.correct !== 'boolean') continue;
    next.words[attempt.itemId] = applyCheck(readWord(next, attempt.itemId), {
      at: attempt.at, day: dayOf(attempt.at), correct: attempt.correct, phase: 'paper', attemptId: attempt.id,
    });
    seen.add(attempt.id);
    next.paperAttemptsFolded.push(attempt.id);
    folded.push({ attemptId: attempt.id, wordId: attempt.itemId, correct: attempt.correct });
  }
  return { status: next, folded };
}
