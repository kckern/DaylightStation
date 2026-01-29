/**
 * Rule index - exports all rules
 */

export { rules as importRules } from './imports.mjs';
export { rules as exportRules, detectMissingDefaults } from './exports.mjs';
export { rules as namingRules } from './naming.mjs';
export { rules as classRules } from './classes.mjs';
export { rules as errorRules } from './errors.mjs';
export { rules as domainRules } from './domain.mjs';

import { rules as importRules } from './imports.mjs';
import { rules as exportRules } from './exports.mjs';
import { rules as namingRules } from './naming.mjs';
import { rules as classRules } from './classes.mjs';
import { rules as errorRules } from './errors.mjs';
import { rules as domainRules } from './domain.mjs';

export const ALL_RULES = [
  ...importRules,
  ...exportRules,
  ...namingRules,
  ...classRules,
  ...errorRules,
  ...domainRules
];

/**
 * Get rules by severity
 * @param {'critical'|'high'|'medium'|'low'} severity
 */
export function getRulesBySeverity(severity) {
  return ALL_RULES.filter(r => r.severity === severity);
}

/**
 * Get rule by ID
 * @param {string} id
 */
export function getRuleById(id) {
  return ALL_RULES.find(r => r.id === id);
}
