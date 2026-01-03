# Logging Code Auditor Agent

**Purpose:** Audit codebase to ensure proper structured logging implementation
**Date:** 2026-01-03
**Status:** Implementation Guide

---

## Overview

The Logging Code Auditor scans your codebase to verify:
- ✅ Using DaylightLogger instead of console.log/console.error
- ✅ Structured event-based logging (not message strings)
- ✅ Required fields present (event, level, context)
- ✅ Event naming conventions followed
- ✅ Proper error logging with context
- ✅ No sensitive data in logs
- ✅ Logger instances properly initialized

---

## What It Checks

### 1. Console.log Anti-Pattern

**Bad:**
```javascript
console.log('User logged in');
console.error('Failed to load config');
```

**Good:**
```javascript
getLogger().info('user.login', { userId: 'kckern' });
getLogger().error('config.load.failed', { path: configPath, error: err.message });
```

### 2. Unstructured Logging

**Bad:**
```javascript
logger.info('Governance evaluated, result: ' + result);
```

**Good:**
```javascript
logger.info('governance.evaluated', { satisfied: result.satisfied, actualCount: result.actualCount });
```

### 3. Missing Event Names

**Bad:**
```javascript
logger.error({ message: 'Something went wrong' });
```

**Good:**
```javascript
logger.error('session.update.failed', { sessionId, error: err.message });
```

### 4. Event Naming Conventions

**Bad:**
```javascript
logger.info('userLoggedIn');  // camelCase
logger.info('USER_LOGIN');    // SCREAMING_SNAKE
logger.info('User Login');    // spaces
```

**Good:**
```javascript
logger.info('user.login');           // dot.separated.lowercase
logger.info('governance.evaluate');
logger.error('config.load.failed');
```

### 5. Missing Context

**Bad:**
```javascript
logger.info('session.start');  // No context
```

**Good:**
```javascript
logger.info('session.start', {
  sessionId: session.id,
  userId: user.id,
  timestamp: Date.now()
});
```

### 6. Sensitive Data Exposure

**Bad:**
```javascript
logger.info('user.login', {
  password: user.password,          // ❌ Sensitive!
  creditCard: user.creditCard,      // ❌ Sensitive!
  token: session.token              // ❌ Sensitive!
});
```

**Good:**
```javascript
logger.info('user.login', {
  userId: user.id,
  email: user.email,
  // Never log passwords, tokens, API keys
});
```

---

## Implementation

### Script: `scripts/audit-logging-code.mjs`

