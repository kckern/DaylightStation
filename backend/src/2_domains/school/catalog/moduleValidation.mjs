import { parseCapabilityId } from './capabilities.mjs';
import { validateAdaptiveRemediationPolicy } from '../remediation/adaptiveRemediation.mjs';
import { normalizeSchoolContinuationModuleCode } from '../continuationCode.mjs';

/**
 * Standard School learning modules. These are pedagogical interactions,
 * not subjects: the same notes/problem/quiz engines can serve any course.
 * Specialized interactions enter through `custom` and a named capability.
 */
export const LEARNING_MODULE_TYPES = Object.freeze([
  'lecture_notes',
  'examples',
  'problems',
  'flashcards',
  'quiz',
  'learning_probe',
  'activity',
  'tool',
  'custom',
]);

export const CORE_ACTIVITY_MECHANICS = Object.freeze([
  'matching',
  'sorting',
  'sequencing',
  'timed_drill',
  'memory',
]);

export const LEARNING_PROBE_PHASES = Object.freeze([
  'activate', 'develop', 'check', 'retrieve', 'reflect',
]);

export const LEARNING_PROBE_INCORRECT_ACTIONS = Object.freeze([
  'explain_then_continue', 'explain_then_retry',
]);

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// References point at separately published content. Unlike local tree IDs,
// their namespaces may contain `:`, `.`, or `/` (for example a bank supplied
// by a generated-content adapter), but they still may not contain whitespace.
const REFERENCE_ID = /^[a-z0-9][a-z0-9:._/-]{0,127}$/;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Validate one canonical module. Content references are checked for shape here;
 * an application use case resolves them against repositories at publication.
 */
export function validateLearningModule(raw, { path = 'module' } = {}) {
  const errors = [];
  const push = (message) => errors.push(`${path}: ${message}`);
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  if (!ID.test(raw.moduleId || '')) push('moduleId must be a lowercase identifier');
  if (!LEARNING_MODULE_TYPES.includes(raw.type)) {
    push(`type must be one of ${LEARNING_MODULE_TYPES.join('|')}`);
    return { errors };
  }
  if (raw.title !== undefined && !isText(raw.title)) push('title must be non-empty when present');
  if (raw.continuationCode !== undefined) {
    try { normalizeSchoolContinuationModuleCode(raw.continuationCode); } catch (error) { push(error.message); }
  }
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((value) => !isText(value))
      || new Set(raw.tags).size !== raw.tags.length)) {
    push('tags must be unique non-empty strings when present');
  }
  for (const field of ['areaIds', 'classifications']) {
    if (raw[field] !== undefined && (!Array.isArray(raw[field])
        || raw[field].some((value) => typeof value !== 'string' || !ID.test(value))
        || new Set(raw[field]).size !== raw[field].length)) {
      push(`${field} must be unique lowercase identifiers when present`);
    }
  }

  if (raw.type === 'lecture_notes') {
    if (!REFERENCE_ID.test(raw.documentId || '')) push('documentId must be a lowercase content reference');
  } else if (raw.type === 'examples') {
    if (!Array.isArray(raw.examples) || raw.examples.length === 0) {
      push('examples must be a non-empty array');
    } else {
      const ids = new Set();
      raw.examples.forEach((example, index) => {
        const at = `${path}.examples[${index}]`;
        if (!isObject(example)) { errors.push(`${at}: must be a mapping`); return; }
        if (!ID.test(example.exampleId || '')) errors.push(`${at}: exampleId must be a lowercase identifier`);
        else if (ids.has(example.exampleId)) errors.push(`${at}: duplicate exampleId '${example.exampleId}'`);
        else ids.add(example.exampleId);
        if (!isText(example.prompt)) errors.push(`${at}: prompt is required`);
        if (!Array.isArray(example.steps) || example.steps.length === 0 || !example.steps.every(isText)) errors.push(`${at}: steps must be non-empty strings`);
      });
    }
  } else if (raw.type === 'problems') {
    if (!REFERENCE_ID.test(raw.bankId || '')) push('bankId must be a lowercase content reference');
    if (raw.mode !== 'practice' && raw.mode !== 'drill') push('mode must be practice|drill');
  } else if (raw.type === 'flashcards') {
    if (!REFERENCE_ID.test(raw.deckId || '') && !REFERENCE_ID.test(raw.bankId || '')) {
      push('deckId or bankId must be a lowercase content reference');
    }
    if (REFERENCE_ID.test(raw.deckId || '') && raw.bankId !== undefined) {
      push('rich flashcard modules declare Test assessment on the deck, not module.bankId');
    }
  } else if (raw.type === 'quiz') {
    if (!REFERENCE_ID.test(raw.bankId || '')) push('bankId must be a lowercase content reference');
    if (raw.passingPercent !== undefined && (!Number.isInteger(raw.passingPercent) || raw.passingPercent < 1 || raw.passingPercent > 100)) {
      push('passingPercent must be an integer from 1–100');
    }
  } else if (raw.type === 'learning_probe') {
    validateLearningProbe(raw, path, errors);
  } else if (raw.type === 'activity') {
    if (!CORE_ACTIVITY_MECHANICS.includes(raw.mechanic)) {
      push(`mechanic must be one of ${CORE_ACTIVITY_MECHANICS.join('|')}`);
    }
    if (!isObject(raw.config)) push('config must be a mapping');
    else if (CORE_ACTIVITY_MECHANICS.includes(raw.mechanic)) {
      validateActivityConfig(raw.mechanic, raw.config, `${path}.config`, errors);
    }
  } else if (raw.type === 'tool' || raw.type === 'custom') {
    if (!parseCapabilityId(raw.capability)) push('capability must look like name@version');
    if (!isObject(raw.config)) push('config must be a mapping');
  }

  if (raw.remediation !== undefined) {
    if (raw.type !== 'quiz') push('remediation is supported only on quiz modules in v1');
    else errors.push(...validateAdaptiveRemediationPolicy(raw.remediation, {
      path: `${path}.remediation`,
    }).errors);
  }

  return errors.length ? { errors } : { errors, module: raw };
}

