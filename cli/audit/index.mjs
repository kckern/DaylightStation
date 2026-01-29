#!/usr/bin/env node

/**
 * Audit Scanner - Scans codebase for coding standards violations
 *
 * Usage:
 *   node cli/audit/index.mjs [scope] [options]
 *
 * Examples:
 *   node cli/audit/index.mjs                    # Full backend scan
 *   node cli/audit/index.mjs fitness            # Single domain
 *   node cli/audit/index.mjs --changed          # Changed files only
 *   node cli/audit/index.mjs --json             # Output JSON instead of text
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { rules as importRules } from './rules/imports.mjs';
import { rules as exportRules, detectMissingDefaults } from './rules/exports.mjs';
import { rules as namingRules } from './rules/naming.mjs';
import { rules as classRules } from './rules/classes.mjs';
import { rules as errorRules } from './rules/errors.mjs';
import { rules as domainRules } from './rules/domain.mjs';
import { loadBaseline, isIgnored } from './baseline.mjs';
import { getFilesForScope } from './utils.mjs';

const ALL_RULES = [
  ...importRules,
  ...exportRules,
  ...namingRules,
  ...classRules,
  ...errorRules,
  ...domainRules
];

/**
 * Run grep-based detection for a rule
 */
function detectViolations(rule, files) {
  const violations = [];

  // Filter files by rule scope
  const scopeFiles = files.filter(f => {
    if (!rule.scope) return true;
    const pattern = rule.scope.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
    return new RegExp(pattern).test(f);
  });

  if (scopeFiles.length === 0) return violations;

  for (const file of scopeFiles) {
    try {
      // Read file and test regex in JS instead of shell grep
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          violations.push({
            rule: rule.id,
            severity: rule.severity,
            file,
            line: i + 1,
            code: lines[i].trim(),
            message: rule.message
          });
        }
      }
    } catch (e) {
      // Ignore file read errors
    }
  }

  return violations;
}

/**
 * Main scanner function
 */
async function scan(scope, options = {}) {
  const files = await getFilesForScope(scope, options);
  const baseline = await loadBaseline();

  const allViolations = [];
  let idCounter = 1;

  for (const rule of ALL_RULES) {
    // Skip rules that need post-processing - they have custom detection
    if (rule._needsPostProcess) continue;

    const violations = detectViolations(rule, files);
    for (const v of violations) {
      // Check if ignored via baseline or annotation
      const ignored = isIgnored(v, baseline);

      allViolations.push({
        id: `v-${String(idCounter++).padStart(3, '0')}`,
        ...v,
        status: ignored ? 'ignored' : 'new'
      });
    }
  }

  // Run custom detection for missing default exports
  const missingDefaultViolations = await detectMissingDefaults(files);
  for (const v of missingDefaultViolations) {
    const ignored = isIgnored(v, baseline);
    allViolations.push({
      id: `v-${String(idCounter++).padStart(3, '0')}`,
      ...v,
      status: ignored ? 'ignored' : 'new'
    });
  }

  return {
    scanDate: new Date().toISOString(),
    scope: scope || 'full',
    filesScanned: files.length,
    violations: allViolations
  };
}

// CLI entry point
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const changedOnly = args.includes('--changed');
const changedFrom = args.find(a => a.startsWith('--changed-from='))?.split('=')[1];
const scope = args.find(a => !a.startsWith('--'));

const options = { changedOnly, changedFrom };

scan(scope, options).then(result => {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Scanned ${result.filesScanned} files`);
    console.log(`Found ${result.violations.length} violations`);

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const v of result.violations) {
      bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
    }
    console.log(`  Critical: ${bySeverity.critical}`);
    console.log(`  High: ${bySeverity.high}`);
    console.log(`  Medium: ${bySeverity.medium}`);
    console.log(`  Low: ${bySeverity.low}`);
  }
}).catch(err => {
  console.error('Scan failed:', err.message);
  process.exit(1);
});

export { scan, ALL_RULES };
