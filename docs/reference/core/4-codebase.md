# Harvester Testing Guide

> **Related code:** `backend/tests/harvest.test.mjs`, `backend/tests/harvest.integration.test.mjs`, `backend/routers/harvest.js`

Comprehensive unit and integration tests for all 19 harvesters. Tests run without requiring a server, external APIs, or credentials.

---

## Quick Start

```bash
cd backend

# Run all harvester tests
npm run test:harvest

# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## Test Files

| File | Purpose |
|------|---------|
| `harvest.test.mjs` | Unit tests - initialization, logging, error handling |
| `harvest.integration.test.mjs` | Integration tests - data structures, transformations |

## Covered Harvesters

Todoist, Gmail, Google Calendar, Withings, LDSGC, Weather, Scripture, ClickUp, Last.fm, Letterboxd, Goodreads, Budget, YouTube-DL, Fitness, Strava, Health, Garmin, Payroll, Infinity

## Running Specific Tests

```bash
# Single harvester
npx jest -t "Todoist"

# Integration tests only
npx jest harvest.integration.test.mjs

# Verbose output
npx jest --verbose harvest.test.mjs
```

## Test Features

- **Zero Setup** - No credentials, API keys, or external services needed
- **Fast Execution** - ~0.5-1 second total runtime
- **Full Mocking** - Logger, HTTP client, request/response, file I/O

### Test Utilities

```javascript
createMockLogger()   // Logger with spied methods
createMockRequest()  // Express request mock
createMockResponse() // Express response mock
```

## Extending Tests

```javascript
describe('New Harvester', () => {
  let mockLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    jest.clearAllMocks();
  });

  test('should initialize successfully', () => {
    expect(mockLogger).toBeDefined();
  });

  test('should fetch data', () => {
    const mockData = [];
    expect(Array.isArray(mockData)).toBe(true);
  });
});
```

## CI/CD Integration

```yaml
- name: Run Harvester Tests
  run: |
    cd backend
    npm install
    npm run test:harvest
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Tests won't run | `npx jest --clearCache && npm install` |
| Module not found | Check jest.config.js paths |
| Tests hang | Check for unresolved promises |

## Stats

- **100+ tests** across 2 files
- **19 harvesters** covered
- **<1 second** execution time
- **0 external dependencies** (all mocked)
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
# Logging Auditor Agent Implementation Guide

**Purpose:** Create a specialized agent to audit, analyze, and monitor DaylightStation logs
**Date:** 2026-01-03
**Status:** Implementation Guide

---

## Overview

The Logging Auditor Agent is a specialized tool that:
- Analyzes log files for patterns and anomalies
- Detects missing or incomplete log events
- Validates logging compliance (structured format, required fields)
- Identifies performance issues from log data
- Generates audit reports
- Monitors production logs in real-time

---

## Implementation Options

### Option 1: Claude Code Skill (Recommended)

Create a custom skill that can be invoked with `/audit-logs` command.

**Pros:**
- Integrated with Claude Code workflow
- Easy to invoke during debugging
- Can interact with user for clarification
- Access to all Claude Code tools

**Cons:**
- Runs on-demand only (not continuous monitoring)

### Option 2: Background Monitoring Service

Create a Node.js service that continuously monitors logs.

**Pros:**
- Real-time monitoring
- Automated alerts
- Scheduled audits
- Persistent analysis

**Cons:**
- Separate process to manage
- More complex setup

### Option 3: MCP Server

Create a Model Context Protocol server for log analysis.

**Pros:**
- Reusable across different Claude applications
- Standardized interface
- Can provide continuous monitoring

**Cons:**
- Requires MCP server setup
- More complex architecture

---

## Option 1: Claude Code Skill Implementation

### Step 1: Create Skill Directory

```bash
mkdir -p .claude/skills/audit-logs
```

### Step 2: Create Skill Configuration

**File:** `.claude/skills/audit-logs/skill.json`