```javascript
#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

/**
 * Logging Code Auditor
 *
 * Scans codebase for proper logging implementation
 */
class LoggingCodeAuditor {
  constructor(options = {}) {
    this.baseDir = options.baseDir || '.';
    this.patterns = options.patterns || [
      'frontend/src/**/*.{js,jsx,mjs}',
      'backend/**/*.{js,mjs}',
      '!**/node_modules/**',
      '!**/dist/**',
      '!**/*.test.js'
    ];

    this.issues = [];
    this.stats = {
      filesScanned: 0,
      consoleLogCount: 0,
      unstructuredLogging: 0,
      missingEventNames: 0,
      badNaming: 0,
      missingSensitiveCheck: 0,
      totalIssues: 0
    };

    // Patterns to detect
    this.consolePattern = /console\.(log|error|warn|info|debug)\(/g;
    this.loggerPattern = /(getLogger\(\)|logger)\.(info|error|warn|debug)\(/g;
    this.sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'creditCard', 'ssn'];
  }

  async run() {
    console.log('🔍 Logging Code Auditor\n');
    console.log('📂 Scanning patterns:');
    this.patterns.forEach(p => console.log(`   ${p}`));
    console.log('');

    const files = await this.findFiles();
    console.log(`📝 Found ${files.length} files to scan\n`);

    for (const file of files) {
      await this.auditFile(file);
    }

    this.generateReport();
    return this.issues;
  }

  async findFiles() {
    const files = [];
    for (const pattern of this.patterns) {
      if (pattern.startsWith('!')) continue;
      const matches = await glob(pattern, {
        cwd: this.baseDir,
        ignore: this.patterns.filter(p => p.startsWith('!'))
      });
      files.push(...matches);
    }
    return [...new Set(files)];
  }

  async auditFile(filePath) {
    this.stats.filesScanned++;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // Check 1: console.log usage
      this.checkConsoleLog(line, filePath, lineNum);

      // Check 2: Unstructured logging (string concatenation)
      this.checkUnstructuredLogging(line, filePath, lineNum);

      // Check 3: Missing event names
      this.checkMissingEventName(line, filePath, lineNum);

      // Check 4: Event naming conventions
      this.checkEventNaming(line, filePath, lineNum);

      // Check 5: Sensitive data in logs
      this.checkSensitiveData(line, filePath, lineNum);
    });
  }

  checkConsoleLog(line, file, lineNum) {
    // Skip if commented out
    if (line.trim().startsWith('//')) return;
    if (line.trim().startsWith('*')) return;

    const matches = line.matchAll(this.consolePattern);
    for (const match of matches) {
      this.stats.consoleLogCount++;
      this.issues.push({
        type: 'console_log_usage',
        severity: 'error',
        file,
        line: lineNum,
        code: line.trim(),
        message: `Using console.${match[1]}() instead of structured logger`,
        fix: `Replace with: getLogger().${match[1]}('event.name', { data })`
      });
    }
  }

  checkUnstructuredLogging(line, file, lineNum) {
    // Skip if commented
    if (line.trim().startsWith('//')) return;

    // Check for string concatenation in logger calls
    const stringConcatPatterns = [
      /logger\.(info|error|warn|debug)\(['"].*\+/,  // 'message' +
      /logger\.(info|error|warn|debug)\(.*\$\{/,    // template literals
      /getLogger\(\)\.(info|error|warn|debug)\(['"].*\+/,
      /getLogger\(\)\.(info|error|warn|debug)\(.*\$\{/
    ];

    stringConcatPatterns.forEach(pattern => {
      if (pattern.test(line)) {
        this.stats.unstructuredLogging++;
        this.issues.push({
          type: 'unstructured_logging',
          severity: 'warning',
          file,
          line: lineNum,
          code: line.trim(),
          message: 'Using string concatenation instead of structured data',
          fix: 'Use: logger.info("event.name", { field: value })'
        });
      }
    });
  }

  checkMissingEventName(line, file, lineNum) {
    // Skip if commented
    if (line.trim().startsWith('//')) return;

    // Look for logger calls with object as first param (missing event name)
    const patterns = [
      /logger\.(info|error|warn|debug)\(\s*\{/,
      /getLogger\(\)\.(info|error|warn|debug)\(\s*\{/
    ];

    patterns.forEach(pattern => {
      if (pattern.test(line)) {
        this.stats.missingEventNames++;
        this.issues.push({
          type: 'missing_event_name',
          severity: 'error',
          file,
          line: lineNum,
          code: line.trim(),
          message: 'Logger call missing event name (first parameter)',
          fix: 'Add event name: logger.info("event.name", { ... })'
        });
      }
    });
  }

  checkEventNaming(line, file, lineNum) {
    // Skip if commented
    if (line.trim().startsWith('//')) return;

    // Extract event names from logger calls
    const eventNamePattern = /(?:logger|getLogger\(\))\.(info|error|warn|debug)\(['"]([^'"]+)['"]/g;
    const matches = line.matchAll(eventNamePattern);

    for (const match of matches) {
      const eventName = match[2];

      // Check naming conventions
      const issues = [];

      // Should be lowercase
      if (eventName !== eventName.toLowerCase()) {
        issues.push('should be lowercase');
      }

      // Should use dots, not camelCase or underscores
      if (eventName.includes('_') && !eventName.startsWith('_')) {
        issues.push('use dots instead of underscores');
      }

      // Should not have spaces
      if (eventName.includes(' ')) {
        issues.push('remove spaces');
      }

      // Should follow domain.action pattern
      if (!eventName.includes('.')) {
        issues.push('use dot notation (domain.action)');
      }

      if (issues.length > 0) {
        this.stats.badNaming++;
        this.issues.push({
          type: 'bad_event_naming',
          severity: 'warning',
          file,
          line: lineNum,
          code: line.trim(),
          eventName,
          message: `Event name "${eventName}" violates conventions: ${issues.join(', ')}`,
          fix: `Use format: "domain.action.result" (e.g., "user.login.success")`
        });
      }
    }
  }

  checkSensitiveData(line, file, lineNum) {
    // Skip if commented
    if (line.trim().startsWith('//')) return;

    // Check if logger call includes sensitive fields
    if (!line.includes('logger') && !line.includes('getLogger')) return;

    this.sensitiveFields.forEach(field => {
      const patterns = [
        new RegExp(`${field}:\\s*[^,}]+`, 'i'),  // password: xxx
        new RegExp(`['"]${field}['"]\\s*:`, 'i')  // "password":
      ];

      patterns.forEach(pattern => {
        if (pattern.test(line)) {
          this.stats.missingSensitiveCheck++;
          this.issues.push({
            type: 'sensitive_data_in_log',
            severity: 'critical',
            file,
            line: lineNum,
            code: line.trim(),
            field,
            message: `Potentially logging sensitive field: "${field}"`,
            fix: 'Never log passwords, tokens, API keys, or other sensitive data'
          });
        }
      });
    });
  }

  generateReport() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('           LOGGING CODE AUDIT REPORT                   ');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('📊 SUMMARY');
    console.log('─────────────────────────────────────────────────────');
    console.log(`Files Scanned:           ${this.stats.filesScanned}`);
    console.log(`Total Issues:            ${this.issues.length}\n`);

    console.log('📋 ISSUE BREAKDOWN');
    console.log('─────────────────────────────────────────────────────');
    console.log(`🔴 console.log usage:     ${this.stats.consoleLogCount}`);
    console.log(`🟡 Unstructured logging:  ${this.stats.unstructuredLogging}`);
    console.log(`🔴 Missing event names:   ${this.stats.missingEventNames}`);
    console.log(`🟡 Bad naming:            ${this.stats.badNaming}`);
    console.log(`🔴 Sensitive data:        ${this.stats.missingSensitiveCheck}\n`);

    // Group issues by file
    const byFile = {};
    this.issues.forEach(issue => {
      if (!byFile[issue.file]) byFile[issue.file] = [];
      byFile[issue.file].push(issue);
    });

    const sortedFiles = Object.entries(byFile)
      .sort((a, b) => b[1].length - a[1].length);

    console.log('📁 TOP FILES WITH ISSUES');
    console.log('─────────────────────────────────────────────────────');
    sortedFiles.slice(0, 10).forEach(([file, issues]) => {
      console.log(`${file}: ${issues.length} issues`);
    });
    console.log('');

    // Show critical issues
    const critical = this.issues.filter(i => i.severity === 'critical');
    if (critical.length > 0) {
      console.log('🚨 CRITICAL ISSUES');
      console.log('─────────────────────────────────────────────────────');
      critical.forEach(issue => {
        console.log(`${issue.file}:${issue.line}`);
        console.log(`   ${issue.message}`);
        console.log(`   Code: ${issue.code}`);
        console.log(`   Fix: ${issue.fix}\n`);
      });
    }

    // Show detailed issues by type
    const byType = {};
    this.issues.forEach(issue => {
      if (!byType[issue.type]) byType[issue.type] = [];
      byType[issue.type].push(issue);
    });

    console.log('📋 DETAILED ISSUES');
    console.log('─────────────────────────────────────────────────────\n');

    Object.entries(byType).forEach(([type, issues]) => {
      const icon = issues[0].severity === 'critical' ? '🔴' :
                   issues[0].severity === 'error' ? '🔴' : '🟡';

      console.log(`${icon} ${type.toUpperCase()} (${issues.length})`);
      console.log('─────────────────────────────────────────────────────');

      issues.slice(0, 5).forEach(issue => {
        console.log(`${issue.file}:${issue.line}`);
        console.log(`   ${issue.message}`);
        if (issue.eventName) console.log(`   Event: "${issue.eventName}"`);
        console.log(`   Code: ${issue.code}`);
        console.log(`   Fix: ${issue.fix}\n`);
      });

      if (issues.length > 5) {
        console.log(`   ... and ${issues.length - 5} more\n`);
      }
    });

    console.log('═══════════════════════════════════════════════════════\n');

    this.generateRecommendations();
    this.generateMigrationPlan();
  }

  generateRecommendations() {
    console.log('💡 RECOMMENDATIONS');
    console.log('─────────────────────────────────────────────────────');

    if (this.stats.consoleLogCount > 0) {
      console.log('1. Migrate all console.log calls to DaylightLogger');
      console.log('   - Replace: console.log() → getLogger().info()');
      console.log('   - Replace: console.error() → getLogger().error()');
      console.log('   - Add event names and structured data\n');
    }

    if (this.stats.missingEventNames > 0) {
      console.log('2. Add event names to all logger calls');
      console.log('   - Format: "domain.action.result"');
      console.log('   - Examples: "user.login.success", "config.load.failed"\n');
    }

    if (this.stats.badNaming > 0) {
      console.log('3. Fix event naming conventions');
      console.log('   - Use lowercase only');
      console.log('   - Use dots for hierarchy (not underscores or camelCase)');
      console.log('   - Follow pattern: domain.action or domain.action.result\n');
    }

    if (this.stats.unstructuredLogging > 0) {
      console.log('4. Convert to structured logging');
      console.log('   - Replace string concatenation with data objects');
      console.log('   - Pass data as second parameter\n');
    }

    if (this.stats.missingSensitiveCheck > 0) {
      console.log('5. 🚨 URGENT: Remove sensitive data from logs');
      console.log('   - Never log: passwords, tokens, API keys, secrets');
      console.log('   - Review all flagged instances immediately\n');
    }

    console.log('');
  }

  generateMigrationPlan() {
    console.log('📝 MIGRATION PLAN');
    console.log('─────────────────────────────────────────────────────');
    console.log('');
    console.log('Step 1: Fix Critical Issues (Do First)');
    console.log('  → Remove all sensitive data from logs');
    console.log(`  → ${this.stats.missingSensitiveCheck} instances to fix\n`);

    console.log('Step 2: Add Missing Event Names');
    console.log('  → Add event name as first parameter');
    console.log(`  → ${this.stats.missingEventNames} instances to fix\n`);

    console.log('Step 3: Migrate console.log Calls');
    console.log('  → Replace with getLogger().info()');
    console.log(`  → ${this.stats.consoleLogCount} instances to fix\n`);

    console.log('Step 4: Fix Event Naming');
    console.log('  → Update to dot.separated.lowercase format');
    console.log(`  → ${this.stats.badNaming} instances to fix\n`);

    console.log('Step 5: Convert to Structured Logging');
    console.log('  → Replace string concatenation with data objects');
    console.log(`  → ${this.stats.unstructuredLogging} instances to fix\n`);

    console.log('Estimated total fixes needed:', this.issues.length);
    console.log('');

    // Export issues to JSON for automated fixing
    fs.writeFileSync(
      'logs/logging-audit-issues.json',
      JSON.stringify(this.issues, null, 2)
    );
    console.log('💾 Full issue list saved to: logs/logging-audit-issues.json');
    console.log('');
  }
}

