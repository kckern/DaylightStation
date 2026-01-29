/**
 * Audit utilities - file discovery and helpers
 */

import { execSync } from 'child_process';

/**
 * Get files to scan based on scope
 * @param {string} scope - Domain name, or null for full scan
 * @param {Object} options - { changedOnly, changedFrom }
 * @returns {string[]} Array of file paths
 */
export async function getFilesForScope(scope, options = {}) {
  const { changedOnly, changedFrom } = options;

  // Get changed files if requested
  if (changedOnly || changedFrom) {
    const base = changedFrom || 'HEAD~1';
    try {
      const cmd = `git diff --name-only ${base} -- 'backend/src/**/*.mjs'`;
      const output = execSync(cmd, { encoding: 'utf-8' });
      const files = output.trim().split('\n').filter(f => f.length > 0);

      // Further filter by scope if provided
      if (scope) {
        return files.filter(f => f.includes(`/${scope}/`));
      }
      return files;
    } catch (e) {
      console.error('Failed to get changed files:', e.message);
      return [];
    }
  }

  // Build glob pattern based on scope
  let pattern;
  if (scope) {
    // Check if it's a layer (0_system, 1_domains, etc)
    if (/^\d_/.test(scope)) {
      pattern = `backend/src/${scope}`;
    } else {
      // Assume it's a domain name
      pattern = `backend/src/1_domains/${scope}`;
    }
  } else {
    pattern = 'backend/src';
  }

  // Use find command instead of glob
  try {
    const cmd = `find "${pattern}" -name "*.mjs" -type f 2>/dev/null`;
    const output = execSync(cmd, { encoding: 'utf-8' });
    return output.trim().split('\n').filter(f => f.length > 0);
  } catch (e) {
    return [];
  }
}

/**
 * Check if a file has an @audit-disable annotation for a rule
 * @param {string} filePath
 * @param {string} ruleId
 * @returns {boolean}
 */
export function hasFileDisableAnnotation(filePath, ruleId) {
  try {
    const cmd = `head -20 "${filePath}" | grep -E '@audit-disable.*${ruleId}' || true`;
    const output = execSync(cmd, { encoding: 'utf-8' });
    return output.trim().length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Check if a specific line has an @audit-ok annotation
 * @param {string} filePath
 * @param {number} lineNum
 * @param {string} ruleId
 * @returns {boolean}
 */
export function hasLineAnnotation(filePath, lineNum, ruleId) {
  try {
    // Check the line itself and the line before it
    const startLine = Math.max(1, lineNum - 1);
    const cmd = `sed -n '${startLine},${lineNum}p' "${filePath}" | grep -E '@audit-ok.*${ruleId}' || true`;
    const output = execSync(cmd, { encoding: 'utf-8' });
    return output.trim().length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Extract code context around a violation
 * @param {string} filePath
 * @param {number} lineNum
 * @param {number} context - Lines of context before/after
 * @returns {string}
 */
export function getCodeContext(filePath, lineNum, context = 2) {
  try {
    const startLine = Math.max(1, lineNum - context);
    const endLine = lineNum + context;
    const cmd = `sed -n '${startLine},${endLine}p' "${filePath}"`;
    return execSync(cmd, { encoding: 'utf-8' });
  } catch (e) {
    return '';
  }
}
