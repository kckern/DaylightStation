import { parseCapabilityId } from '../catalog/capabilities.mjs';

/**
 * The reviewed inventory of capability IDs this backend recognizes (spec §3).
 * Published IDs are adopted verbatim from their deriving code and are never
 * renamed; return.* are the only IDs v1 introduces. action.* is reserved for
 * the v2 dispatch spec and must not appear here.
 */
export const RETURN_CAPABILITY_IDS = Object.freeze([
  'return.session@1', 'return.scan@1', 'return.cable@1', 'return.qr@1',
]);

export const KNOWN_CAPABILITY_IDS = Object.freeze([
  // Module presentation (capabilityForLearningModule)
  'reader@1', 'examples@1', 'problems@1', 'flashcards@1', 'quiz@1', 'learning-probe@1',
  'activity.matching@1', 'activity.sorting@1', 'activity.sequencing@1',
  'activity.timed-drill@1', 'activity.memory@1',
  // Item response capture (capabilityForQuestionItem)
  'response.choice@1', 'response.text@1', 'response.matching@1',
  'response.region@1', 'response.asset-choice@1',
  // Document blocks (capabilityForLearningDocumentBlock)
  'math@1', 'table-layout@1', 'image@1', 'scan-action@1',
  // Registered native tools (core LearningModuleRegistry)
  'calculator@1', 'graph@1', 'table@1', 'solver@1', 'matrix@1',
  'equation-editor@1', 'native-program@1',
  // Family/channel (TI-86 codec capability lists)
  'cable-sync@1', 'qr-output@1', 'shell-core@1',
  ...RETURN_CAPABILITY_IDS,
]);

const KNOWN = new Set(KNOWN_CAPABILITY_IDS);

export function isRegisteredCapability(id, { customCapabilities = [] } = {}) {
  if (!parseCapabilityId(id)) return false;
  return KNOWN.has(id) || customCapabilities.includes(id);
}
