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
 * And one refusal, `skip`, where the existing verbs cannot record what was
 * chosen without inventing a number (a page-less check-in on a page-mode
 * reading, anything but a finish on a minutes-mode one).
 */
export const HAPPENED = Object.freeze({ FINISHED: 'finished', STARTED: 'started', PARTWAY: 'partway' });

/** One per child per book, minted on the first save: a retry carries the same one. */
export const mintLogKey = () => `teacher-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const SKIP_PAGE = 'Already reading this by page. Choose “Partway” and give the page.';
const SKIP_MINUTES = 'Already reading this by minutes. Log it from the reading itself.';

/**
 * @param {object|null} reader - one row of the readers view
 * @param {{isbn: string, happened: string, page?: number|null, mode?: 'page'|'check', studyDay: string}} choice
 */
export function planFor(reader, { isbn, happened, page = null, mode = 'check', studyDay }) {
  const open = reader?.openReading ?? null;
  if (!open) {
    if (happened === HAPPENED.PARTWAY) {
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
    const lastPage = open.progressMode === 'page' && Number.isInteger(open.pageCount) && open.pageCount > 0
      ? { on: studyDay, page: open.pageCount }
      : null;
    return { ...base, entry: checkIn ?? lastPage, finish: { status: 'finished', finishedOn: studyDay } };
  }
  if (happened === HAPPENED.PARTWAY && open.progressMode === 'page') {
    return { ...base, entry: { on: studyDay, page }, finish: null };
  }
  if (checkIn) return { ...base, entry: checkIn, finish: null };
  return { kind: 'skip', reason: open.progressMode === 'page' ? SKIP_PAGE : SKIP_MINUTES };
}

/**
 * Carry out one child's plan. `progress` is that child's mutable record
 * (`{key, entryDone, plan}`): an entry that landed is not sent again, so a
 * retry after a failed finish sends only the finish.
 *
 * @returns {Promise<{ok: boolean, status: number, data?: unknown, skipped?: boolean, message?: string}>}
 */
export async function performPlan(api, { learnerId, progress, actorId }) {
  const { plan, key } = progress;
  if (plan.kind === 'skip') return { ok: false, status: 0, skipped: true, message: plan.reason };
  if (plan.kind === 'new') {
    return api.addReadingForLearner(learnerId, { ...plan.body, by: actorId }, key);
  }

  let base = plan.baseRevisionCount;
  if (plan.entry && !progress.entryDone) {
    const entry = await api.addReadingEntry(learnerId, plan.readingId, { ...plan.entry, baseRevisionCount: base }, `${key}:entry`);
    if (!entry.ok) return entry;
    progress.entryDone = true;
    // An added day appends exactly one revision to the reading.
    base += 1;
  }
  if (!plan.finish) return { ok: true, status: 201, data: null };
  return api.updateReading(learnerId, plan.readingId, { ...plan.finish, baseRevisionCount: base });
}

/** The sentence a face shows when its save did not land. */
export function failureMessage(result) {
  if (result?.message) return result.message;
  const error = result?.data?.error;
  if (typeof error === 'string') return error;
  return error?.message ?? 'That didn’t save. Try again.';
}
