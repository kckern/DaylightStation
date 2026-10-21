/**
 * What "Log a book" does for one child, decided from the SERVER's view of
 * that child and this ISBN (`GET /teacher/books/:isbn/readers`), never from
 * anything the console works out for itself.
 *
 * Two shapes of write, both existing per-child verbs:
 * - `new` — no open reading of this book: open one (`POST …/reading`). A
 *   finish sends no day; the server supplies the household's study day.
 * - `open` — the child is reading it now: today's evidence and/or the finish
 *   go ON that reading (`POST …/entries`, then `PATCH …/:readingId`). A second
 *   reading of a book a child is partway through would be a duplicate, not a
 *   re-read.
 * One no-op, `done`: a retry finds the finish it was about to send already
 * landed (its first response was lost).
 * And one refusal, `skip`, where the existing verbs cannot record what was
 * chosen without inventing a number (a page-less check-in on a page-mode
 * reading, anything but a finish on a minutes-mode one, partway with no page),
 * or where the reading an earlier try was aimed at has changed under it.
 */
export const HAPPENED = Object.freeze({ FINISHED: 'finished', STARTED: 'started', PARTWAY: 'partway' });

/** Why a child's save was refused before anything was sent. */
export const SKIP = Object.freeze({
  BY_PAGE: 'BY_PAGE', BY_MINUTES: 'BY_MINUTES', NEEDS_PAGE: 'NEEDS_PAGE', CHANGED: 'CHANGED',
});

/** One per child per book, minted on the first save: a retry carries the same one. */
export const mintLogKey = () => `teacher-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const SKIP_REASONS = Object.freeze({
  [SKIP.BY_PAGE]: 'Already reading this by page. Choose “Partway” and give the page.',
  [SKIP.BY_MINUTES]: 'Already reading this by minutes. Log it from the reading itself.',
  [SKIP.NEEDS_PAGE]: 'Give the page they reached.',
  [SKIP.CHANGED]: 'This reading changed — check it on their shelf.',
});
const skip = (code) => ({ kind: 'skip', code, reason: SKIP_REASONS[code] });

const FALLBACK_FAILURE = 'That didn’t save. Try again.';
const isPage = (page) => Number.isInteger(page) && page > 0;

/**
 * @param {object|null} reader - one row of the readers view
 * @param {{isbn: string, happened: string, page?: number|null, mode?: 'page'|'check', studyDay: string}} choice
 * @param {{previousReadingId?: string|null}} [retry] - on a retry, the reading
 *   an earlier `open` plan for this child was aimed at. If the fresh view no
 *   longer shows it open, the earlier try may have landed: this never re-plans
 *   to `new`, which would open a second, duplicate reading.
 */
export function planFor(reader, { isbn, happened, page = null, mode = 'check', studyDay }, { previousReadingId = null } = {}) {
  const open = reader?.openReading ?? null;

  if (previousReadingId && open?.id !== previousReadingId) {
    const finishedToday = Array.isArray(reader?.finishedTodayIds) && reader.finishedTodayIds.includes(previousReadingId);
    if (finishedToday && happened === HAPPENED.FINISHED) return { kind: 'done', readingId: previousReadingId };
    return skip(SKIP.CHANGED);
  }

  if (!open) {
    if (happened === HAPPENED.PARTWAY) {
      if (!isPage(page)) return skip(SKIP.NEEDS_PAGE);
      return { kind: 'new', body: { isbn, progressMode: 'page', where: 'partway', page } };
    }
    return {
      kind: 'new',
      body: { isbn, progressMode: mode, where: happened === HAPPENED.FINISHED ? 'finished' : 'starting' },
    };
  }

  const base = { kind: 'open', readingId: open.id, baseRevisionCount: open.revisionCount ?? 0 };
  const checkIn = open.progressMode === 'check' ? { on: studyDay } : null;

  if (happened === HAPPENED.FINISHED) {
    // The evidence first, then the decision — the order the server's own
    // finished door uses. A page-mode book of known length ends on its last
    // page; with no length (or in minutes) there is no honest number to send.
    const lastPage = open.progressMode === 'page' && isPage(open.pageCount)
      ? { on: studyDay, page: open.pageCount }
      : null;
    return { ...base, entry: checkIn ?? lastPage, finish: { status: 'finished', finishedOn: studyDay } };
  }
  if (happened === HAPPENED.PARTWAY && open.progressMode === 'page') {
    if (!isPage(page)) return skip(SKIP.NEEDS_PAGE);
    return { ...base, entry: { on: studyDay, page }, finish: null };
  }
  if (checkIn) return { ...base, entry: checkIn, finish: null };
  return skip(open.progressMode === 'page' ? SKIP.BY_PAGE : SKIP.BY_MINUTES);
}

/**
 * Carry out one child's plan. `progress` is that child's mutable record
 * (`{key, entryDone, plan}`): an entry that landed is not sent again, so a
 * retry after a failed finish sends only the finish. An entry whose response
 * was lost IS sent again, on the same key; the server replays it without a
 * second revision and serves the count the finish must carry.
 *
 * @returns {Promise<{ok: boolean, status: number, data?: unknown, skipped?: boolean, alreadyDone?: boolean, message?: string}>}
 */
export async function performPlan(api, { learnerId, progress, actorId }) {
  const { plan, key } = progress;
  if (plan.kind === 'skip') return { ok: false, status: 0, skipped: true, code: plan.code, message: plan.reason };
  if (plan.kind === 'done') return { ok: true, status: 200, data: null, alreadyDone: true };
  if (plan.kind === 'new') {
    return api.addReadingForLearner(learnerId, { ...plan.body, by: actorId }, key);
  }

  let base = plan.baseRevisionCount;
  if (plan.entry && !progress.entryDone) {
    const entry = await api.addReadingEntry(learnerId, plan.readingId, { ...plan.entry, baseRevisionCount: base }, `${key}:entry`);
    if (!entry.ok) return entry;
    progress.entryDone = true;
    // The server serves the reading's count after the entry (unchanged on a
    // replay). The +1 fallback is for a server that predates that field.
    const served = entry.data?.revisionCount;
    base = Number.isInteger(served) ? served : base + 1;
  }
  if (!plan.finish) return { ok: true, status: 201, data: null };
  return api.updateReading(learnerId, plan.readingId, { ...plan.finish, baseRevisionCount: base });
}

const sentence = (value) => (typeof value === 'string' && value.trim() ? value : null);

/** The sentence a face shows when its save did not land. Never blank. */
export function failureMessage(result) {
  const error = result?.data?.error;
  return sentence(result?.message)
    ?? sentence(error)
    ?? sentence(error?.message)
    ?? FALLBACK_FAILURE;
}
