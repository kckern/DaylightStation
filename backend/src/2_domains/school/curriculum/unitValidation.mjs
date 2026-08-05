/**
 * Pure validation + normalisation of a curriculum unit (spec §3.1). No I/O.
 *
 * A unit is the published, reviewed thing a learner can be handed: it names
 * what is learned, where it sits, who it applies to, what passing means, and
 * WHICH artefacts compose it. Every cross-reference resolves HERE, at publish
 * time, against sets injected by the caller — the domain never reads a
 * directory. Runtime therefore never discovers a dangling reference on a child
 * standing at the printer.
 */
import { GRADES } from '../grades.mjs';

/**
 * The nine subject shelves. Twin of `frontend/src/modules/School/home/subjects.js`
 * — a backend module cannot import frontend code, so the two lists are kept in
 * step by hand and must change together. That file documents why the list is
 * code and not config: a new shelf is a curriculum decision.
 */
export const SUBJECT_IDS = Object.freeze([
  'english', 'writing', 'math', 'history', 'scripture', 'science', 'language', 'skills', 'arts',
]);

// Dots separate a unit from its course chapter (math-3.4), so the unit id
// alphabet is the manifest/document alphabet plus '.'.
const UNIT_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;
const REVIEW_STATES = ['draft', 'approved'];
const DEFAULT_PASSING_PERCENT = 80;

/**
 * How often a program unit is handed out. `once` is a standard standalone
 * unit that happens to draw its content from a program instead of a
 * bank/document/media reference; `daily` is re-offered every study day (see
 * Task 3's planner). Only meaningful when `program` is present.
 */
export const CADENCES = Object.freeze(['daily', 'once']);

// Fields a program unit may never carry, alongside bank/document/media
// (checked separately since that trio has its own combined message). Each
// gets one clear, field-named error rather than a shared generic one.
const PROGRAM_EXCLUSIVE_FIELDS = ['passing', 'retry', 'review', 'reward', 'courseId', 'sequence'];

// A `launch:` unit's whole ask IS the dispatch (spec §6) — one-shot "go do
// this on that surface", with nothing else to compose. Each of these gets its
// own field-named error, mirroring `PROGRAM_EXCLUSIVE_FIELDS` above, rather
// than one combined message that hides which field an author needs to remove.
const LAUNCH_EXCLUSIVE_FIELDS = ['media', 'bank', 'document', 'review', 'program'];

// Resolvable reference kinds: field name → the injected set that must contain
// its value. `review` is deliberately absent — it is a free-form parent rubric
// for unscorable work, with no catalog to resolve against.
const RESOLVABLE_REFS = Object.freeze({
  bank: 'bankIds',
  document: 'documentIds',
  media: 'manifestIds',
});
const REFERENCE_FIELDS = [...Object.keys(RESOLVABLE_REFS), 'review'];

/**
 * `print/<id>@<rev>` — a `document` field pointing at a PUBLISHED print-
 * document artifact (spec §9, Task 7) instead of a legacy catalog document
 * id. `id` matches `documentValidation.mjs`'s own `ID_PATTERN`
 * (`^[a-z0-9][a-z0-9-]*$`); `rev` is exactly 9 lowercase hex characters —
 * `documentSource.mjs`'s `computeRev` output shape (first 9 hex chars of a
 * sha256 over the canonical source).
 *
 * SHAPE ONLY, DELIBERATELY NOT EXISTENCE (Task 7 review, Finding 1): this is
 * a pure domain function with no I/O (D1) — it has no repository to check a
 * `print/<id>@<rev>` ref actually resolves to a published artifact, the same
 * reason `review` above is exempt from resolution entirely. A dangling
 * print-document ref is caught at RUNTIME instead, exactly like a dangling
 * legacy `documentIds` reference already was in spirit (both are "should be
 * impossible once the catalog gate covers it, logged loudly if it happens
 * anyway") — `IssueDocument`'s `printDocuments.getPublished(...)` returning
 * null degrades to its existing `no-document` unavailable branch, never a
 * crash. Shape IS still enforced here, at the same publish-time gate every
 * other reference in this file goes through — a malformed ref (bad id
 * charset, non-hex or wrong-length rev) fails unit validation immediately,
 * the same as any other authoring mistake in this function.
 */
const PRINT_DOCUMENT_REF_PATTERN = /^print\/[a-z0-9][a-z0-9-]*@[0-9a-f]{9}$/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isPresent = (v) => v !== undefined && v !== null;

/**
 * @param {*} raw - one parsed unit YAML
 * @param {{bankIds?: Set<string>, documentIds?: Set<string>, manifestIds?: Set<string>,
 *          programIds?: Set<string>, surfaceValidators?: Map<string, Function>}} [sets]
 *   `surfaceValidators` maps a DoNow surface id to that surface's own
 *   `validateAction` — the same registered-adapter contract `DoNowService`
 *   dispatches through at runtime, reused here so a `launch:` unit cannot
 *   publish naming a surface that does not exist or a payload that surface
 *   would reject at dispatch time.
 * @returns {{ errors: string[], unit?: object }} empty errors === valid;
 *   `unit` is present only then.
 */
