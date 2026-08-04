import { parseCapabilityId } from './capabilities.mjs';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REFERENCE_ID = /^[a-z0-9][a-z0-9:._/-]{0,127}$/;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

export const LEARNING_DOCUMENT_BLOCK_TYPES = Object.freeze([
  'heading',
  'prose',
  'definition',
  'formula',
  'worked_example',
  'table',
  'callout',
  'asset',
  'scan_action',
  'tool_invitation',
]);

/**
 * Pure validation for device-neutral reading content. This is deliberately
 * separate from printable School documents: a device note does not need paper
 * targets, deterministic worksheet seeds, or OMR blocks.
 *
 * @param {*} raw
 * @returns {{errors: string[], document?: object, capabilities?: string[]}}
 */
export function validateLearningDocument(raw) {
  if (!isObject(raw)) return { errors: ['learning document must be a mapping'] };
  const errors = [];
  if (raw.schema !== 'school.learning-document/v1') errors.push('schema must be school.learning-document/v1');
  if (!REFERENCE_ID.test(raw.documentId || '')) errors.push('documentId must be a lowercase content reference');
  if (!isText(raw.title)) errors.push('title is required');
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    errors.push('blocks must be a non-empty array');
    return { errors };
  }

  const ids = new Set();
  const capabilities = new Set(['reader@1']);
  raw.blocks.forEach((block, index) => {
    const path = `blocks[${index}]`;
    errors.push(...validateLearningDocumentBlock(block, { path }).errors);
    if (!isObject(block)) return;
    if (typeof block.blockId === 'string') {
      if (ids.has(block.blockId)) errors.push(`${path}.blockId: duplicate block '${block.blockId}'`);
      else ids.add(block.blockId);
    }
    const capability = capabilityForLearningDocumentBlock(block);
    if (capability) capabilities.add(capability);
  });

  if (errors.length) return { errors };
  return {
    errors,
    document: structuredClone(raw),
    capabilities: [...capabilities],
  };
}

/** Validate one closed learning-document block. */
export function validateLearningDocumentBlock(raw, { path = 'block' } = {}) {
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  const errors = [];
  const push = (field, message) => errors.push(`${path}${field ? `.${field}` : ''}: ${message}`);
  if (!ID.test(raw.blockId || '')) push('blockId', 'must be a lowercase identifier');
  if (!LEARNING_DOCUMENT_BLOCK_TYPES.includes(raw.type)) {
    push('type', `must be one of ${LEARNING_DOCUMENT_BLOCK_TYPES.join('|')}`);
    return { errors };
  }

  if (raw.type === 'heading') {
    if (!isText(raw.text)) push('text', 'is required');
    if (!Number.isInteger(raw.level) || raw.level < 1 || raw.level > 3) push('level', 'must be an integer from 1–3');
  } else if (raw.type === 'prose') {
    if (!isText(raw.text)) push('text', 'is required');
  } else if (raw.type === 'definition') {
    if (!isText(raw.term)) push('term', 'is required');
    if (!isText(raw.definition)) push('definition', 'is required');
  } else if (raw.type === 'formula') {
    if (!isText(raw.text)) push('text', 'is required as a portable fallback');
    if (raw.latex !== undefined && !isText(raw.latex)) push('latex', 'must be non-empty when present');
    if (raw.variables !== undefined && (!Array.isArray(raw.variables) || !raw.variables.every((entry) => (
      isObject(entry) && isText(entry.symbol) && isText(entry.meaning)
    )))) push('variables', 'must contain {symbol, meaning} entries when present');
  } else if (raw.type === 'worked_example') {
    if (!isText(raw.prompt)) push('prompt', 'is required');
    if (!Array.isArray(raw.steps) || raw.steps.length === 0 || !raw.steps.every(isText)) {
      push('steps', 'must be a non-empty array of non-empty strings');
    }
    if (raw.result !== undefined && !isText(raw.result)) push('result', 'must be non-empty when present');
  } else if (raw.type === 'table') {
    validateTable(raw, path, errors);
  } else if (raw.type === 'callout') {
    if (!['info', 'tip', 'warning'].includes(raw.tone)) push('tone', 'must be info|tip|warning');
    if (!isText(raw.text)) push('text', 'is required');
  } else if (raw.type === 'asset') {
    if (!REFERENCE_ID.test(raw.assetId || '')) push('assetId', 'must be a lowercase content reference');
    if (!isText(raw.alt)) push('alt', 'is required');
  } else if (raw.type === 'scan_action') {
    if (!REFERENCE_ID.test(raw.actionId || '')) push('actionId', 'must be a lowercase content reference');
    if (!isText(raw.label)) push('label', 'is required');
    if (raw.token !== undefined || raw.qrModules !== undefined) {
      push('token', 'and QR modules are server-issued and must not be authored');
    }
  } else if (raw.type === 'tool_invitation') {
    if (!parseCapabilityId(raw.capability)) push('capability', 'must look like name@version');
    if (!isText(raw.label)) push('label', 'is required');
    if (!isObject(raw.config)) push('config', 'must be a mapping');
  }

  return { errors };
}

export function capabilityForLearningDocumentBlock(block) {
  if (block?.type === 'formula' && block.latex) return 'math@1';
  if (block?.type === 'table') return 'table-layout@1';
  if (block?.type === 'asset') return 'image@1';
  if (block?.type === 'scan_action') return 'scan-action@1';
  if (block?.type === 'tool_invitation') return block.capability;
  return null;
}

function validateTable(raw, path, errors) {
  if (!Array.isArray(raw.columns) || raw.columns.length === 0 || !raw.columns.every(isText)) {
    errors.push(`${path}.columns: must be a non-empty array of non-empty strings`);
    return;
  }
  if (new Set(raw.columns).size !== raw.columns.length) errors.push(`${path}.columns: values must be unique`);
  if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
    errors.push(`${path}.rows: must be a non-empty array`);
    return;
  }
  raw.rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== raw.columns.length || !row.every(isText)) {
      errors.push(`${path}.rows[${index}]: must contain ${raw.columns.length} non-empty string cells`);
    }
  });
}
