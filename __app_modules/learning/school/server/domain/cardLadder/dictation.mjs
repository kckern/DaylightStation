/**
 * Dictation (spec 2026-11-06, Revisions 1-2): pure. The list is the newest
 * week tag on lexicon entries (`currentDictation`). Each word of the
 * week's list climbs match -> copy -> blind; a blind pass counts, two blind
 * passes (not necessarily consecutive) finish the word. The clock is injected:
 * nothing here reads ambient time.
 */
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
  // `finished`: nothing is left to drill. `done` (ready) is the honest one
  // (UX audit #5): every word drilled AND none excluded — an excluded word is
  // waiting for a grown-up, so a list with one, or an empty list, is never ready.
  const finished = remaining === 0;
  return { week, words, excluded, done: finished && words.length > 0 && excluded.length === 0, finished, remaining };
}

/**
 * The next not-done word, cycling in list order; never the same twice in a
 * row unless it is the only one left — or `repeat` asks for it: after a miss
 * the same word is served again at its new step (UX audit #3), so only a pass
 * moves to another word.
 */
export function nextDictationWord(state, { lastWordId = null, repeat = false } = {}) {
  const words = state?.words ?? [];
  const pending = words.filter((w) => !w.done);
  if (!pending.length) return null;
  if (repeat && pending.some((w) => w.id === lastWordId)) return lastWordId;
  if (pending.length === 1) return pending[0].id;
  const at = words.findIndex((w) => w.id === lastWordId);
  for (let i = 1; i <= words.length; i += 1) {
    const w = words[(at + i + words.length) % words.length];
    if (!w.done && w.id !== lastWordId) return w.id;
  }
  return pending[0].id;
}

const ISO_WEEK = /^(\d{4})-W(\d{2})$/;
/** `2026-W46` (any case) → `2026-W46`, or null when it is not an ISO week tag. */
export function normalizeDictationWeek(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_WEEK.exec(value.trim().toUpperCase());
  if (!match) return null;
  const week = Number(match[2]);
  return week >= 1 && week <= 53 ? `${match[1]}-W${match[2]}` : null;
}

/**
 * The current dictation (spec 2026-11-06, Revision 2): the newest ISO week in
 * any lexicon entry's `dictation` tags, and its words — `dictationOrder[week]`
 * first, by that number, then the rest in lexicon order. `count` is reported
 * as is; the caller warns when it is not ten and serves the words anyway.
 * Pure: `null` when no entry carries a well-formed tag.
 */
export function currentDictation(lexicon) {
  const entries = lexicon?.entries;
  if (!entries || typeof entries.values !== 'function') return null;
  const tagged = [];
  let week = null;
  let index = 0;
  for (const entry of entries.values()) {
    const weeks = (Array.isArray(entry?.dictation) ? entry.dictation : []).map(normalizeDictationWeek).filter(Boolean);
    if (weeks.length) tagged.push({ id: entry.id, weeks, order: entry.dictationOrder, index });
    for (const w of weeks) if (week === null || w > week) week = w;
    index += 1;
  }
  if (week === null) return null;
  const rank = (row) => {
    const n = row.order && typeof row.order === 'object' ? row.order[week] : undefined;
    return Number.isFinite(n) ? n : Infinity;
  };
  const words = tagged.filter((row) => row.weeks.includes(week))
    .sort((a, b) => (rank(a) - rank(b)) || (a.index - b.index) || 0)
    .map((row) => row.id);
  return { week, words, count: words.length };
}