export function validateUnit(raw, sets = {}) {
  if (!isPlainObject(raw)) return { errors: ['unit must be a mapping'] };
  const errors = [];

  if (!isNonEmptyString(raw.unitId)) errors.push('unitId is required');
  else if (!UNIT_ID_PATTERN.test(raw.unitId)) errors.push(`unitId must match ${UNIT_ID_PATTERN.source}, got: ${raw.unitId}`);

  if (!isNonEmptyString(raw.title)) errors.push('title is required');

  if (!SUBJECT_IDS.includes(raw.subject)) {
    errors.push(`subject must be one of ${SUBJECT_IDS.join('|')}, got: ${raw.subject}`);
  }

  let objectives = [];
  if (isPresent(raw.objectives)) {
    if (!Array.isArray(raw.objectives) || !raw.objectives.every(isNonEmptyString)) {
      errors.push('objectives must be an array of non-empty strings');
    } else {
      objectives = raw.objectives;
    }
  }

  // Placement. A course member has a position; a standalone unit has none, and
  // a stray sequence means the courseId was lost in authoring — an error, not
  // a value to silently drop.
  let courseId;
  let sequence;
  if (isPresent(raw.courseId)) {
    if (!isNonEmptyString(raw.courseId)) errors.push('courseId must be a non-empty string');
    else courseId = raw.courseId;
    if (!isPresent(raw.sequence)) errors.push('sequence is required when courseId is present');
    else if (!Number.isInteger(raw.sequence) || raw.sequence < 1) errors.push('sequence must be an integer >= 1');
    else sequence = raw.sequence;
  } else if (isPresent(raw.sequence)) {
    errors.push('sequence is only meaningful inside a course (courseId is missing)');
  }

  let grades = [];
  if (isPresent(raw.grades)) {
    if (!Array.isArray(raw.grades)) {
      errors.push('grades must be an array');
    } else {
      const unknown = raw.grades.filter((g) => !GRADES.includes(g));
      unknown.forEach((g) => errors.push(`grades entries must be one of ${GRADES.join('|')}, got: ${g}`));
      if (!unknown.length) grades = raw.grades;
    }
  }

  const passing = validatePassing(raw.passing, errors);
  const reward = validateReward(raw.reward, errors);
  const retry = validateRetry(raw.retry, errors);

  const references = {};
  for (const [field, setName] of Object.entries(RESOLVABLE_REFS)) {
    if (!isPresent(raw[field])) continue;
    if (!isNonEmptyString(raw[field])) { errors.push(`${field} must be a non-empty string`); continue; }
    // `print/` is a reserved `document`-field prefix (spec §9, Task 7): once a
    // value claims that namespace it is ALWAYS validated as a print-document
    // ref — shape-checked here, never falling through to the legacy
    // `documentIds` set lookup below (even a `print/`-prefixed string that
    // happened to sit in that set would be the wrong kind of "found").
    if (field === 'document' && raw[field].startsWith('print/')) {
      if (PRINT_DOCUMENT_REF_PATTERN.test(raw[field])) references[field] = raw[field];
      else errors.push(`document '${raw[field]}' is not a valid print/<id>@<rev> reference`);
      continue;
    }
    const known = sets[setName];
    if (!(known instanceof Set) || !known.has(raw[field])) errors.push(`${field} '${raw[field]}' not found`);
    else references[field] = raw[field];
  }
  let review;
  if (isPresent(raw.review)) {
    if (!isNonEmptyString(raw.review) && !isPlainObject(raw.review)) {
      errors.push('review must be a non-empty string or an object');
    } else {
      review = raw.review;
    }
  }

  // The program unit kind: its content IS a whole program (spec Task 2), so it
  // is exclusive with every other composition kind and with the sequential/
  // scored machinery that assumes an authored artefact underneath it.
  let program;
  let cadence;
  if (isPresent(raw.program)) {
    if (!isNonEmptyString(raw.program)) {
      errors.push('program must be a non-empty string');
    } else {
      const knownPrograms = sets.programIds;
      if (!(knownPrograms instanceof Set) || !knownPrograms.has(raw.program)) {
        errors.push(`program '${raw.program}' not found`);
      } else {
        program = raw.program;
      }
    }

    if (isPresent(raw.bank) || isPresent(raw.document) || isPresent(raw.media)) {
      errors.push('program is exclusive — remove bank/document/media');
    }
    for (const field of PROGRAM_EXCLUSIVE_FIELDS) {
      if (isPresent(raw[field])) errors.push(`a program unit takes no ${field}`);
    }

    if (isPresent(raw.cadence)) {
      if (!CADENCES.includes(raw.cadence)) {
        errors.push(`cadence must be one of ${CADENCES.join('|')}, got: ${raw.cadence}`);
      } else {
        cadence = raw.cadence;
      }
    } else {
      cadence = 'once';
    }
  } else if (isPresent(raw.cadence)) {
    errors.push('cadence is only meaningful on a program unit');
  }

  // The launch composition kind (spec §6): a fire-and-forget dispatch to
  // another surface, e.g. `launch: { surface: garage-fitness, episode: plex:1 }`.
  // It is exclusive with every other composition kind AND with `program` —
  // daily "go do it" work is a program unit instead (see CADENCES above); a
  // `launch:` unit is the one-shot case.
  let launch;
  if (isPresent(raw.launch)) {
    if (!isPlainObject(raw.launch)) {
      errors.push('launch must be an object');
    } else {
      const { surface, ...payload } = raw.launch;
      if (!isNonEmptyString(surface)) {
        errors.push('launch.surface must be a non-empty string');
      } else {
        const validators = sets.surfaceValidators;
        const validateAction = validators instanceof Map ? validators.get(surface) : undefined;
        if (typeof validateAction !== 'function') {
          errors.push(`launch.surface '${surface}' not found`);
        } else {
          // The payload handed to the adapter is the launch block MINUS
          // `surface` — the same shape `DoNowService` will later dispatch
          // as the action (see `GarageFitnessSurface#validateAction`, which
          // reads e.g. `episodeId` off the top level, never a `surface` key
          // alongside it). Validating the wrapper instead would reject every
          // adapter's own contract.
          const actionErrors = validateAction(payload) ?? [];
          actionErrors.forEach((message) => errors.push(`launch: ${message}`));
          if (!actionErrors.length) launch = { surface, ...payload };
        }
      }
    }

    for (const field of LAUNCH_EXCLUSIVE_FIELDS) {
      if (isPresent(raw[field])) errors.push(`a launch unit takes no ${field}`);
    }
  }

  // Presence, not resolvability: a dangling reference is already reported, and
  // reporting it twice would read as two separate authoring mistakes.
  if (![...REFERENCE_FIELDS, 'program', 'launch'].some((field) => isPresent(raw[field]))) {
    errors.push('unit must reference at least one of bank, document, media, review');
  }

  if (!isPlainObject(raw.provenance)) {
    errors.push('provenance must be an object');
  } else {
    if (!isNonEmptyString(raw.provenance.source)) errors.push('provenance.source must be a non-empty string');
    if (!REVIEW_STATES.includes(raw.provenance.reviewState)) {
      errors.push(`provenance.reviewState must be ${REVIEW_STATES.join('|')}, got: ${raw.provenance.reviewState}`);
    }
  }

  if (errors.length) return { errors };
  return {
    errors,
    unit: {
      unitId: raw.unitId,
      title: raw.title,
      subject: raw.subject,
      objectives,
      courseId,
      sequence,
      grades,
      passing,
      reward,
      retry,
      bank: references.bank,
      document: references.document,
      media: references.media,
      review,
      program,
      cadence,
      launch,
      provenance: raw.provenance,
    },
  };
}

