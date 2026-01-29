# Audit Skill Design

**Date:** 2026-01-29
**Status:** Implemented

---

## Overview

A Claude Code skill that scans the codebase for violations of coding standards and DDD architecture guidelines. Produces markdown audit reports with state tracking to distinguish new violations from known/acknowledged ones.

**Invocation:**
```
/audit                      # Full codebase audit
/audit fitness              # Single domain
/audit --changed            # Files changed since last commit
/audit --changed-from main  # Files changed vs main branch
```

---

## How It Works

1. Reads `docs/reference/core/coding-standards.md` and layer guidelines
2. Loads `docs/_wip/audits/baseline.yml` for known violations
3. Scans target files for violations
4. Compares against baseline to flag NEW vs KNOWN
5. Outputs report to `docs/_wip/audits/YYYY-MM-DD-<scope>-audit.md`
6. Updates baseline with newly detected violations

---

## Violation States

| State | Meaning |
|-------|---------|
| NEW | First time seeing this violation |
| KNOWN | In baseline, not yet addressed |
| FIXED | Was in baseline, no longer detected |
| IGNORED | Has `@audit-ok` annotation in code |

---

## Rule Categories

Based on `coding-standards.md` and layer guidelines:

| Category | Examples | Severity |
|----------|----------|----------|
| **Naming** | Underscore private `_foo`, generic names, missing verbs | Medium |
| **Imports** | Relative path traversal, explicit index.mjs, wrong-layer imports | High |
| **Exports** | Missing default export on classes, exporting internals | Medium |
| **Class Patterns** | Public mutable fields, missing constructor validation | High |
| **Error Handling** | Generic `Error`, silent swallow, missing error code | High |
| **Domain Purity** | `new Date()` in domain, adapter imports in domain | Critical |
| **JSDoc** | Missing `@class`, missing `@param/@returns/@throws` | Low |

**Detection approach:**
- Pattern matching via grep/AST for structural issues (imports, exports, naming)
- Claude analysis for semantic issues (anemic entities, missing validation logic)

---

## Baseline File

**Location:** `docs/_wip/audits/baseline.yml`

Tracks known violations across audit runs. Updated automatically by `/audit`, manually triaged by developer.

```yaml
schema_version: 1
last_updated: 2026-01-29

# Violations you've seen and acknowledged (won't show as NEW)
known:
  - id: "session-public-fields"
    file: "backend/src/1_domains/fitness/entities/Session.mjs"
    rule: "public-mutable-fields"
    lines: [24, 25, 26, 27]
    added: 2026-01-29
    note: "Migration planned - see issue #42"

# Violations you've decided are intentional exceptions
exceptions:
  - id: "session-tojson"
    file: "backend/src/1_domains/fitness/entities/Session.mjs"
    rule: "tojson-in-entity"
    reason: "Needed for API serialization, acceptable tradeoff"
    approved_by: "kckern"
    approved_date: 2026-01-29

# Auto-populated: violations that were in 'known' but no longer detected
resolved:
  - id: "old-violation-id"
    file: "..."
    rule: "..."
    resolved_date: 2026-01-29
```

---

## Inline Annotations

Suppress violations directly in code:

```javascript
// Suppress single violation
// @audit-ok(tojson-in-entity): needed for API response format
toJSON() { ... }

// Suppress for entire file (at top of file)
// @audit-disable public-mutable-fields
```

---

## Report Output Format

**Location:** `docs/_wip/audits/YYYY-MM-DD-<scope>-audit.md`

```markdown
# Code Standards Audit Report

**Date:** 2026-01-29
**Scope:** Full codebase
**Files scanned:** 116
**Reference:** `docs/reference/core/coding-standards.md`

---

## Summary

| Status | Count |
|--------|-------|
| NEW | 3 |
| KNOWN | 12 |
| FIXED | 2 |
| IGNORED | 5 |
| **Total Active** | 15 |

**Grade: B+ (82/100)**

---

## New Violations (3)

These are new since last audit - triage needed.

### HIGH: Domain imports adapter

**File:** `backend/src/1_domains/fitness/services/ZoneService.mjs:14`
**Rule:** `domain-purity`

\```javascript
import { YamlStore } from '#adapters/persistence'; // violation
\```

**Fix:** Inject via constructor, don't import adapters in domain layer.

---

## Known Violations (12)

Previously identified, not yet addressed.

| File | Rule | Since | Note |
|------|------|-------|------|
| Session.mjs | public-mutable-fields | 2026-01-27 | Migration planned |

---

## Fixed Since Last Audit (2)

These were in baseline but no longer detected.

- `Message.mjs` - missing-default-export
- `time.mjs` - missing-jsdoc
```

---

## Scheduling

- **On-demand:** Invoke `/audit` when desired
- **Periodic:** Cron job runs full audit weekly, commits report to repo
- **Not per-commit:** Too expensive for CI on every push

---

## Implementation

### File Structure

```
cli/audit/
├── index.mjs          # Main scanner entry point
├── utils.mjs          # File discovery, annotation checking
├── baseline.mjs       # Baseline YAML read/write
├── report.mjs         # Markdown report generator
└── rules/
    ├── index.mjs      # Rule aggregator
    ├── imports.mjs    # Wrong-layer imports, path traversal
    ├── exports.mjs    # Missing default exports
    ├── naming.mjs     # Underscore privates, generic names
    ├── classes.mjs    # Public fields, constructor validation
    ├── errors.mjs     # Generic errors, silent swallow
    └── domain.mjs     # Domain purity rules

.claude/skills/audit.md  # Claude Code skill definition
docs/_wip/audits/baseline.yml  # Violation tracking
```

### CLI Usage

```bash
# Direct CLI usage
node cli/audit/index.mjs                    # Full backend
node cli/audit/index.mjs fitness            # Single domain
node cli/audit/index.mjs 1_domains          # Entire layer
node cli/audit/index.mjs --changed          # Changed files only
node cli/audit/index.mjs --json             # JSON output
```

---

## Future Enhancements

1. **GitHub Actions integration** - Run on PR, post summary as comment
2. **Auto-fix mode** - Apply simple fixes automatically (add default exports, etc.)
3. **Trend dashboard** - Track violation counts over time
4. **Pre-commit hook** - Optional fast check on staged files only
5. **JSDoc rules** - Check for missing @class, @param, @returns
