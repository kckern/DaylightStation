/**
 * The reading detail's decisions, with no React in them.
 *
 * Three questions the console has to answer BEFORE it draws a control, and
 * every one of them is a rule the server also holds — which is exactly why
 * they live in one readable file rather than inline in the JSX:
 *
 * 1. **Does this verb make the child's record smaller?** Five do, and those
 *    five require a reason that is delivered to the child (design §3). The
 *    form must not let them submit without one, and it must say WHY it is
 *    asking, because the sentence typed there is the sentence the child reads.
 * 2. **Can this revision be undone?** Three cannot, and the server refuses
 *    them by name (`UndoReadingRevision`). The console renders the sentence in
 *    place of the button rather than offering a control that will fail.
 * 3. **Would undoing it shrink the record?** An undo inherits the reason
 *    requirement of the verb its inverse turns out to be — undoing an ADDED
 *    day deletes a day, and the child hears about that.
 *
 * The wordings below are the server's own, deliberately. A different sentence
 * for the same refusal would mean the grown-up reads one thing before tapping
 * and another after, and only one of them is true.
 *
 * @module School/teacher/panels/readingDetail
 */

/** The three states the console offers. `unread` is a store value, not a verb. */
export const STATUSES = Object.freeze([
  { value: 'reading', label: 'Reading' },
  { value: 'finished', label: 'Finished' },
  { value: 'set-aside', label: 'Set aside' },
]);

/** The three ways a reading measures itself. */
export const MODES = Object.freeze([
  { value: 'page', label: 'page' },
  { value: 'minutes', label: 'minutes' },
  { value: 'check', label: 'check-in' },
]);

/** Revision ops, as `readingEdits.mjs` writes them. */
export const OPS = Object.freeze({
  READING_UPDATE: 'reading.update',
  READING_ADD: 'reading.add',
  READING_DELETE: 'reading.delete',
  READING_MOVE: 'reading.move',
  ENTRY_ADD: 'reading.entry.add',
  ENTRY_UPDATE: 'reading.entry.update',
  ENTRY_DELETE: 'reading.entry.delete',
});

export const UNDO_VERB = 'reading.undo';

/** Move a `YYYY-MM-DD` day by whole days, noon-anchored so DST cannot eat one. */
function shift(day, delta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ''))) return null;
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The window the obligation counts over — the mirror of
 * `BookLogProgramLauncher.obligationWindow`, so the console asks for a reason
 * on exactly the re-dates the server would ask for one on.
 *
 * A shelf with no obligation has no counted window, and therefore no day a
 * correction can drop out of. `null` means "cannot tell" and the console then
 * lets the server be the one to refuse — which it does, by name.
 */
export function countedWindow(obligation, studyDay) {
  const per = obligation?.per ?? null;
  if (!per || !studyDay) return null;
  if (per === 'once') return { from: null, to: studyDay };
  if (per === 'week') return { from: shift(studyDay, -6), to: studyDay };
  if (per === 'month') return { from: shift(studyDay, -29), to: studyDay };
  return { from: studyDay, to: studyDay };
}

export const inWindow = (day, window) => {
  if (!window) return true;
  if (!day) return false;
  return (!window.from || day >= window.from) && (!window.to || day <= window.to);
};

/** Did a re-date carry the day out of the window the obligation counts? */
export const leavesWindow = (window, before, after) => Boolean(window)
  && inWindow(before, window) && !inWindow(after, window);

/**
 * The sentence under a required reason box. It says what the grown-up is
 * about to take away and who will read what they type, because a box labelled
 * only "Reason" gets "fixed" typed into it and a child then reads "fixed".
 */
export function reasonAsk(action, { book = 'this book', child = 'the child', to = null } = {}) {
  switch (action) {
    case 'entry.delete':
      return `Removing a reading day from ${book} makes ${child}’s record smaller. Say why — what you write is sent to them.`;
    case 'unfinish':
      return `${book} will stop counting as finished. Say why — what you write is sent to ${child}.`;
    case 'entry.redate':
      return `Moving that day out of the counted window takes it off ${child}’s total. Say why — what you write is sent to them.`;
    case 'move':
      return `${book} will leave ${child}’s shelf${to ? ` for ${to}’s` : ''}. Say why — what you write is sent to both children.`;
    case 'reading.delete':
      return `${book} and everything logged against it will be destroyed. Say why — what you write is sent to ${child}.`;
    default:
      return null;
  }
}

