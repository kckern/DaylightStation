/**
 * Envelope v2 (spec §4). No I/O.
 *
 * v2 introduces versioning to the previously version-less document shape
 * (§4.1) without forking the validator: `validateDocumentV2` builds the
 * v1-shaped subset {id, seed, variant, target, blocks, title} and hands it to
 * the existing `validateDocument` for every check that shape already owns
 * (id/seed/variant/target, the answer-key ban, block structure, itemId
 * uniqueness, omr_response placement) — this file adds only what v1 doesn't
 * know about: archetype presets, header/fit/defaultPoints, and the `source`
 * sugar.
 *
 * `source` desugar and error-path attribution: the envelope's `source` is
 * sugar for a header-corner `scan_action` block the author never wrote as a
 * `blocks[]` entry, so a malformed `source` must not be reported as
 * `blocks[0]: ...` — that path would send an AI repair loop hunting through
 * `blocks` for a line that isn't there. `desugarSource` validates the
 * candidate block itself (via the same `validateBlock` a hand-authored
 * scan_action goes through) at path `'source'` *before* it ever reaches
 * `validateDocument`, and only a block that already passed is prepended. A
 * prepended block is therefore always structurally valid, so `validateDocument`
 * re-checking `blocks[0]` never produces a second, mis-pathed error for it.
 */
import { validateDocument } from './documentValidation.mjs';
import { validateBlock } from './blocks.mjs';

export const DOCUMENT_V2_SCHEMA = 'school.document/v2';
export const ARCHETYPES = ['quiz', 'worksheet', 'infopage'];
export const FIT_POLICIES = ['flow', 'one-page', 'fill'];

const TYPE_SCALES = ['standard', 'young'];

const HEADER_PRESETS = {
  quiz: { name: true, date: true, scoreBox: true },
  worksheet: { name: true, date: true, scoreBox: false },
  infopage: { name: false, date: false, scoreBox: false },
};

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Validates and expands the envelope's optional `source: {action, label}`
 * sugar into a `scan_action` block. Returns `undefined` (pushing errors
 * under the `source` path) when absent or invalid, so the caller never
 * prepends a block that would just duplicate-fail inside `validateDocument`.
 */
function desugarSource(raw, errors) {
  if (raw.source === undefined || raw.source === null) return undefined;
  if (!isPlainObject(raw.source)) {
    errors.push('source must be a mapping');
    return undefined;
  }
  const block = { type: 'scan_action', action: raw.source.action, label: raw.source.label };
  const { errors: blockErrors } = validateBlock(block, { path: 'source' });
  if (blockErrors.length) {
    errors.push(...blockErrors);
    return undefined;
  }
  return block;
}

/**
 * @param {*} raw - one parsed v2 document
 * @returns {{ errors: string[], document?: object }}
 */
export function validateDocumentV2(raw) {
  if (!isPlainObject(raw)) return { errors: ['document must be a mapping'] };
  const errors = [];

  if (!ARCHETYPES.includes(raw.archetype)) errors.push(`unknown archetype: ${raw.archetype}`);
  const preset = HEADER_PRESETS[raw.archetype] || { name: false, date: false, scoreBox: false };

  const rawHeaderValid = raw.header === undefined || isPlainObject(raw.header);
  if (!rawHeaderValid) errors.push('header must be a mapping');
  const rawHeader = rawHeaderValid && raw.header ? raw.header : {};
  const header = { ...preset };
  for (const field of ['name', 'date', 'scoreBox']) {
    if (rawHeader[field] === undefined) continue;
    if (typeof rawHeader[field] !== 'boolean') errors.push(`header.${field} must be a boolean`);
    else header[field] = rawHeader[field];
  }
  if (rawHeader.instructions !== undefined) {
    if (typeof rawHeader.instructions !== 'string') errors.push('header.instructions must be a string');
    else header.instructions = rawHeader.instructions;
  }

  const rawFitValid = raw.fit === undefined || isPlainObject(raw.fit);
  if (!rawFitValid) errors.push('fit must be a mapping');
  const rawFit = rawFitValid && raw.fit ? raw.fit : {};
  const fit = { policy: 'flow', typeScale: 'standard' };
  if (rawFit.policy !== undefined) {
    if (!FIT_POLICIES.includes(rawFit.policy)) errors.push(`unknown fit.policy: ${rawFit.policy}`);
    else fit.policy = rawFit.policy;
  }
  if (rawFit.typeScale !== undefined) {
    if (!TYPE_SCALES.includes(rawFit.typeScale)) errors.push(`unknown fit.typeScale: ${rawFit.typeScale}`);
    else fit.typeScale = rawFit.typeScale;
  }

  // Letter-only fit policies (spec §7): a continuous receipt roll has no page
  // to overset-check or bottom out.
  if ((fit.policy === 'one-page' || fit.policy === 'fill') && Array.isArray(raw.target) && raw.target.includes('receipt')) {
    errors.push(`fit policy '${fit.policy}' requires letter target`);
  }

  let defaultPoints = 1;
  if (raw.defaultPoints !== undefined) {
    const ok = typeof raw.defaultPoints === 'number' && Number.isFinite(raw.defaultPoints) && raw.defaultPoints >= 0;
    if (!ok) errors.push('defaultPoints must be a number >= 0');
    else defaultPoints = raw.defaultPoints;
  }

  const scanActionBlock = desugarSource(raw, errors);
  const blocks = scanActionBlock
    ? (Array.isArray(raw.blocks) ? [scanActionBlock, ...raw.blocks] : raw.blocks)
    : raw.blocks;

  const v1Subset = {
    id: raw.id, seed: raw.seed, variant: raw.variant, target: raw.target, blocks,
  };
  if (raw.title !== undefined) v1Subset.title = raw.title;

  const v1Result = validateDocument(v1Subset);
  errors.push(...v1Result.errors);

  if (errors.length) return { errors };

  const document = {
    ...v1Result.document,
    schema: DOCUMENT_V2_SCHEMA,
    archetype: raw.archetype,
    header,
    fit,
    defaultPoints,
  };
  return { errors: [], document };
}

/**
 * Dispatches on `raw.schema`: v2 literal -> `validateDocumentV2`; absent ->
 * the existing v1 `validateDocument`, untouched; anything else -> a single
 * 'unknown document schema' error. One entry point for both envelope
 * generations (spec §4.1's "no migration required" posture).
 *
 * @param {*} raw
 * @returns {{ errors: string[], document?: object }}
 */
export function validateAnyDocument(raw) {
  if (!isPlainObject(raw)) return validateDocument(raw);
  if (raw.schema === DOCUMENT_V2_SCHEMA) return validateDocumentV2(raw);
  if (raw.schema === undefined) return validateDocument(raw);
  return { errors: ['unknown document schema'] };
}