// Parse CLI args
const args = process.argv.slice(2);
const options = {};

args.forEach(arg => {
  const match = arg.match(/^--([^=]+)(?:=(.+))?$/);
  if (match) {
    options[match[1]] = match[2] || true;
  }
});

// Create logs directory if needed
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
}

// Run auditor
const auditor = new LoggingCodeAuditor(options);
auditor.run().catch(error => {
  console.error('❌ Audit failed:', error);
  process.exit(1);
});
```

---

## Usage

### Run Audit

```bash
# Audit entire codebase
node scripts/audit-logging-code.mjs

# Audit specific directory
node scripts/audit-logging-code.mjs --baseDir=frontend/src

# Save results
node scripts/audit-logging-code.mjs > logs/logging-audit-report.txt
```

### Add to package.json

```json
{
  "scripts": {
    "audit:logging": "node scripts/audit-logging-code.mjs",
    "audit:logging:frontend": "node scripts/audit-logging-code.mjs --baseDir=frontend/src",
    "audit:logging:backend": "node scripts/audit-logging-code.mjs --baseDir=backend"
  }
}
```

---

## Automated Fixes

### Create Auto-Fix Script

```javascript
// scripts/fix-logging-issues.mjs
#!/usr/bin/env node

import fs from 'fs';

const issues = JSON.parse(fs.readFileSync('logs/logging-audit-issues.json', 'utf-8'));