const ITEM_CAPABILITIES = Object.freeze({
  multiple_choice: 'response.choice@1',
  short_answer: 'response.text@1',
  cloze: 'response.text@1',
  matching: 'response.matching@1',
  region_click: 'response.region@1',
  asset_choice: 'response.asset-choice@1',
});

/** Interaction capability implied by a standard School question item. */
export function capabilityForQuestionItem(item) {
  return ITEM_CAPABILITIES[item?.type] ?? null;
}

export function capabilityForLearningModule(module) {
  switch (module?.type) {
    case 'lecture_notes': return 'reader@1';
    case 'examples': return 'examples@1';
    case 'problems': return 'problems@1';
    case 'flashcards': return 'flashcards@1';
    case 'quiz': return 'quiz@1';
    case 'learning_probe': return 'learning-probe@1';
    case 'activity': return CORE_ACTIVITY_MECHANICS.includes(module.mechanic)
      ? `activity.${module.mechanic.replace('_', '-')}@1`
      : null;
    case 'tool':
    case 'custom': return module.capability;
    default: return null;
  }
}

/** Publication-time semantic check after the application resolves the bank. */
export function validateLearningProbeBank(module, bank, { path = 'learning probe' } = {}) {
  const errors = [];
  if (!bank || !Array.isArray(bank.items) || bank.items.length === 0) {
    return { errors: [`${path}: requires a resolved question bank`] };
  }
  const defined = new Set((bank.concepts ?? []).map(({ conceptId }) => conceptId));
  module.conceptIds.forEach((conceptId) => {
    if (!defined.has(conceptId)) errors.push(`${path}.conceptIds: unknown bank concept '${conceptId}'`);
  });
  const selected = new Set(module.conceptIds);
  bank.items.forEach((item, index) => {
    const at = `${path}.items[${index}]`;
    if (!Array.isArray(item.concepts) || !item.concepts.some((conceptId) => selected.has(conceptId))) {
      errors.push(`${at}: must bind at least one probe concept`);
    }
    if (!isObject(item.feedback) || !isText(item.feedback.explanation)) {
      errors.push(`${at}.feedback.explanation: is required for immediate corrective feedback`);
    }
  });
  return { errors };
}

