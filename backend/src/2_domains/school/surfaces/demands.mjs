import { capabilityForLearningModule, capabilityForQuestionItem } from '../catalog/moduleValidation.mjs';
import { capabilityForLearningDocumentBlock } from '../catalog/learningDocumentValidation.mjs';

export const TRACKED_MODULE_TYPES = Object.freeze(
  new Set(['quiz', 'problems', 'learning_probe', 'flashcards', 'activity']),
);

const itemBearsImage = (item) => item?.asset !== undefined
  || (Array.isArray(item?.choices) && item.choices.some((c) => c && typeof c === 'object' && c.image !== undefined));

function itemDemands(items = []) {
  const out = [];
  for (const item of items) {
    const cap = capabilityForQuestionItem(item);
    if (cap) out.push(cap);
    if (itemBearsImage(item)) out.push('image@1');
  }
  return out;
}

/**
 * A module's demand set (spec §3.3): module capability + block capabilities +
 * item capabilities, deduplicated, plus its tracking class. Pure; the caller
 * supplies the resolved document and bank (ports do no I/O). Declared
 * lesson-level requiredCapabilities are applied by the certification
 * projection, not here (they are lesson-wide and absent from module shapes).
 */
export function deriveModuleDemands({ module, document = null, bank = null }) {
  const caps = [];
  const moduleCap = capabilityForLearningModule(module);
  if (moduleCap) caps.push(moduleCap);
  for (const block of (document ?? module?.document)?.blocks ?? []) {
    const cap = capabilityForLearningDocumentBlock(block);
    if (cap) caps.push(cap);
  }
  caps.push(...itemDemands((bank ?? module?.bank)?.items));
  return { capabilities: [...new Set(caps)], tracked: TRACKED_MODULE_TYPES.has(module?.type) };
}

/** A standalone bank's demand set (spec §7.3): items only, always tracked. */
export function deriveBankDemands(bank) {
  return { capabilities: [...new Set(itemDemands(bank?.items))], tracked: true };
}