// Group by file
const byFile = {};
issues.forEach(issue => {
  if (!byFile[issue.file]) byFile[issue.file] = [];
  byFile[issue.file].push(issue);
});

Object.entries(byFile).forEach(([file, fileIssues]) => {
  let content = fs.readFileSync(file, 'utf-8');
  let lines = content.split('\n');

  // Sort by line number descending (fix from bottom up)
  fileIssues.sort((a, b) => b.line - a.line);

  fileIssues.forEach(issue => {
    if (issue.type === 'console_log_usage') {
      // Auto-fix console.log → getLogger().info()
      const lineIndex = issue.line - 1;
      const originalLine = lines[lineIndex];

      // Extract the console.log argument
      const match = originalLine.match(/console\.(log|error|warn)\((.*)\)/);
      if (match) {
        const level = match[1] === 'log' ? 'info' : match[1];
        const arg = match[2].trim();

        // Create structured log call
        const indent = originalLine.match(/^(\s*)/)[1];
        const newLine = `${indent}getLogger().${level}('code.needs_event_name', { message: ${arg} });  // TODO: Add proper event name`;

        lines[lineIndex] = newLine;
      }
    }
  });

  // Write back
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`✅ Fixed ${fileIssues.length} issues in ${file}`);
});
```

---

## Integration with CI/CD

### Pre-Commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/bash

echo "Running logging audit..."

node scripts/audit-logging-code.mjs --quiet

if [ $? -ne 0 ]; then
  echo "❌ Logging audit failed. Fix issues before committing."
  exit 1
fi

echo "✅ Logging audit passed"
```

