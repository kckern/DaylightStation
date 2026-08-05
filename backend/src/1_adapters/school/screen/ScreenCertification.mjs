import {
  deriveModuleDemands, deriveBankDemands, capabilityReasons, moduleVerdict, rollUpLesson,
} from '#domains/school/surfaces/index.mjs';

const SESSION_RETURN_CAPABILITY = 'return.session@1';

/**
 * Screen-specific return-channel reason: tracked modules on a screen require
 * `return.session@1` specifically (spec §6.4) — stricter than the generic
 * class rule (any `return.*`), which is why the base pass is run with
 * `tracked: false` and this check is layered on top.
 */
function returnSessionReasons(demands, profile) {
  return demands.tracked && !profile.capabilities.includes(SESSION_RETURN_CAPABILITY)
    ? [`tracked module requires ${SESSION_RETURN_CAPABILITY} on a screen`]
    : [];
}

/**
 * Certification port for the screen surface family (spec §6.4/§7.3): live,
 * capability-driven only — no structural limits in v1. Pure — never throws
 * for content that doesn't fit.
 */
export class ScreenCertification {
  certify(bundle, profile) {
    const modules = bundle?.lesson?.modules ?? [];

    const moduleVerdicts = modules.map((module) => {
      const demands = deriveModuleDemands({ module, document: module.document, bank: module.bank });
      const reasons = [
        ...capabilityReasons({ ...demands, tracked: false }, profile),
        ...returnSessionReasons(demands, profile),
      ];
      return moduleVerdict({ moduleId: module.moduleId, reasons });
    });

    return { modules: moduleVerdicts, lesson: { verdict: rollUpLesson(moduleVerdicts) } };
  }

  certifyBank(bank, profile) {
    const demands = deriveBankDemands(bank);
    const reasons = [
      ...capabilityReasons({ ...demands, tracked: false }, profile),
      ...returnSessionReasons(demands, profile),
    ];
    return { verdict: reasons.length === 0 ? 'render' : 'incompatible', reasons, warnings: [] };
  }
}
