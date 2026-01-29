---
name: audit
description: Scan codebase for coding standards and DDD violations
---

# Audit Skill

Scan the codebase for violations of coding standards and DDD architecture guidelines.

## Usage

```
/audit                      # Full codebase audit
/audit fitness              # Single domain
/audit --changed            # Files changed since last commit
/audit --changed-from main  # Files changed vs main branch
```

## Process

Follow these steps exactly:

### 1. Parse Arguments

Extract scope from user input:
- No args = full codebase scan
- Domain name (e.g., "fitness") = scan that domain only
- `--changed` = only files changed since last commit
- `--changed-from <branch>` = files changed vs specified branch

### 2. Run Scanner

Execute the audit scanner:

```bash
node cli/audit/index.mjs [scope] --json
```

This returns JSON with all detected violations.

### 3. Load Baseline

Read `docs/_wip/audits/baseline.yml` to get:
- `known`: Previously identified violations
- `exceptions`: Intentionally ignored violations
- `resolved`: Recently fixed violations

### 4. Classify Violations

For each violation from scanner:

| Status | Condition |
|--------|-----------|
| IGNORED | Has `@audit-ok` annotation OR in baseline.exceptions |
| KNOWN | In baseline.known |
| NEW | Not in baseline, no annotation |

Also identify FIXED: items in baseline.known not in current scan.

### 5. Generate Report

Create markdown report at `docs/_wip/audits/YYYY-MM-DD-<scope>-audit.md`:

```markdown
# Code Standards Audit Report

**Date:** YYYY-MM-DD
**Scope:** <scope>
**Files scanned:** N

## Summary

| Status | Count |
|--------|-------|
| NEW | X |
| KNOWN | Y |
| FIXED | Z |
| IGNORED | W |

## NEW Violations

[For each NEW violation, show:]
- File and line
- Code snippet
- Rule violated
- Suggested fix

## KNOWN Violations

[Table of previously identified issues]

## FIXED Since Last Audit

[List of resolved issues]
```

### 6. Update Baseline

Add NEW violations to baseline.known (so they show as KNOWN next time).
Move fixed items to baseline.resolved.

Run:
```bash
# The skill should update baseline.yml with new findings
```

### 7. Present Summary

Show user:
- Count of NEW/KNOWN/FIXED/IGNORED
- Grade (A/B/C/D)
- Path to full report
- Ask if they want to triage NEW violations

## Triaging Violations

When user wants to triage NEW violations, for each one ask:

1. **Acknowledge** - Add to baseline.known with a note
2. **Exception** - Add to baseline.exceptions (permanently ignore)
3. **Fix now** - Help fix the code
4. **Skip** - Leave as NEW for now

## Rules Reference

Rules are defined in `cli/audit/rules/`:
- `imports.mjs` - Wrong-layer imports, path traversal
- `exports.mjs` - Missing default exports
- `naming.mjs` - Underscore privates, generic names
- `classes.mjs` - Public fields, constructor validation
- `errors.mjs` - Generic errors, silent swallow
- `domain.mjs` - Domain purity (no new Date(), no fs, etc.)

Full coding standards: `docs/reference/core/coding-standards.md`
