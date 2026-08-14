/**
 * staleSaveGuard — shared concurrent-edit protection across assignment use cases.
 *
 * Used by: SetAssignments, EnrollLearner, UnenrollLearner
 *
 * Compares what a caller loaded (baseUpdatedAt) against the current record's
 * timestamp. If they disagree, a co-teacher has edited the record since this
 * caller fetched it, and we must refuse to clobber their work silently.
 *
 * The guard is optional: a caller that sends nothing keeps the legacy
 * last-write-wins behavior.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export function assertNotStale(current, baseUpdatedAt) {
  // Concurrent-edit guard (advocacy B14): a caller that says what it LOADED
  // is refused when someone else saved since — last-write-wins silently
  // losing a co-teacher's edit is the bug. Optional: a caller that sends
  // nothing keeps the legacy behavior.
  if (baseUpdatedAt !== undefined) {
    const currentAt = current?.updatedAt ?? null;
    if (currentAt !== baseUpdatedAt) {
      const err = new ValidationError('Assignments changed since you loaded them — reload and try again.');
      err.code = 'STALE_SAVE';
      // A stale-base write is a conflict with someone else's edit, not a
      // malformed request — 409, not this class's default 400 (the app
      // error handler maps an explicit err.status first).
      err.status = 409;
      throw err;
    }
  }
}

export default assertNotStale;
