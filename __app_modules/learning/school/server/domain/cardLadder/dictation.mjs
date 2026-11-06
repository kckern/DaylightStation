/**
 * Dictation progression (spec 2026-11-06, Revision 1): pure. Each word of the
 * week's list climbs match -> copy -> blind; a blind pass counts, two blind
 * passes (not necessarily consecutive) finish the word. The clock is injected:
 * nothing here reads ambient time.
 */
export const DICTATION_SCHEMA = 'school.card-ladder-dictation/v1';
export const DICTATION_STEPS = Object.freeze(['match', 'copy', 'blind']);
export const BLIND_PASSES_TO_FINISH = 2;

const isStep = (value) => DICTATION_STEPS.includes(value);
const stamp = (now) => {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === 'number' && Number.isFinite(now)) return new Date(now).toISOString();
  return typeof now === 'string' ? now : null;
};

/** The next stored word after one attempt. A miss or Don't-know steps back; match stays. */
export function applyDictationAttempt(progressWord, { step, pass = false, dontKnow = false } = {}, now) {
  const from = isStep(step) ? step : (isStep(progressWord?.step) ? progressWord.step : 'match');
  const blindPasses = Number.isFinite(progressWord?.blindPasses) ? progressWord.blindPasses : 0;
  const lastAttemptAt = stamp(now);
  if (dontKnow || !pass) {
    const back = from === 'blind' ? 'copy' : 'match';
    return { step: back, blindPasses, lastAttemptAt };
  }
  if (from === 'match') return { step: 'copy', blindPasses, lastAttemptAt };
  if (from === 'copy') return { step: 'blind', blindPasses, lastAttemptAt };
  return { step: 'blind', blindPasses: Math.min(blindPasses + 1, BLIND_PASSES_TO_FINISH), lastAttemptAt };
}

/** Where a list stands. Progress for another week is treated as empty. */
export function dictationState(list, progress, { hasAudio = () => true, inLexicon = () => true } = {}) {
  const week = list?.week ?? null;
  const ids = Array.isArray(list?.words) ? list.words : [];
  const stored = week != null && progress?.week === week && progress.words && typeof progress.words === 'object' ? progress.words : {};
  const words = []; const excluded = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!inLexicon(id)) { excluded.push({ id, reason: 'unknown-word' }); continue; }
    if (!hasAudio(id)) { excluded.push({ id, reason: 'needs-recording' }); continue; }
    const row = stored[id] ?? {};
    const blindPasses = Number.isFinite(row.blindPasses) ? row.blindPasses : 0;
    words.push({ id, step: isStep(row.step) ? row.step : 'match', blindPasses, done: blindPasses >= BLIND_PASSES_TO_FINISH });
  }
  const remaining = words.filter((w) => !w.done).length;
  return { week, words, excluded, done: remaining === 0, remaining };
}

/** The next not-done word, cycling in list order; never the same twice in a row unless it is the only one left. */
export function nextDictationWord(state, { lastWordId = null } = {}) {
  const words = state?.words ?? [];
  const pending = words.filter((w) => !w.done);
  if (!pending.length) return null;
  if (pending.length === 1) return pending[0].id;
  const at = words.findIndex((w) => w.id === lastWordId);
  for (let i = 1; i <= words.length; i += 1) {
    const w = words[(at + i + words.length) % words.length];
    if (!w.done && w.id !== lastWordId) return w.id;
  }
  return pending[0].id;
}