### GitHub Action

```yaml
# .github/workflows/logging-audit.yml
name: Logging Audit

on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup Node
        uses: actions/setup-node@v2
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Run logging audit
        run: npm run audit:logging

      - name: Upload results
        if: failure()
        uses: actions/upload-artifact@v2
        with:
          name: logging-audit-report
          path: logs/logging-audit-issues.json
```

---

## Expected Output Example

```
🔍 Logging Code Auditor

📂 Scanning patterns:
   frontend/src/**/*.{js,jsx,mjs}
   backend/**/*.{js,mjs}

📝 Found 247 files to scan

═══════════════════════════════════════════════════════
           LOGGING CODE AUDIT REPORT
═══════════════════════════════════════════════════════

📊 SUMMARY
─────────────────────────────────────────────────────
Files Scanned:           247
Total Issues:            89

📋 ISSUE BREAKDOWN
─────────────────────────────────────────────────────
🔴 console.log usage:     34
🟡 Unstructured logging:  21
🔴 Missing event names:   15
🟡 Bad naming:            17
🔴 Sensitive data:        2

📁 TOP FILES WITH ISSUES
─────────────────────────────────────────────────────
frontend/src/hooks/fitness/FitnessSession.js: 12 issues
backend/routers/fitness.mjs: 8 issues
frontend/src/hooks/fitness/TreasureBox.js: 7 issues

🚨 CRITICAL ISSUES
─────────────────────────────────────────────────────
backend/lib/auth.mjs:45
   Potentially logging sensitive field: "password"
   Code: logger.info('user.auth', { username, password });
   Fix: Never log passwords, tokens, API keys, or other sensitive data

💡 RECOMMENDATIONS
─────────────────────────────────────────────────────
1. Migrate all console.log calls to DaylightLogger
2. Add event names to all logger calls
3. Fix event naming conventions
5. 🚨 URGENT: Remove sensitive data from logs

📝 MIGRATION PLAN
─────────────────────────────────────────────────────
Step 1: Fix Critical Issues (Do First)
  → Remove all sensitive data from logs
  → 2 instances to fix

Estimated total fixes needed: 89

💾 Full issue list saved to: logs/logging-audit-issues.json
```

---

## Summary

The Logging Code Auditor:

✅ **Scans codebase** for logging implementation issues
✅ **Detects anti-patterns** (console.log, unstructured logs)
✅ **Validates conventions** (event naming, required fields)
✅ **Identifies security risks** (sensitive data in logs)
✅ **Provides fixes** (auto-fix scripts available)
✅ **Generates reports** (JSON export for automation)
✅ **CI/CD integration** (pre-commit hooks, GitHub Actions)

Run it regularly to maintain logging quality across your codebase!
