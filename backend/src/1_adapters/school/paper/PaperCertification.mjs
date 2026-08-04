import {
  deriveModuleDemands, deriveBankDemands, capabilityReasons, moduleVerdict, rollUpLesson,
} from '#domains/school/surfaces/index.mjs';

/**
 * Module types that are inherently interactive (device-driven input,
 * scripted mechanics, or bespoke capability) and have no paper rendering,
 * regardless of capability overlap (spec §6.3).
 */
const NON_PAPER_MODULE_TYPES = Object.freeze(new Set(['tool', 'custom', 'activity', 'learning_probe']));

const CHOICE_ITEM_TYPES = Object.freeze(new Set(['multiple_choice', 'asset_choice']));

/** A choice is printable when it's non-empty text, or an object with a non-empty label. */
function hasPrintableText(choice) {
  if (typeof choice === 'string') return choice.trim().length > 0;
  if (choice && typeof choice === 'object' && !Array.isArray(choice)) {
    return typeof choice.label === 'string' && choice.label.trim().length > 0;
  }
  return false;
}

/** OMR channel count and printable-label checks for choice items in a bank (spec §6.3). */
function choiceItemReasons(bank, limits) {
  const reasons = [];
  for (const item of bank?.items ?? []) {
    if (!CHOICE_ITEM_TYPES.has(item?.type)) continue;
    const choices = Array.isArray(item.choices) ? item.choices : [];
    if (choices.length > limits.omrChannels) {
      reasons.push(`item ${item.id} has ${choices.length} choices, exceeding the OMR channel limit of ${limits.omrChannels}`);
    }
    if (choices.some((choice) => !hasPrintableText(choice))) {
      reasons.push(`item ${item.id} has a choice with no printable text`);
    }
  }
  return reasons;
}

/** A bank's item count must fit on a single sheet (spec §6.3). */
function sheetBudgetReasons(bank, limits) {
  const count = bank?.items?.length ?? 0;
  return count > limits.maxItemsPerSheet
    ? [`bank has ${count} items, exceeding the maximum of ${limits.maxItemsPerSheet} items per sheet`]
    : [];
}

/**
 * Estimated page count for a lecture_notes document must fit the print
 * budget (spec §6.3). Estimate: 12 blocks/page is the v1 heuristic; the
 * paper renderer refines actual layout later without changing this port's
 * contract.
 */
function pageBudgetReasons(document, limits) {
  const blocks = document?.blocks ?? [];
  const pages = Math.ceil(blocks.length / 12);
  return pages > limits.maxPagesPerDocument
    ? [`document is estimated at ${pages} pages, exceeding the maximum of ${limits.maxPagesPerDocument} pages per document`]
    : [];
}

/**
 * Certification port for the paper surface family (spec §6.3/§7.3): static,
 * scan-returned, capacity-bounded by OMR channels, sheet item counts, and
 * document page counts. Pure — never throws for content that doesn't fit.
 */
export class PaperCertification {
  certify(bundle, profile) {
    const modules = bundle?.lesson?.modules ?? [];
    const limits = profile.limits ?? {};

    const moduleVerdicts = modules.map((module) => {
      const demands = deriveModuleDemands({ module, document: module.document, bank: module.bank });
      const reasons = [...capabilityReasons(demands, profile)];

      if (NON_PAPER_MODULE_TYPES.has(module.type)) {
        reasons.push(`${module.type} modules do not render on paper`);
      }
      if (module.bank) {
        reasons.push(...sheetBudgetReasons(module.bank, limits));
        reasons.push(...choiceItemReasons(module.bank, limits));
      }
      if (module.type === 'lecture_notes' && module.document) {
        reasons.push(...pageBudgetReasons(module.document, limits));
      }

      return moduleVerdict({ moduleId: module.moduleId, reasons });
    });

    return { modules: moduleVerdicts, lesson: { verdict: rollUpLesson(moduleVerdicts) } };
  }

  certifyBank(bank, profile) {
    const limits = profile.limits ?? {};
    const demands = deriveBankDemands(bank);
    const reasons = [
      ...capabilityReasons(demands, profile),
      ...sheetBudgetReasons(bank, limits),
      ...choiceItemReasons(bank, limits),
    ];
    return { verdict: reasons.length === 0 ? 'render' : 'incompatible', reasons, warnings: [] };
  }
}
