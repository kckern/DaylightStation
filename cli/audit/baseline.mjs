/**
 * Baseline management - track known violations
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'yaml';
import { hasFileDisableAnnotation, hasLineAnnotation } from './utils.mjs';

const BASELINE_PATH = 'docs/_wip/audits/baseline.yml';

/**
 * Load baseline from YAML file
 * @returns {Object} Baseline data
 */
export async function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    return {
      schema_version: 1,
      last_updated: null,
      known: [],
      exceptions: [],
      resolved: []
    };
  }

  try {
    const content = readFileSync(BASELINE_PATH, 'utf-8');
    return yaml.parse(content) || {
      schema_version: 1,
      known: [],
      exceptions: [],
      resolved: []
    };
  } catch (e) {
    console.error('Failed to load baseline:', e.message);
    return { schema_version: 1, known: [], exceptions: [], resolved: [] };
  }
}

/**
 * Save baseline to YAML file
 * @param {Object} baseline
 */
export async function saveBaseline(baseline) {
  baseline.last_updated = new Date().toISOString().split('T')[0];

  const content = yaml.stringify(baseline, {
    lineWidth: 0,
    nullStr: ''
  });

  writeFileSync(BASELINE_PATH, content, 'utf-8');
}

/**
 * Check if a violation is ignored (in baseline exceptions or has annotation)
 * @param {Object} violation
 * @param {Object} baseline
 * @returns {boolean}
 */
export function isIgnored(violation, baseline) {
  // Check baseline exceptions
  const inExceptions = baseline.exceptions?.some(e =>
    e.file === violation.file && e.rule === violation.rule
  );
  if (inExceptions) return true;

  // Check file-level @audit-disable
  if (hasFileDisableAnnotation(violation.file, violation.rule)) {
    return true;
  }

  // Check line-level @audit-ok
  if (hasLineAnnotation(violation.file, violation.line, violation.rule)) {
    return true;
  }

  return false;
}

/**
 * Check if a violation is known (in baseline.known)
 * @param {Object} violation
 * @param {Object} baseline
 * @returns {boolean}
 */
export function isKnown(violation, baseline) {
  return baseline.known?.some(k =>
    k.file === violation.file &&
    k.rule === violation.rule &&
    (k.lines?.includes(violation.line) || !k.lines)
  );
}

/**
 * Update baseline with new scan results
 * @param {Object} baseline - Current baseline
 * @param {Object[]} violations - New violations
 * @returns {Object} Updated baseline with changes summary
 */
export function updateBaseline(baseline, violations) {
  const newViolations = [];
  const stillPresent = new Set();

  for (const v of violations) {
    if (v.status === 'ignored') continue;

    const key = `${v.file}:${v.rule}:${v.line}`;
    stillPresent.add(key);

    const known = isKnown(v, baseline);
    if (!known) {
      newViolations.push({
        id: `${v.rule}-${Date.now()}`,
        file: v.file,
        rule: v.rule,
        lines: [v.line],
        added: new Date().toISOString().split('T')[0],
        note: ''
      });
    }
  }

  // Find resolved (in known but not in current scan)
  const resolved = [];
  const stillKnown = [];

  for (const k of (baseline.known || [])) {
    const key = `${k.file}:${k.rule}:${k.lines?.[0] || 0}`;
    if (stillPresent.has(key)) {
      stillKnown.push(k);
    } else {
      resolved.push({
        ...k,
        resolved_date: new Date().toISOString().split('T')[0]
      });
    }
  }

  return {
    baseline: {
      ...baseline,
      known: [...stillKnown, ...newViolations],
      resolved: [...(baseline.resolved || []), ...resolved]
    },
    changes: {
      new: newViolations.length,
      resolved: resolved.length
    }
  };
}

export { BASELINE_PATH };
