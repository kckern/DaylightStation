/**
 * Media-lesson checkpoints — the pure arithmetic behind a HARD gate.
 *
 * A gated media unit pauses at authored positions and will not resume until
 * the learner answers. The frontend enforces that, but the frontend is not
 * TRUSTED to: a reload, a seek, or a hand-typed URL all reach the backend,
 * and the backend answers from these three functions. So they hold no clock,
 * no I/O and no session — just "which checkpoint is owed" and "how far may
 * this learner reach", both derived from an authored list plus a set of
 * cleared ids. That is what lets the same rules run at publish time, at
 * answer time, and at completion time without three subtly different gates.
 *
 * WHY THE ID IS DERIVED FROM `at`. `cp-<at>` is a pure function of the
 * authored position — no counter, no clock, no hash. A learner's cleared
 * checkpoints are stored durably by id, so an id that moved when the block
 * was re-parsed (an index, say, or a uuid) would silently un-clear work the
 * child already did: re-authoring the block to insert an earlier checkpoint
 * would renumber every later one and re-fire gates already passed. Deriving
 * from `at` means the id changes only when the position itself does, which is
 * the one case where re-asking IS correct — the gate now sits somewhere else.
 */

/**
 * A ceiling, on purpose — the same reasoning as `storyTime.mjs`'s
 * `MAX_STORY_TARGET`. The longest lesson media in the library runs about
 * three quarters of an hour, so twenty checkpoints is already one every two
 * minutes: past that the lesson is mostly interrogation. An author who typed
 * 400 of them onto a twenty-minute video made a mistake no learner can work
 * around — playback would stop every three seconds — and refusing it at
 * publish is far cheaper than a child sitting in front of an unwatchable
 * lesson with no error anywhere.
 */
export const MAX_CHECKPOINTS = 20;

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Validate + normalise an authored `checkpoints:` block.
 *
 * @param {*} raw - the authored array
 * @param {{bankItemIds?: Set<string>}} [opts] - `bankItemIds` is the injected
 *   set of item ids in the unit's bank. WHEN PRESENT every referenced item
 *   must exist in it; WHEN ABSENT only shape is checked. This follows the
 *   precedent documented at `PRINT_DOCUMENT_REF_PATTERN` in
 *   `curriculum/unitValidation.mjs`: a pure domain function has no repository
 *   to resolve against, so existence is checked at the one boundary that can
 *   inject the set — never by reaching for one from in here.
 * @returns {{errors: string[], checkpoints?: Array<{id: string, at: number, items: string[]}>}}
 *   Empty `errors` === valid; `checkpoints` is present only then, mirroring
 *   every other validator in this domain.
 */
export function validateCheckpoints(raw, { bankItemIds } = {}) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { errors: ['checkpoints must be a non-empty array'] };
  }
  if (raw.length > MAX_CHECKPOINTS) {
    return { errors: [`checkpoints must hold at most ${MAX_CHECKPOINTS} entries, got: ${raw.length}`] };
  }

  const errors = [];
  const checkpoints = [];
  let previous = null;

  raw.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      errors.push(`checkpoints[${index}] must be a mapping`);
      return;
    }

    // Integer seconds only. `at` is compared against a floating playhead, so a
    // fraction would still *work* — but the id is spelled from it, and YAML
    // will hand back `312.5` and `312.50` as the same number while a hand-
    // edited `312.50` is a different STRING to any store that kept the id
    // verbatim. Whole seconds keep `cp-<at>` unambiguous and human-checkable,
    // and sub-second precision is not something an author can aim at anyway.
    // `>= 1` because a checkpoint at 0 fires before playback has begun — the
    // learner would be quizzed on a lesson they have not seen a frame of.
    const hasValidAt = Number.isInteger(entry.at) && entry.at >= 1;
    if (!hasValidAt) errors.push(`checkpoints[${index}].at must be an integer >= 1 (seconds), got: ${entry.at}`);

    // Strictly ascending: the gate walks the list in order and stops at the
    // first uncleared entry, so an out-of-order block would leave later
    // checkpoints permanently unreachable. Naming BOTH indexes is the
    // difference between an author fixing it in one pass and hunting.
    if (hasValidAt && previous !== null && entry.at <= previous.at) {
      errors.push(
        `checkpoints[${index}].at (${entry.at}) must be greater than checkpoints[${previous.index}].at (${previous.at}) — checkpoints must be strictly ascending`,
      );
    }
    if (hasValidAt) previous = { index, at: entry.at };

    const items = entry.items;
    if (!Array.isArray(items) || items.length === 0 || !items.every(isNonEmptyString)) {
      errors.push(`checkpoints[${index}].items must be a non-empty array of item ids`);
      return;
    }
    if (bankItemIds instanceof Set) {
      items.filter((item) => !bankItemIds.has(item))
        .forEach((item) => errors.push(`checkpoints[${index}].items: '${item}' not found in bank`));
    }

    if (hasValidAt) checkpoints.push({ id: `cp-${entry.at}`, at: entry.at, items: [...items] });
  });

  if (errors.length) return { errors };
  return { errors, checkpoints };
}

/**
 * THE gate predicate: the first checkpoint the learner has reached and not yet
 * cleared, or `null` when nothing is owed.
 *
 * FIRST, not nearest — a learner who seeks to the end of a lesson still owes
 * every checkpoint on the way, in order, and gets them one at a time. The
 * comparison is INCLUSIVE (`at <= position`): a checkpoint authored at 312
 * fires at exactly 312.0, because a playhead that reports the boundary
 * exactly is a playhead that has played the second before it.
 */
export function dueCheckpoint(position, checkpoints, clearedIds) {
  if (!Array.isArray(checkpoints) || typeof position !== 'number' || !Number.isFinite(position)) return null;
  const cleared = clearedIds instanceof Set ? clearedIds : new Set();
  return checkpoints.find((cp) => cp.at <= position && !cleared.has(cp.id)) ?? null;
}

/**
 * How far this learner may seek: the `at` of the first uncleared checkpoint,
 * or `null` when every one is cleared.
 *
 * `null` means UNCLAMPED, and the distinction from `0` is load-bearing — a
 * ceiling of 0 would pin a finished learner to the first frame. Note this
 * ignores the play position entirely: the ceiling is where the learner may
 * reach, which is a property of the work owed, not of where they are now.
 */
export function seekCeilingFor(checkpoints, clearedIds) {
  if (!Array.isArray(checkpoints)) return null;
  const cleared = clearedIds instanceof Set ? clearedIds : new Set();
  return checkpoints.find((cp) => !cleared.has(cp.id))?.at ?? null;
}

/**
 * The reduced session's `clearedCheckpoints` rows (`{checkpointId, at,
 * attempts}`) as the id Set the two functions above take. Tolerant by design:
 * this reads a durable event stream, and a malformed row must degrade to "not
 * cleared" — i.e. ask the question again — rather than throw on a learner
 * mid-lesson. Erring toward re-asking is the safe direction for a gate.
 */
export function clearedSetFrom(rows) {
  if (!Array.isArray(rows)) return new Set();
  return new Set(rows.filter(isPlainObject).map((row) => row.checkpointId).filter(isNonEmptyString));
}