```json
{
  "name": "audit-logs",
  "description": "Audit and analyze DaylightStation logs for patterns, errors, and compliance",
  "version": "1.0.0",
  "author": "DaylightStation Team",
  "parameters": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["errors", "performance", "compliance", "full", "custom"],
        "description": "Audit mode",
        "default": "full"
      },
      "timeRange": {
        "type": "string",
        "description": "Time range to audit (e.g., '1h', '24h', 'today', 'all')",
        "default": "1h"
      },
      "logFile": {
        "type": "string",
        "description": "Path to log file (default: dev.log)",
        "default": "dev.log"
      },
      "eventFilter": {
        "type": "string",
        "description": "Filter by event pattern (regex)",
        "default": null
      },
      "format": {
        "type": "string",
        "enum": ["summary", "detailed", "json"],
        "description": "Output format",
        "default": "summary"
      }
    }
  }
}
```

### Step 3: Create Skill Implementation

**File:** `.claude/skills/audit-logs/index.mjs`

```javascript
#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Logging Auditor Agent
 *
 * Analyzes DaylightStation logs for patterns, errors, and compliance
 */
class LoggingAuditor {
  constructor(options = {}) {
    this.logFile = options.logFile || 'dev.log';
    this.mode = options.mode || 'full';
    this.timeRange = options.timeRange || '1h';
    this.eventFilter = options.eventFilter || null;
    this.format = options.format || 'summary';

    this.results = {
      summary: {},
      errors: [],
      warnings: [],
      anomalies: [],
      performance: [],
      compliance: [],
      patterns: {}
    };
  }

  /**
   * Run the audit
   */
  async run() {
    console.log('🔍 DaylightStation Logging Auditor');
    console.log(`📊 Mode: ${this.mode}`);
    console.log(`⏰ Time Range: ${this.timeRange}`);
    console.log(`📁 Log File: ${this.logFile}`);
    console.log('');

    // Read log file
    const logs = await this.readLogs();

    // Filter by time range
    const filteredLogs = this.filterByTimeRange(logs);

    console.log(`📝 Analyzing ${filteredLogs.length} log entries...`);
    console.log('');

    // Run audit based on mode
    switch (this.mode) {
      case 'errors':
        this.auditErrors(filteredLogs);
        break;
      case 'performance':
        this.auditPerformance(filteredLogs);
        break;
      case 'compliance':
        this.auditCompliance(filteredLogs);
        break;
      case 'custom':
        this.auditCustomPattern(filteredLogs);
        break;
      case 'full':
      default:
        this.auditErrors(filteredLogs);
        this.auditWarnings(filteredLogs);
        this.auditPerformance(filteredLogs);
        this.auditCompliance(filteredLogs);
        this.auditPatterns(filteredLogs);
        this.detectAnomalies(filteredLogs);
        break;
    }

    // Generate report
    this.generateReport();

    return this.results;
  }

  /**
   * Read and parse log file
   */
  async readLogs() {
    try {
      const content = fs.readFileSync(this.logFile, 'utf-8');
      const lines = content.trim().split('\n');

      return lines
        .filter(line => line.trim())
        .map((line, index) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return {
              _parseError: true,
              _lineNumber: index + 1,
              _raw: line,
              timestamp: null,
              event: 'parse_error',
              level: 'error',
              message: `Failed to parse JSON: ${e.message}`
            };
          }
        });
    } catch (error) {
      console.error(`❌ Failed to read log file: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Filter logs by time range
   */
  filterByTimeRange(logs) {
    if (this.timeRange === 'all') return logs;

    const now = Date.now();
    let cutoff;

    const match = this.timeRange.match(/^(\d+)(h|m|d)$/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];

      const multipliers = { m: 60000, h: 3600000, d: 86400000 };
      cutoff = now - (value * multipliers[unit]);
    } else if (this.timeRange === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      cutoff = today.getTime();
    } else {
      // Default to 1 hour
      cutoff = now - 3600000;
    }

    return logs.filter(log => {
      if (!log.timestamp) return true; // Include logs without timestamp
      const logTime = new Date(log.timestamp).getTime();
      return logTime >= cutoff;
    });
  }

  /**
   * Audit: Errors
   */
  auditErrors(logs) {
    const errors = logs.filter(log => log.level === 'error');

    this.results.errors = errors.map(log => ({
      timestamp: log.timestamp,
      event: log.event,
      message: log.message || log.data?.message,
      context: log.context,
      data: log.data
    }));

    // Group by event type
    const errorsByEvent = {};
    errors.forEach(log => {
      const event = log.event || 'unknown';
      if (!errorsByEvent[event]) {
        errorsByEvent[event] = [];
      }
      errorsByEvent[event].push(log);
    });

    this.results.summary.errorCount = errors.length;
    this.results.summary.errorsByEvent = Object.entries(errorsByEvent)
      .map(([event, logs]) => ({ event, count: logs.length }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Audit: Warnings
   */
  auditWarnings(logs) {
    const warnings = logs.filter(log => log.level === 'warn');

    this.results.warnings = warnings.map(log => ({
      timestamp: log.timestamp,
      event: log.event,
      message: log.message || log.data?.message,
      context: log.context
    }));

    this.results.summary.warningCount = warnings.length;
  }

  /**
   * Audit: Performance Issues
   */
  auditPerformance(logs) {
    const performanceIssues = [];

    // Look for slow operations (durationMs > 1000)
    logs.forEach(log => {
      const duration = log.data?.durationMs || log.durationMs;
      if (duration && duration > 1000) {
        performanceIssues.push({
          timestamp: log.timestamp,
          event: log.event,
          duration,
          context: log.context
        });
      }
    });

    // Look for high-frequency events (possible performance issue)
    const eventCounts = {};
    logs.forEach(log => {
      const event = log.event || 'unknown';
      eventCounts[event] = (eventCounts[event] || 0) + 1;
    });

    const highFrequencyEvents = Object.entries(eventCounts)
      .filter(([_, count]) => count > 100)
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count);

    this.results.performance = performanceIssues;
    this.results.summary.slowOperations = performanceIssues.length;
    this.results.summary.highFrequencyEvents = highFrequencyEvents;
  }

  /**
   * Audit: Logging Compliance
   */
  auditCompliance(logs) {
    const issues = [];

    logs.forEach((log, index) => {
      // Check for required fields
      if (!log.timestamp) {
        issues.push({
          line: index + 1,
          type: 'missing_timestamp',
          severity: 'error',
          message: 'Log entry missing timestamp'
        });
      }

      if (!log.event) {
        issues.push({
          line: index + 1,
          type: 'missing_event',
          severity: 'error',
          message: 'Log entry missing event name'
        });
      }

      if (!log.level) {
        issues.push({
          line: index + 1,
          type: 'missing_level',
          severity: 'warning',
          message: 'Log entry missing log level'
        });
      }

      // Check for parse errors
      if (log._parseError) {
        issues.push({
          line: log._lineNumber,
          type: 'parse_error',
          severity: 'error',
          message: 'Failed to parse JSON',
          raw: log._raw
        });
      }

      // Check for console.log instead of structured logging
      if (log.event === 'console.log' || log.event === 'console.error') {
        issues.push({
          line: index + 1,
          type: 'unstructured_logging',
          severity: 'warning',
          message: 'Using console.log instead of structured logger',
          event: log.event
        });
      }
    });

    this.results.compliance = issues;
    this.results.summary.complianceIssues = issues.length;
  }

  /**
   * Audit: Event Patterns
   */
  auditPatterns(logs) {
    const patterns = {};

    // Count events by type
    logs.forEach(log => {
      const event = log.event || 'unknown';
      if (!patterns[event]) {
        patterns[event] = {
          count: 0,
          levels: {},
          contexts: {}
        };
      }

      patterns[event].count++;

      const level = log.level || 'unknown';
      patterns[event].levels[level] = (patterns[event].levels[level] || 0) + 1;

      const context = log.context?.app || 'unknown';
      patterns[event].contexts[context] = (patterns[event].contexts[context] || 0) + 1;
    });

    this.results.patterns = patterns;

    // Top 10 most frequent events
    this.results.summary.topEvents = Object.entries(patterns)
      .map(([event, data]) => ({ event, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Detect Anomalies
   */
  detectAnomalies(logs) {
    const anomalies = [];

    // Detect: Missing expected events in sequence
    // Example: governance.evaluate.called without governance.evaluate.inputs
    const governanceInputs = logs.filter(l => l.event === 'governance.evaluate.inputs');
    const governanceCalled = logs.filter(l => l.event === 'governance.evaluate.called');

    if (governanceInputs.length > 0 && governanceCalled.length === 0) {
      anomalies.push({
        type: 'missing_event_sequence',
        description: 'Found governance.evaluate.inputs but no governance.evaluate.called',
        severity: 'warning',
        count: governanceInputs.length
      });
    }

    // Detect: Sudden spike in errors
    const errors = logs.filter(l => l.level === 'error');
    if (errors.length > 10) {
      const timestamps = errors.map(e => new Date(e.timestamp).getTime());
      const avgTimeDiff = timestamps.reduce((sum, t, i, arr) => {
        if (i === 0) return sum;
        return sum + (t - arr[i - 1]);
      }, 0) / (timestamps.length - 1);

      if (avgTimeDiff < 1000) { // Errors within 1 second of each other
        anomalies.push({
          type: 'error_spike',
          description: 'Detected spike in error rate (multiple errors per second)',
          severity: 'critical',
          count: errors.length,
          avgTimeBetween: `${avgTimeDiff.toFixed(0)}ms`
        });
      }
    }

    // Detect: Missing required log events
    const hasSessionStart = logs.some(l => l.event === 'session.start');
    const hasSessionEnd = logs.some(l => l.event === 'session.end');

    if (hasSessionStart && !hasSessionEnd) {
      anomalies.push({
        type: 'incomplete_session',
        description: 'Session started but never ended',
        severity: 'warning'
      });
    }

    this.results.anomalies = anomalies;
    this.results.summary.anomalyCount = anomalies.length;
  }

  /**
   * Audit custom pattern (regex filter)
   */
  auditCustomPattern(logs) {
    if (!this.eventFilter) {
      console.log('⚠️  No custom pattern specified. Use --eventFilter=<regex>');
      return;
    }

    const pattern = new RegExp(this.eventFilter);
    const matches = logs.filter(log => {
      return pattern.test(log.event) ||
             pattern.test(JSON.stringify(log.data));
    });

    console.log(`🔍 Custom Pattern: ${this.eventFilter}`);
    console.log(`📊 Matches: ${matches.length}`);
    console.log('');

    matches.slice(0, 20).forEach(log => {
      console.log(`[${log.timestamp}] ${log.event}`);
      console.log(`   Level: ${log.level}`);
      console.log(`   Data: ${JSON.stringify(log.data || {}).substring(0, 100)}...`);
      console.log('');
    });
  }

  /**
   * Generate report
   */
  generateReport() {
    if (this.format === 'json') {
      console.log(JSON.stringify(this.results, null, 2));
      return;
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('                 AUDIT REPORT SUMMARY                  ');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // Summary
    console.log('📊 SUMMARY');
    console.log('─────────────────────────────────────────────────────');
    console.log(`Errors:              ${this.results.summary.errorCount || 0}`);
    console.log(`Warnings:            ${this.results.summary.warningCount || 0}`);
    console.log(`Anomalies:           ${this.results.summary.anomalyCount || 0}`);
    console.log(`Compliance Issues:   ${this.results.summary.complianceIssues || 0}`);
    console.log(`Slow Operations:     ${this.results.summary.slowOperations || 0}`);
    console.log('');

    // Errors
    if (this.results.errors.length > 0) {
      console.log('🔴 ERRORS');
      console.log('─────────────────────────────────────────────────────');

      if (this.format === 'detailed') {
        this.results.errors.slice(0, 10).forEach(err => {
          console.log(`[${err.timestamp}] ${err.event}`);
          console.log(`   ${err.message || 'No message'}`);
          if (err.data) {
            console.log(`   Data: ${JSON.stringify(err.data).substring(0, 100)}...`);
          }
          console.log('');
        });
      } else {
        this.results.summary.errorsByEvent.slice(0, 5).forEach(({ event, count }) => {
          console.log(`   ${event}: ${count}`);
        });
      }
      console.log('');
    }

    // Anomalies
    if (this.results.anomalies.length > 0) {
      console.log('⚠️  ANOMALIES DETECTED');
      console.log('─────────────────────────────────────────────────────');
      this.results.anomalies.forEach(anomaly => {
        const icon = anomaly.severity === 'critical' ? '🔴' : '🟡';
        console.log(`${icon} ${anomaly.type.toUpperCase()}`);
        console.log(`   ${anomaly.description}`);
        if (anomaly.count) console.log(`   Count: ${anomaly.count}`);
        console.log('');
      });
    }

    // Performance
    if (this.results.performance.length > 0) {
      console.log('🐌 PERFORMANCE ISSUES');
      console.log('─────────────────────────────────────────────────────');
      this.results.performance.slice(0, 5).forEach(perf => {
        console.log(`[${perf.timestamp}] ${perf.event}`);
        console.log(`   Duration: ${perf.duration}ms`);
        console.log('');
      });
    }

    // High-frequency events
    if (this.results.summary.highFrequencyEvents?.length > 0) {
      console.log('📈 HIGH-FREQUENCY EVENTS');
      console.log('─────────────────────────────────────────────────────');
      this.results.summary.highFrequencyEvents.slice(0, 5).forEach(({ event, count }) => {
        console.log(`   ${event}: ${count} occurrences`);
      });
      console.log('');
    }

    // Top events
    if (this.results.summary.topEvents?.length > 0) {
      console.log('🔝 TOP EVENTS');
      console.log('─────────────────────────────────────────────────────');
      this.results.summary.topEvents.forEach(({ event, count }) => {
        console.log(`   ${event}: ${count}`);
      });
      console.log('');
    }

    // Compliance
    if (this.results.compliance.length > 0) {
      console.log('📋 COMPLIANCE ISSUES');
      console.log('─────────────────────────────────────────────────────');

      const grouped = {};
      this.results.compliance.forEach(issue => {
        if (!grouped[issue.type]) grouped[issue.type] = [];
        grouped[issue.type].push(issue);
      });

      Object.entries(grouped).forEach(([type, issues]) => {
        console.log(`   ${type}: ${issues.length} issues`);
      });
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // Recommendations
    this.generateRecommendations();
  }

  /**
   * Generate recommendations
   */
  generateRecommendations() {
    const recommendations = [];

    if (this.results.errors.length > 5) {
      recommendations.push('🔴 High error rate detected - investigate root causes immediately');
    }

    if (this.results.compliance.filter(i => i.type === 'parse_error').length > 0) {
      recommendations.push('⚠️  Log parse errors found - check for malformed JSON in logs');
    }

    if (this.results.compliance.filter(i => i.type === 'unstructured_logging').length > 0) {
      recommendations.push('📝 Unstructured logging detected - migrate to DaylightLogger');
    }

    if (this.results.performance.length > 10) {
      recommendations.push('🐌 Multiple slow operations - profile and optimize');
    }

    if (this.results.anomalies.some(a => a.type === 'error_spike')) {
      recommendations.push('🚨 Error spike detected - may indicate system instability');
    }

    if (recommendations.length > 0) {
      console.log('💡 RECOMMENDATIONS');
      console.log('─────────────────────────────────────────────────────');
      recommendations.forEach(rec => console.log(rec));
      console.log('');
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

args.forEach(arg => {
  const match = arg.match(/^--([^=]+)(?:=(.+))?$/);
  if (match) {
    const key = match[1];
    const value = match[2] || true;
    options[key] = value;
  }
});

// Run auditor
const auditor = new LoggingAuditor(options);
auditor.run().catch(error => {
  console.error('❌ Audit failed:', error);
  process.exit(1);
});
```

### Step 4: Make Executable

```bash
chmod +x .claude/skills/audit-logs/index.mjs
```

### Step 5: Usage

```bash
# Run from Claude Code
/audit-logs

# With options
/audit-logs --mode=errors --timeRange=24h
/audit-logs --mode=performance --format=detailed
/audit-logs --mode=custom --eventFilter="governance.*"

# Or run directly
node .claude/skills/audit-logs/index.mjs --mode=errors
```

---

## Option 2: Background Monitoring Service

### Create Monitoring Service

**File:** `scripts/log-monitor.mjs`

```javascript
#!/usr/bin/env node

import fs from 'fs';
import { Tail } from 'tail';
import { LoggingAuditor } from '../.claude/skills/audit-logs/index.mjs';

/**
 * Background Log Monitoring Service
 *
 * Continuously monitors logs and triggers alerts
 */
class LogMonitor {
  constructor(logFile = 'dev.log') {
    this.logFile = logFile;
    this.tail = null;
    this.buffer = [];
    this.alertThresholds = {
      errorRate: 10, // errors per minute
      warningRate: 20,
      slowOperation: 1000 // ms
    };
    this.errorCount = 0;
    this.warningCount = 0;
    this.startTime = Date.now();
  }

  start() {
    console.log('🔍 Starting log monitor...');
    console.log(`📁 Watching: ${this.logFile}`);
    console.log('');

    // Watch log file for changes
    this.tail = new Tail(this.logFile);

    this.tail.on('line', (line) => {
      this.processLine(line);
    });

    this.tail.on('error', (error) => {
      console.error('❌ Tail error:', error);
    });

    // Run periodic audits
    setInterval(() => {
      this.runPeriodicAudit();
    }, 60000); // Every minute

    console.log('✅ Monitor started');
  }

  processLine(line) {
    try {
      const log = JSON.parse(line);

      // Check for errors
      if (log.level === 'error') {
        this.errorCount++;
        this.alertError(log);
      }

      // Check for warnings
      if (log.level === 'warn') {
        this.warningCount++;
      }

      // Check for slow operations
      const duration = log.data?.durationMs || log.durationMs;
      if (duration && duration > this.alertThresholds.slowOperation) {
        this.alertSlowOperation(log, duration);
      }

      this.buffer.push(log);

      // Keep buffer size manageable
      if (this.buffer.length > 1000) {
        this.buffer = this.buffer.slice(-500);
      }

    } catch (e) {
      // Not JSON, skip
    }
  }

  alertError(log) {
    console.log('');
    console.log('🔴 ERROR DETECTED');
    console.log(`Event: ${log.event}`);
    console.log(`Time: ${log.timestamp}`);
    console.log(`Message: ${log.message || JSON.stringify(log.data)}`);
    console.log('');

    // Check error rate
    const runtime = (Date.now() - this.startTime) / 60000; // minutes
    const errorRate = this.errorCount / runtime;

    if (errorRate > this.alertThresholds.errorRate) {
      console.log('🚨 ALERT: Error rate exceeds threshold!');
      console.log(`   Rate: ${errorRate.toFixed(2)} errors/min`);
      console.log(`   Threshold: ${this.alertThresholds.errorRate} errors/min`);
      console.log('');
    }
  }

  alertSlowOperation(log, duration) {
    console.log('');
    console.log('🐌 SLOW OPERATION DETECTED');
    console.log(`Event: ${log.event}`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Time: ${log.timestamp}`);
    console.log('');
  }

  async runPeriodicAudit() {
    console.log('');
    console.log('📊 Running periodic audit...');

    const auditor = new LoggingAuditor({
      logFile: this.logFile,
      mode: 'full',
      timeRange: '1h',
      format: 'summary'
    });

    await auditor.run();
  }

  stop() {
    if (this.tail) {
      this.tail.unwatch();
    }
    console.log('Monitor stopped');
  }
}

// Run monitor
const monitor = new LogMonitor('dev.log');
monitor.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('');
  console.log('Shutting down monitor...');
  monitor.stop();
  process.exit(0);
});
```

### Install Dependencies

```bash
npm install --save-dev tail
```

### Run Monitor

```bash
# Start in background
node scripts/log-monitor.mjs &

# Or with pm2
pm2 start scripts/log-monitor.mjs --name log-monitor
pm2 logs log-monitor
```

---

## Option 3: Scheduled Audit Reports

### Create Cron Job

**File:** `scripts/scheduled-audit.mjs`

```javascript
#!/usr/bin/env node

import cron from 'node-cron';
import { LoggingAuditor } from '../.claude/skills/audit-logs/index.mjs';
import fs from 'fs';
import path from 'path';

/**
 * Scheduled log audits with email reports
 */
class ScheduledAuditor {
  constructor() {
    this.reportsDir = 'logs/audit-reports';

    // Create reports directory
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  start() {
    console.log('📅 Starting scheduled auditor...');

    // Daily audit at 8 AM
    cron.schedule('0 8 * * *', async () => {
      await this.runDailyAudit();
    });

    // Hourly quick check
    cron.schedule('0 * * * *', async () => {
      await this.runHourlyCheck();
    });

    console.log('✅ Scheduled audits configured');
    console.log('   Daily audit: 8:00 AM');
    console.log('   Hourly check: Every hour');
  }

  async runDailyAudit() {
    console.log('📊 Running daily audit...');

    const auditor = new LoggingAuditor({
      logFile: 'dev.log',
      mode: 'full',
      timeRange: '24h',
      format: 'detailed'
    });

    const results = await auditor.run();

    // Save report
    const timestamp = new Date().toISOString().split('T')[0];
    const reportPath = path.join(this.reportsDir, `audit-${timestamp}.json`);

    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

    console.log(`✅ Daily audit complete. Report saved to ${reportPath}`);

    // Send email if critical issues found
    if (results.summary.errorCount > 100 || results.anomalies.some(a => a.severity === 'critical')) {
      this.sendAlert(results);
    }
  }

  async runHourlyCheck() {
    console.log('🔍 Running hourly check...');

    const auditor = new LoggingAuditor({
      logFile: 'dev.log',
      mode: 'errors',
      timeRange: '1h',
      format: 'summary'
    });

    const results = await auditor.run();

    // Alert if critical issues
    if (results.summary.errorCount > 10) {
      console.log('🚨 ALERT: High error rate in last hour!');
      this.sendAlert(results);
    }
  }

  sendAlert(results) {
    // TODO: Implement email/Slack/Discord notification
    console.log('📧 Sending alert notification...');
    console.log(JSON.stringify(results.summary, null, 2));
  }
}

const scheduler = new ScheduledAuditor();
scheduler.start();
```

### Install Dependencies

```bash
npm install --save-dev node-cron
```

### Run Scheduler

```bash
# Start with pm2
pm2 start scripts/scheduled-audit.mjs --name audit-scheduler

# Check status
pm2 list
pm2 logs audit-scheduler
```

---

## Integration with Claude Code

### Add to package.json Scripts

```json
{
  "scripts": {
    "audit:logs": "node .claude/skills/audit-logs/index.mjs",
    "audit:errors": "node .claude/skills/audit-logs/index.mjs --mode=errors",
    "audit:performance": "node .claude/skills/audit-logs/index.mjs --mode=performance",
    "audit:compliance": "node .claude/skills/audit-logs/index.mjs --mode=compliance",
    "monitor:logs": "node scripts/log-monitor.mjs",
    "schedule:audits": "pm2 start scripts/scheduled-audit.mjs --name audit-scheduler"
  }
}
```

### Usage with Claude Code

When debugging with Claude Code, I can now:

```bash
# Quick error audit
npm run audit:errors

# Full audit of last 24 hours
npm run audit:logs -- --timeRange=24h --format=detailed

# Custom pattern search
npm run audit:logs -- --mode=custom --eventFilter="governance.*"

# Performance analysis
npm run audit:performance -- --timeRange=1h
```

---

## Advanced Features

### 1. Log Correlation Analysis

Add to `LoggingAuditor` class:

```javascript
/**
 * Correlate related events across subsystems
 */
correlateEvents(logs) {
  const correlations = [];

  // Example: Find sessions with governance failures
  const sessions = {};

  logs.forEach(log => {
    const sessionId = log.data?.sessionId || log.context?.sessionId;
    if (!sessionId) return;

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        sessionId,
        events: [],
        errors: [],
        performance: []
      };
    }

    sessions[sessionId].events.push(log);

    if (log.level === 'error') {
      sessions[sessionId].errors.push(log);
    }

    if (log.data?.durationMs > 1000) {
      sessions[sessionId].performance.push(log);
    }
  });

  // Identify problematic sessions
  Object.values(sessions).forEach(session => {
    if (session.errors.length > 5) {
      correlations.push({
        type: 'error_prone_session',
        sessionId: session.sessionId,
        errorCount: session.errors.length,
        events: session.events.length
      });
    }
  });

  return correlations;
}
```

### 2. Trend Analysis

```javascript
/**
 * Analyze trends over time
 */
analyzeTrends(logs) {
  const hourly = {};

  logs.forEach(log => {
    if (!log.timestamp) return;

    const hour = new Date(log.timestamp).toISOString().slice(0, 13); // YYYY-MM-DDTHH

    if (!hourly[hour]) {
      hourly[hour] = {
        total: 0,
        errors: 0,
        warnings: 0,
        events: {}
      };
    }

    hourly[hour].total++;

    if (log.level === 'error') hourly[hour].errors++;
    if (log.level === 'warn') hourly[hour].warnings++;

    const event = log.event || 'unknown';
    hourly[hour].events[event] = (hourly[hour].events[event] || 0) + 1;
  });

  return hourly;
}
```

### 3. Export to Different Formats

```javascript
/**
 * Export results to various formats
 */
export(format = 'json') {
  switch (format) {
    case 'json':
      return JSON.stringify(this.results, null, 2);

    case 'csv':
      return this.exportCSV();

    case 'html':
      return this.exportHTML();

    case 'markdown':
      return this.exportMarkdown();
  }
}

exportMarkdown() {
  let md = '# Log Audit Report\n\n';
  md += `**Date:** ${new Date().toISOString()}\n\n`;
  md += `## Summary\n\n`;
  md += `- Errors: ${this.results.summary.errorCount || 0}\n`;
  md += `- Warnings: ${this.results.summary.warningCount || 0}\n`;
  md += `- Anomalies: ${this.results.summary.anomalyCount || 0}\n\n`;

  if (this.results.errors.length > 0) {
    md += `## Errors\n\n`;
    this.results.errors.slice(0, 10).forEach(err => {
      md += `### ${err.event}\n`;
      md += `- **Time:** ${err.timestamp}\n`;
      md += `- **Message:** ${err.message}\n\n`;
    });
  }

  return md;
}
```

---

## Production Deployment

### Monitor Production Logs

```bash
# SSH and run auditor on production
ssh user@prod-server 'cd /var/log/daylightstation && node /path/to/audit-logs/index.mjs --logFile=app.log --timeRange=1h'

# Or copy logs locally and analyze
scp user@prod-server:/var/log/daylightstation/app.log ./prod.log
npm run audit:logs -- --logFile=prod.log --timeRange=all
```

### Set Up Production Monitoring

```bash
# Install on production server
ssh user@prod-server

# Install dependencies
cd /opt/daylightstation
npm install tail node-cron

# Start monitor with pm2
pm2 start scripts/log-monitor.mjs --name log-monitor
pm2 startup
pm2 save
```

---

## Summary

You now have three options for a logging auditor agent:

1. **✅ Claude Code Skill** (`/audit-logs`) - On-demand audits via Claude Code
2. **📊 Background Monitor** - Real-time monitoring with alerts
3. **📅 Scheduled Audits** - Daily/hourly reports

**Recommended Setup:**
- Use Claude Code skill for debugging sessions
- Run background monitor in development
- Use scheduled audits in production

**Next Steps:**
1. Choose implementation option
2. Test with sample logs
3. Configure alert thresholds
4. Set up production monitoring
5. Integrate with notification system (email/Slack)
