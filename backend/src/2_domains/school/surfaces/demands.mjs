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
  // capabilityForLearningModule returns null for a genuinely unknown module
  // type (its default branch), or for an 'activity' module whose mechanic is
  // not a registered CORE_ACTIVITY_MECHANIC. Every other module shape
  // (lecture_notes, examples, problems, flashcards, quiz, learning_probe,
  // tool/custom with an authored capability) yields a capability. A null
  // here means "this module cannot be certified against any profile" — it
  // must not be silently dropped from the demand set, or a profile that
  // offers nothing in particular would wrongly certify it as renderable
  // (spec §7.1 fail-closed contract; see F2 in the 2026-08-04 acceptance
  // audit). We surface it as `unknownType` (the offending type string) so
  // `capabilityReasons` can turn it into a never-satisfiable reason.
  const unknownType = moduleCap === null ? (module?.type ?? 'unspecified') : null;
  if (moduleCap) caps.push(moduleCap);
  for (const block of (document ?? module?.document)?.blocks ?? []) {
    const cap = capabilityForLearningDocumentBlock(block);
    if (cap) caps.push(cap);
  }
  caps.push(...itemDemands((bank ?? module?.bank)?.items));
  return {
    capabilities: [...new Set(caps)],
    tracked: TRACKED_MODULE_TYPES.has(module?.type),
    ...(unknownType ? { unknownType } : {}),
  };
}

/** A standalone bank's demand set (spec §7.3): items only, always tracked. */
export function deriveBankDemands(bank) {
  return { capabilities: [...new Set(itemDemands(bank?.items))], tracked: true };
}
