import { missingCapabilities } from '../catalog/capabilities.mjs';

/** Shared first pass every family port runs (spec §7.1). Pure. */
export function capabilityReasons(demands, profile) {
  const reasons = missingCapabilities(demands.capabilities, profile.capabilities)
    .map((id) => `missing capability ${id}`);
  // Fail-closed (spec §7.1): a demand set flagged `unknownType` (see
  // demands.mjs) has no capability for any profile to match, so it must
  // never be treated as trivially satisfied by an empty missing-capability
  // diff. F2 fix.
  if (demands.unknownType) {
    reasons.push(`unknown module type '${demands.unknownType}' cannot be certified`);
  }
  if (demands.tracked && !profile.capabilities.some((id) => id.startsWith('return.'))) {
    reasons.push('tracked module requires a return channel; profile offers none');
  }
  return reasons;
}

export function moduleVerdict({ moduleId, reasons = [], warnings = [] }) {
  return Object.freeze({
    moduleId,
    verdict: reasons.length === 0 ? 'render' : 'incompatible',
    reasons: Object.freeze([...reasons]),
    warnings: Object.freeze([...warnings]),
  });
}

/** Lesson roll-up (spec §7.2). fullOrNothing is the SchoolCalc tightening. */
export function rollUpLesson(moduleVerdicts, { fullOrNothing = false } = {}) {
  const total = moduleVerdicts.length;
  const rendering = moduleVerdicts.filter(({ verdict }) => verdict === 'render').length;
  if (rendering === total && total > 0) return 'full';
  if (rendering === 0) return 'none';
  return fullOrNothing ? 'none' : 'partial';
}