function validateLearningProbe(raw, path, errors) {
  if (!REFERENCE_ID.test(raw.bankId || '')) errors.push(`${path}: bankId must be a lowercase content reference`);
  if (!LEARNING_PROBE_PHASES.includes(raw.phase)) {
    errors.push(`${path}: phase must be ${LEARNING_PROBE_PHASES.join('|')}`);
  }
  if (!Number.isInteger(raw.difficulty) || raw.difficulty < 1 || raw.difficulty > 5) {
    errors.push(`${path}: difficulty must be an integer from 1–5`);
  }
  if (!Array.isArray(raw.conceptIds) || raw.conceptIds.length === 0
      || raw.conceptIds.length > 8 || raw.conceptIds.some((id) => !ID.test(id))
      || new Set(raw.conceptIds).size !== raw.conceptIds.length) {
    errors.push(`${path}: conceptIds must contain 1..8 unique lowercase identifiers`);
  }
  if (!isObject(raw.feedback)) {
    errors.push(`${path}: feedback must be a mapping`);
    return;
  }
  if (raw.feedback.timing !== 'immediate') errors.push(`${path}.feedback.timing: v1 requires immediate`);
  if (!LEARNING_PROBE_INCORRECT_ACTIONS.includes(raw.feedback.onIncorrect)) {
    errors.push(`${path}.feedback.onIncorrect: must be ${LEARNING_PROBE_INCORRECT_ACTIONS.join('|')}`);
  }
  if (!Number.isInteger(raw.feedback.maxAttemptsPerItem)
      || raw.feedback.maxAttemptsPerItem < 1 || raw.feedback.maxAttemptsPerItem > 3) {
    errors.push(`${path}.feedback.maxAttemptsPerItem: must be an integer from 1–3`);
  }
}

function validateActivityConfig(mechanic, config, path, errors) {
  if (mechanic === 'matching' || mechanic === 'memory') {
    validatePairs(config.pairs, `${path}.pairs`, errors);
    return;
  }
  if (mechanic === 'sorting') {
    validateSorting(config, path, errors);
    return;
  }
  if (mechanic === 'sequencing') {
    validateLabelledItems(config.items, `${path}.items`, errors, 2);
    return;
  }
  if (mechanic === 'timed_drill') {
    if (!REFERENCE_ID.test(config.bankId || '')) errors.push(`${path}.bankId: must be a lowercase content reference`);
    if (!Number.isInteger(config.durationSeconds) || config.durationSeconds < 10 || config.durationSeconds > 3600) {
      errors.push(`${path}.durationSeconds: must be an integer from 10–3600`);
    }
    if (config.goalCount !== undefined && (!Number.isInteger(config.goalCount) || config.goalCount < 1 || config.goalCount > 255)) {
      errors.push(`${path}.goalCount: must be an integer from 1–255 when present`);
    }
  }
}

function validatePairs(raw, path, errors) {
  if (!Array.isArray(raw) || raw.length < 2) {
    errors.push(`${path}: must contain at least two pairs`);
    return;
  }
  const lefts = new Set();
  const rights = new Set();
  raw.forEach((pair, index) => {
    const at = `${path}[${index}]`;
    if (!isObject(pair)) { errors.push(`${at}: must be a mapping`); return; }
    if (!isText(pair.left)) errors.push(`${at}.left: is required`);
    else if (lefts.has(pair.left)) errors.push(`${at}.left: duplicate value '${pair.left}'`);
    else lefts.add(pair.left);
    if (!isText(pair.right)) errors.push(`${at}.right: is required`);
    else if (rights.has(pair.right)) errors.push(`${at}.right: duplicate value '${pair.right}'`);
    else rights.add(pair.right);
  });
}

function validateSorting(config, path, errors) {
  if (!Array.isArray(config.buckets) || config.buckets.length < 2) {
    errors.push(`${path}.buckets: must contain at least two buckets`);
  }
  const bucketIds = validateLabelledItems(config.buckets, `${path}.buckets`, errors, 2, 'bucketId');
  const itemIds = validateLabelledItems(config.items, `${path}.items`, errors, 2);
  if (itemIds.size === 0 || bucketIds.size === 0 || !Array.isArray(config.items)) return;
  config.items.forEach((item, index) => {
    if (isObject(item) && !bucketIds.has(item.bucketId)) {
      errors.push(`${path}.items[${index}].bucketId: unknown bucket '${item.bucketId}'`);
    }
  });
}

function validateLabelledItems(raw, path, errors, minimum, idField = 'itemId') {
  const ids = new Set();
  if (!Array.isArray(raw) || raw.length < minimum) {
    errors.push(`${path}: must contain at least ${minimum} items`);
    return ids;
  }
  raw.forEach((item, index) => {
    const at = `${path}[${index}]`;
    if (!isObject(item)) { errors.push(`${at}: must be a mapping`); return; }
    if (!ID.test(item[idField] || '')) errors.push(`${at}.${idField}: must be a lowercase identifier`);
    else if (ids.has(item[idField])) errors.push(`${at}.${idField}: duplicate ${idField} '${item[idField]}'`);
    else ids.add(item[idField]);
    if (!isText(item.label)) errors.push(`${at}.label: is required`);
  });
  return ids;
}