/**
 * The promotion boundary: the runtime catalog serves approved units only, so a
 * draft can sit in the tree being edited without ever reaching a learner.
 */
export function isPublishable(unit) {
  return isPlainObject(unit) && unit.provenance?.reviewState === 'approved';
}

function validatePassing(raw, errors) {
  if (!isPresent(raw)) return { percent: DEFAULT_PASSING_PERCENT };
  if (!isPlainObject(raw)) { errors.push('passing must be an object'); return undefined; }
  if (!Number.isInteger(raw.percent) || raw.percent < 1 || raw.percent > 100) {
    errors.push('passing.percent must be an integer between 1 and 100');
    return undefined;
  }
  return { percent: raw.percent };
}

function validateReward(raw, errors) {
  if (!isPresent(raw)) return undefined;
  if (!isPlainObject(raw)) { errors.push('reward must be an object'); return undefined; }
  if (!Number.isInteger(raw.amount) || raw.amount <= 0) errors.push('reward.amount must be an integer > 0');
  // Signoff is the exception, not the rule — most rewards settle on the grade
  // alone, so an omitted flag means no parent is in the loop.
  let requiresSignoff = false;
  if (isPresent(raw.requiresSignoff)) {
    if (typeof raw.requiresSignoff !== 'boolean') errors.push('reward.requiresSignoff must be a boolean');
    else requiresSignoff = raw.requiresSignoff;
  }
  return { amount: raw.amount, requiresSignoff };
}

function validateRetry(raw, errors) {
  if (!isPresent(raw)) return undefined;
  if (!isPlainObject(raw)) { errors.push('retry must be an object'); return undefined; }
  if (!Number.isInteger(raw.variants) || raw.variants < 1) {
    errors.push('retry.variants must be an integer >= 1');
    return undefined;
  }
  return { variants: raw.variants };
}
