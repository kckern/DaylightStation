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
import { validateCheckpoints } from '../mediaCheckpoints.mjs';

/**
 * The nine subject shelves. Twin of `frontend/src/modules/School/home/subjects.js`
 * — a backend module cannot import frontend code, so the two lists are kept in
 * step by hand and must change together. That file documents why the list is
 * code and not config: a new shelf is a curriculum decision.
 */
export const SUBJECT_IDS = Object.freeze([
  'english', 'writing', 'math', 'civilization', 'scripture', 'science', 'language', 'skills', 'arts',
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
const ACTIVITY_EXCLUSIVE_FIELDS = ['media', 'bank', 'document', 'review', 'program', 'launch'];

// Resolvable reference kinds: field name → the injected set that must contain
// its value. `review` is deliberately absent — it is a free-form parent rubric
// for unscorable work, with no catalog to resolve against.
const RESOLVABLE_REFS = Object.freeze({
  bank: 'bankIds',
  document: 'documentIds',
  media: 'manifestIds',
});
const REFERENCE_FIELDS = [...Object.keys(RESOLVABLE_REFS), 'review'];
const SCHOOLCALC_MODE = 'adaptive_flashcards';

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
export const PRINT_DOCUMENT_REF_PATTERN = /^print\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,3}@[0-9a-f]{9}$/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isPresent = (v) => v !== undefined && v !== null;
const READALONG_PARTICIPATION = Object.freeze(['optional', 'required']);

/**
 * `companion.requireParts`: how many playlist parts must be finished before the
 * finish code is released. A positive integer, or the string `'all'`.
 *
 * `'all'` is a WORD and not a number on purpose. A playlist's length is not
 * known when the unit is authored — it is resolved from `provenance.reading` at
 * print time — so writing `4` to mean "all of them" silently becomes "the first
 * four" the week the reading gains a fifth chapter.
 */
const isRequireParts = (v) => v === 'all' || (typeof v === 'number' && Number.isInteger(v) && v >= 1);

/**
 * @param {*} raw - one parsed unit YAML
 * @param {{bankIds?: Set<string>, documentIds?: Set<string>, manifestIds?: Set<string>,
 *          programIds?: Set<string>, bankItems?: Map<string, Set<string>>,
 *          surfaceValidators?: Map<string, Function>,
 *          activityValidators?: Map<string, Function>}} [sets]
 *   `bankItems` maps a bank id to that bank's item ids, and exists so a
 *   `checkpoints:` block cannot publish naming a question the bank does not
 *   contain. Like every other set here it is INJECTED — omitting it validates
 *   checkpoint shape only (the `PRINT_DOCUMENT_REF_PATTERN` precedent: this
 *   function has no repository of its own).
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

  // Optional schema discriminator (admin advocacy #18): absent = v1.
  if (raw.schema !== undefined && raw.schema !== 'school.unit/v1') {
    errors.push(`schema must be school.unit/v1 when present, got: ${raw.schema}`);
  }

  if (!isNonEmptyString(raw.unitId)) errors.push('unitId is required');
  else if (!UNIT_ID_PATTERN.test(raw.unitId)) errors.push(`unitId must match ${UNIT_ID_PATTERN.source}, got: ${raw.unitId}`);

  if (!isNonEmptyString(raw.title)) errors.push('title is required');

  let description;
  if (isPresent(raw.description)) {
    if (!isNonEmptyString(raw.description)) errors.push('description must be a non-empty string when present');
    else description = raw.description;
  }

  // These values can be printed verbatim on a learner's worksheet card.
  // Digital extraction sidecars remain provenance only; they are never an
  // instruction for a child who has the physical book in front of them.
  let reading;
  if (isPresent(raw.reading)) {
    if (!isNonEmptyString(raw.reading)) errors.push('reading must be a non-empty string when present');
    else if (/\bassigned section\b/iu.test(raw.reading)) errors.push('reading must name a real section or page, not "assigned section"');
    else if (/\b(?:EPUB|MOBI|HTML)\b|\.(?:epub|mobi|html?)\b/iu.test(raw.reading)) errors.push('reading must not reference a digital sidecar');
    else reading = raw.reading.trim();
  }
  let sourceTitle;
  if (isPresent(raw.sourceTitle)) {
    if (!isNonEmptyString(raw.sourceTitle)) errors.push('sourceTitle must be a non-empty string when present');
    else if (/\b(?:EPUB|MOBI|HTML)\b|\.(?:epub|mobi|html?)\b/iu.test(raw.sourceTitle)) errors.push('sourceTitle must not reference a digital sidecar');
    else sourceTitle = raw.sourceTitle.trim();
  }

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
  let module;
  let moduleRole;
  if (isPresent(raw.courseId)) {
    if (!isNonEmptyString(raw.courseId)) errors.push('courseId must be a non-empty string');
    else courseId = raw.courseId;
    if (!isPresent(raw.sequence)) errors.push('sequence is required when courseId is present');
    else if (!Number.isInteger(raw.sequence) || raw.sequence < 1) errors.push('sequence must be an integer >= 1');
    else sequence = raw.sequence;
  } else if (isPresent(raw.sequence)) {
    errors.push('sequence is only meaningful inside a course (courseId is missing)');
  }
  if (isPresent(raw.module)) {
    if (!courseId) errors.push('module is only meaningful inside a course');
    else if (!isNonEmptyString(raw.module)) errors.push('module must be a non-empty string');
    else module = raw.module;
  }
  if (isPresent(raw.moduleRole)) {
    if (!module) errors.push('moduleRole requires module');
    else if (!['overview', 'lesson', 'optional'].includes(raw.moduleRole)) {
      errors.push('moduleRole must be overview|lesson|optional');
    } else moduleRole = raw.moduleRole;
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
  const schoolcalc = validateSchoolCalc(raw.schoolcalc, raw, errors);
  let companion;
  if (isPresent(raw.companion)) {
    if (!isPlainObject(raw.companion)) {
      errors.push('companion must be an object');
    } else {
      const participation = raw.companion.participation ?? 'optional';
      if (!READALONG_PARTICIPATION.includes(participation)) {
        errors.push(`companion.participation must be ${READALONG_PARTICIPATION.join('|')}`);
      } else {
        if (raw.companion.handler != null && !isNonEmptyString(raw.companion.handler)) {
          errors.push('companion.handler must be a non-empty string when present');
        } else if (raw.companion.label != null && !isNonEmptyString(raw.companion.label)) {
          errors.push('companion.label must be a non-empty string when present');
        } else if (raw.companion.payload != null && !isPlainObject(raw.companion.payload)) {
          errors.push('companion.payload must be an object when present');
        } else if (raw.companion.require_parts != null) {
          // REFUSED, not aliased. Every other authored key on a unit is
          // camelCase (`courseId`, `moduleRole`, `requiresSignoff`), so the
          // snake_case spelling is the one an author reaches for from the
          // requirements prose — and accepting it silently would give the field
          // two names, while ignoring it silently would gate the whole lesson on
          // every chapter when the author asked for one. Name the right key.
          errors.push('companion.require_parts is not a field; use companion.requireParts');
        } else if (raw.companion.requireParts != null && !isRequireParts(raw.companion.requireParts)) {
          errors.push("companion.requireParts must be a positive integer or 'all'");
        } else {
          companion = {
            enabled: raw.companion.enabled !== false, participation,
            ...(raw.companion.handler ? { handler: raw.companion.handler.trim() } : {}),
            ...(raw.companion.label ? { label: raw.companion.label.trim() } : {}),
            ...(raw.companion.payload ? { payload: structuredClone(raw.companion.payload) } : {}),
            // HOW MANY CHAPTERS ACTUALLY GATE. A week's read-along is often
            // several chapters (Psalms 70–72; 77 is four) and typically only ONE
            // has to be finished — the rest are enrichment. Carried through
            // normalised as authored: `'all'` cannot be resolved to a number
            // here, because the playlist that would give it one is resolved at
            // print time from `provenance.reading`, not on the unit.
            ...(raw.companion.requireParts != null ? { requireParts: raw.companion.requireParts } : {}),
          };
        }
      }
    }
  }

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

  // A gated media lesson: `checkpoints` names the positions at which playback
  // stops to ask comprehension questions (see `mediaCheckpoints.mjs`). It is
  // not a composition kind of its own — it MODIFIES the media+bank pair, so it
  // is meaningless without both: the media is what pauses, the bank is where
  // the questions live. Two separate field-named errors rather than one
  // combined message, matching `PROGRAM_EXCLUSIVE_FIELDS` below — an author
  // who forgot both should be told both, in one pass.
  let checkpoints;
  if (isPresent(raw.checkpoints)) {
    // Presence, not resolvability: a dangling media/bank reference is already
    // reported by the loop above, and repeating it here would read as a second,
    // separate authoring mistake.
    if (!isPresent(raw.media)) errors.push('checkpoints requires media');
    if (!isPresent(raw.bank)) errors.push('checkpoints requires bank');
    // Undefined when no `bankItems` was injected — and equally when the map
    // simply has no entry for this bank. Both degrade to shape-only, which is
    // the honest answer: an absent corpus is not evidence that every item is
    // missing, and failing them all would be a confident wrong error.
    const bankItemIds = sets.bankItems instanceof Map ? sets.bankItems.get(raw.bank) : undefined;
    const result = validateCheckpoints(raw.checkpoints, { bankItemIds });
    result.errors.forEach((message) => errors.push(`checkpoints: ${message}`));
    checkpoints = result.checkpoints;
  }

  // The program unit kind: its content IS a whole program (spec Task 2), so it
  // is exclusive with every other composition kind and with the sequential/
  // scored machinery that assumes an authored artefact underneath it.
  let program;
  let programInstance;
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
    if (isPresent(raw.programInstance)) {
      if (!isNonEmptyString(raw.programInstance)) errors.push('programInstance must be a non-empty string');
      else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(raw.programInstance.trim())) {
        errors.push(`programInstance must match /^[a-z0-9][a-z0-9_-]*$/, got: ${raw.programInstance}`);
      } else {
        programInstance = raw.programInstance.trim();
      }
    }
  } else {
    if (isPresent(raw.programInstance)) errors.push('programInstance is only meaningful on a program unit');
    if (isPresent(raw.cadence)) errors.push('cadence is only meaningful on a program unit');
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

  // Evidence-backed work performed in another bounded context. Unlike a
  // `launch:` composition, dispatch is only the beginning: the provider must
  // later return a durable assessment before School records an outcome.
  let activity;
  if (isPresent(raw.activity)) {
    if (!isPlainObject(raw.activity)) {
      errors.push('activity must be an object');
    } else if (!isNonEmptyString(raw.activity.provider)) {
      errors.push('activity.provider must be a non-empty string');
    } else {
      const validator = sets.activityValidators instanceof Map
        ? sets.activityValidators.get(raw.activity.provider)
        : null;
      if (typeof validator !== 'function') {
        errors.push(`activity.provider '${raw.activity.provider}' not found`);
      } else {
        const activityErrors = validator(raw.activity) ?? [];
        activityErrors.forEach((message) => errors.push(`activity: ${message}`));
        if (!activityErrors.length) activity = structuredClone(raw.activity);
      }
    }
    for (const field of ACTIVITY_EXCLUSIVE_FIELDS) {
      if (isPresent(raw[field])) errors.push(`an activity unit takes no ${field}`);
    }
  }

  // Presence, not resolvability: a dangling reference is already reported, and
  // reporting it twice would read as two separate authoring mistakes.
  if (![...REFERENCE_FIELDS, 'program', 'launch', 'activity'].some((field) => isPresent(raw[field]))) {
    errors.push('unit must reference at least one of bank, document, media, review, program, launch, activity');
  }

  if (!isPlainObject(raw.provenance)) {
    errors.push('provenance must be an object');
  } else {
    // A lesson may cite one source (`source`) or a deliberate companion set
    // (`sources`).  Both forms exist in compact course packages; accepting
    // the latter avoids forcing authors to discard the actual bibliography
    // merely to satisfy a singular legacy field.
    const hasSingularSource = isNonEmptyString(raw.provenance.source);
    const hasSourceList = Array.isArray(raw.provenance.sources)
      && raw.provenance.sources.length > 0
      && raw.provenance.sources.every(isNonEmptyString);
    if (!hasSingularSource && !hasSourceList) {
      errors.push('provenance.source must be a non-empty string (or provenance.sources a non-empty string list)');
    }
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
      description,
      ...(reading ? { reading } : {}),
      ...(sourceTitle ? { sourceTitle } : {}),
      subject: raw.subject,
      objectives,
      courseId,
      sequence,
      module,
      moduleRole,
      grades,
      passing,
      reward,
      retry,
      bank: references.bank,
      document: references.document,
      media: references.media,
      review,
      program,
      programInstance,
      cadence,
      launch,
      activity,
      ...(checkpoints ? { checkpoints } : {}),
      ...(schoolcalc ? { schoolcalc } : {}),
      ...(companion ? { companion } : {}),
      provenance: raw.provenance,
    },
  };
}

/**
 * Explicit calculator opt-in. This is intentionally pure and limited to the
 * authored policy shape; bank contents and encoded TI-86 byte ceilings are
 * validated later by the application/adapter once the referenced bank is
 * available. Returning a fresh object prevents planner consumers from
 * retaining a mutable authoring object.
 */
function validateSchoolCalc(raw, unit, errors) {
  if (!isPresent(raw)) return undefined;
  if (!isPlainObject(raw)) {
    errors.push('schoolcalc must be an object');
    return undefined;
  }
  if (raw.mode !== SCHOOLCALC_MODE) {
    errors.push(`schoolcalc.mode must be ${SCHOOLCALC_MODE}`);
  }
  if (!isPresent(unit.bank)) {
    errors.push('schoolcalc requires a bank-backed unit');
  }
  if (!isPlainObject(raw.study)) {
    errors.push('schoolcalc.study must be an object');
  }
  if (!isPlainObject(raw.quiz)) {
    errors.push('schoolcalc.quiz must be an object');
  }
  const cardCount = raw.study?.cardCount;
  const maxExposuresPerCard = raw.study?.maxExposuresPerCard;
  const itemCount = raw.quiz?.itemCount;
  if (!Number.isInteger(cardCount) || cardCount < 1 || cardCount > 12) {
    errors.push('schoolcalc.study.cardCount must be an integer between 1 and 12');
  }
  if (!Number.isInteger(maxExposuresPerCard)
      || maxExposuresPerCard < 1 || maxExposuresPerCard > 4) {
    errors.push('schoolcalc.study.maxExposuresPerCard must be an integer between 1 and 4');
  }
  if (!Number.isInteger(itemCount) || itemCount < 1) {
    errors.push('schoolcalc.quiz.itemCount must be an integer >= 1');
  } else if (Number.isInteger(cardCount) && itemCount > cardCount) {
    errors.push('schoolcalc.quiz.itemCount must not exceed schoolcalc.study.cardCount');
  }
  if (errors.length > 0) return undefined;
  return {
    mode: SCHOOLCALC_MODE,
    study: { cardCount, maxExposuresPerCard },
    quiz: { itemCount },
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
