/**
 * Report generator - creates markdown audit reports
 */

import { writeFileSync } from 'fs';

/**
 * Generate markdown report from scan results
 * @param {Object} scanResult - Output from scanner
 * @param {Object} baseline - Current baseline
 * @param {Object} options - { scope, outputPath }
 * @returns {string} Markdown report content
 */
export function generateReport(scanResult, baseline, options = {}) {
  const { scope = 'full' } = options;
  const date = new Date().toISOString().split('T')[0];

  // Classify violations
  const newViolations = [];
  const knownViolations = [];
  const ignoredViolations = [];

  for (const v of scanResult.violations) {
    if (v.status === 'ignored') {
      ignoredViolations.push(v);
    } else if (isInBaseline(v, baseline)) {
      knownViolations.push(v);
    } else {
      newViolations.push(v);
    }
  }

  // Find resolved (in baseline but not in current scan)
  const resolvedViolations = findResolved(baseline, scanResult.violations);

  // Calculate grade
  const grade = calculateGrade(scanResult.violations);

  // Build report
  let report = `# Code Standards Audit Report

**Date:** ${date}
**Scope:** ${scope === 'full' ? 'Full codebase' : scope}
**Files scanned:** ${scanResult.filesScanned}
**Reference:** \`docs/reference/core/coding-standards.md\`

---

## Summary

| Status | Count |
|--------|-------|
| NEW | ${newViolations.length} |
| KNOWN | ${knownViolations.length} |
| FIXED | ${resolvedViolations.length} |
| IGNORED | ${ignoredViolations.length} |
| **Total Active** | ${newViolations.length + knownViolations.length} |

**Grade: ${grade.letter} (${grade.score}/100)**

---

`;

  // New violations section
  if (newViolations.length > 0) {
    report += `## NEW Violations (${newViolations.length})

These are new since last audit - triage needed.

`;
    report += formatViolations(newViolations, 'new');
  } else {
    report += `## NEW Violations (0)

No new violations detected.

`;
  }

  // Known violations section
  if (knownViolations.length > 0) {
    report += `---

## KNOWN Violations (${knownViolations.length})

Previously identified, not yet addressed.

| File | Rule | Severity | Line |
|------|------|----------|------|
`;
    for (const v of knownViolations) {
      const shortFile = v.file.replace('backend/src/', '');
      report += `| ${shortFile} | ${v.rule} | ${v.severity} | ${v.line} |\n`;
    }
    report += '\n';
  }

  // Fixed violations section
  if (resolvedViolations.length > 0) {
    report += `---

## FIXED Since Last Audit (${resolvedViolations.length})

These were in baseline but no longer detected.

`;
    for (const v of resolvedViolations) {
      const shortFile = v.file.replace('backend/src/', '');
      report += `- \`${shortFile}\` - ${v.rule}\n`;
    }
    report += '\n';
  }

  // Ignored section
  if (ignoredViolations.length > 0) {
    report += `---

## IGNORED (${ignoredViolations.length})

Suppressed via @audit-ok annotation or baseline exception.

| File | Rule | Line |
|------|------|------|
`;
    for (const v of ignoredViolations) {
      const shortFile = v.file.replace('backend/src/', '');
      report += `| ${shortFile} | ${v.rule} | ${v.line} |\n`;
    }
  }

  return report;
}

/**
 * Format violations for detailed display
 */
function formatViolations(violations, status) {
  // Group by severity
  const bySeverity = { critical: [], high: [], medium: [], low: [] };
  for (const v of violations) {
    bySeverity[v.severity].push(v);
  }

  let output = '';

  for (const severity of ['critical', 'high', 'medium', 'low']) {
    const group = bySeverity[severity];
    if (group.length === 0) continue;

    output += `### ${severity.toUpperCase()} (${group.length})\n\n`;

    for (const v of group) {
      const shortFile = v.file.replace('backend/src/', '');
      output += `**${v.rule}**\n`;
      output += `- File: \`${shortFile}:${v.line}\`\n`;
      output += `- Code: \`${v.code.substring(0, 80)}${v.code.length > 80 ? '...' : ''}\`\n`;
      output += `- Fix: ${v.message}\n\n`;
    }
  }

  return output;
}

/**
 * Check if violation is in baseline known list
 */
function isInBaseline(violation, baseline) {
  return baseline.known?.some(k =>
    k.file === violation.file &&
    k.rule === violation.rule
  );
}

/**
 * Find violations that were in baseline but not in current scan
 */
function findResolved(baseline, currentViolations) {
  const currentSet = new Set(
    currentViolations.map(v => `${v.file}:${v.rule}`)
  );

  return (baseline.known || []).filter(k =>
    !currentSet.has(`${k.file}:${k.rule}`)
  );
}

/**
 * Calculate audit grade
 */
function calculateGrade(violations) {
  // Base score of 100, deduct based on severity
  let score = 100;
  const weights = { critical: 10, high: 5, medium: 2, low: 0.5 };

  for (const v of violations) {
    if (v.status !== 'ignored') {
      score -= weights[v.severity] || 1;
    }
  }

  score = Math.max(0, Math.round(score));

  let letter;
  if (score >= 90) letter = 'A';
  else if (score >= 80) letter = 'B+';
  else if (score >= 70) letter = 'B';
  else if (score >= 60) letter = 'C+';
  else if (score >= 50) letter = 'C';
  else letter = 'D';

  return { score, letter };
}

/**
 * Write report to file
 */
export function writeReport(content, scope) {
  const date = new Date().toISOString().split('T')[0];
  const scopeSlug = scope === 'full' ? 'full-codebase' : scope;
  const filename = `docs/_wip/audits/${date}-${scopeSlug}-audit.md`;

  writeFileSync(filename, content, 'utf-8');
  return filename;
}