/** A reason that is only ever a note to the next grown-up who reads history. */
export const OPTIONAL_ASK = 'Reason (optional) — kept in this reading’s history.';

/** Does un-finishing happen here? The one shrinking state change (design §3). */
export const unfinishes = (reading, patch) => reading?.status === 'finished'
  && patch?.status !== undefined && patch.status !== 'finished';

/**
 * Why this revision cannot be undone, or null if it can.
 *
 * The three the server refuses by name. Rendered in place of the Undo button:
 * a control that is going to 400 is worse than no control, because the grown-up
 * has already decided by the time they read the sentence.
 */
export function undoRefusal(reading, revision, { book = 'This book' } = {}) {
  if (!revision) return null;
  const revisions = Array.isArray(reading?.revisions) ? reading.revisions : [];
  if (revisions.some((row) => row?.undoes === revision.id)) {
    return 'That change has already been undone — undo the undo instead.';
  }
  if (revision.op === OPS.READING_ADD) {
    return 'Undoing the opening of a reading would destroy it and its whole history. Delete the reading instead, which says what it is.';
  }
  if (revision.op === OPS.READING_MOVE) {
    const since = (reading?.entries ?? [])
      .filter((entry) => String(entry?.at ?? '') > String(revision.at ?? '')).length;
    if (since > 0) {
      return `${book} has been read since it moved — undoing would delete that reading. Move it back instead, which keeps the days.`;
    }
  }
  return null;
}

/**
 * Would undoing this revision make the child's record smaller?
 *
 * Decided from the SHAPE of the inverse, exactly as `applyReadingOperation`
 * decides it — which is why undoing an undo asks the same question again and
 * gets the opposite answer.
 */
export function undoShrinks(reading, revision, window = null) {
  if (!revision) return false;
  switch (revision.op) {
    // The inverse of adding a day is deleting one.
    case OPS.ENTRY_ADD:
      return true;
    // Either direction of a move takes the book off somebody's shelf.
    case OPS.READING_MOVE:
      return true;
    case OPS.READING_UPDATE:
      return unfinishes(reading, revision.before ?? {});
    case OPS.ENTRY_UPDATE: {
      const before = revision.before ?? {};
      if (before.on === undefined) return false;
      const entryId = before.id ?? revision.after?.id ?? null;
      const row = (reading?.entries ?? []).find((entry) => entry?.id === entryId);
      return leavesWindow(window, row?.on ?? null, before.on);
    }
    default:
      return false;
  }
}

const VERB_PHRASE = Object.freeze({
  [OPS.READING_UPDATE]: 'corrected the book',
  [OPS.READING_ADD]: 'opened this reading',
  [OPS.READING_DELETE]: 'deleted this reading',
  [OPS.READING_MOVE]: 'moved it to another child',
  [OPS.ENTRY_ADD]: 'added a day they read',
  [OPS.ENTRY_UPDATE]: 'corrected a day',
  [OPS.ENTRY_DELETE]: 'removed a day',
  [UNDO_VERB]: 'took a change back',
});

/** What one history row says happened, in a grown-up's words. */
export function revisionPhrase(revision) {
  if (!revision) return 'changed this reading';
  if (revision.verb === UNDO_VERB) {
    const undone = VERB_PHRASE[revision.undoneVerb];
    return undone ? `took back: ${undone}` : 'took a change back';
  }
  return VERB_PHRASE[revision.verb] ?? VERB_PHRASE[revision.op] ?? 'changed this reading';
}

/** Only the fields a grown-up can read. `before` on a delete is a whole record. */
const FIELD_LABEL = Object.freeze({
  isbn: 'ISBN', pageCount: 'page count', progressMode: 'mode', status: 'state',
  finishedOn: 'finish day', on: 'day', page: 'page', minutes: 'minutes',
  note: 'note', learnerId: 'whose shelf',
});

const show = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
};

/** `finish day  Sep 5 → Sep 2` — one line per field that actually moved. */
export function revisionChanges(revision) {
  const before = revision?.before ?? null;
  const after = revision?.after ?? null;
  const changes = [];
  for (const field of Object.keys(FIELD_LABEL)) {
    const from = show(before?.[field]);
    const to = show(after?.[field]);
    const present = (before && field in before) || (after && field in after);
    if (!present || from === to) continue;
    changes.push({ field: FIELD_LABEL[field], from, to });
  }
  return changes;
}
