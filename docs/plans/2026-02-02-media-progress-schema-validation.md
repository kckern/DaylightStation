# Media Progress Schema Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add schema validation to `YamlMediaProgressMemory.set()` to prevent writes with legacy field names and ensure canonical format compliance.

**Architecture:** The MediaProgress entity already defines the canonical schema. We'll add validation in the persistence layer that rejects data with legacy field names (`mediaDuration`, `seconds`, `time`) and logs warnings. This prevents regression after P0 migration.

**Tech Stack:** Vitest for testing, existing ValidationError from domain layer.

---

### Task 1: Create MediaProgress Entity Unit Tests

**Files:**
- Create: `backend/tests/unit/suite/1_domains/content/entities/MediaProgress.test.mjs`

**Step 1: Write the test file with basic validation tests**

```javascript
import { describe, it, expect } from 'vitest';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('MediaProgress', () => {
  describe('constructor', () => {
    it('should create MediaProgress with all canonical fields', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 500,
        duration: 1000,
        playCount: 3,
        lastPlayed: '2026-02-02T14:30:00',
        watchTime: 1500
      });

      expect(progress.itemId).toBe('plex:12345');
      expect(progress.playhead).toBe(500);
      expect(progress.duration).toBe(1000);
      expect(progress.playCount).toBe(3);
      expect(progress.lastPlayed).toBe('2026-02-02T14:30:00');
      expect(progress.watchTime).toBe(1500);
    });

    it('should default optional fields to zero/null', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345'
      });

      expect(progress.playhead).toBe(0);
      expect(progress.duration).toBe(0);
      expect(progress.playCount).toBe(0);
      expect(progress.lastPlayed).toBeNull();
      expect(progress.watchTime).toBe(0);
    });

    it('should throw ValidationError when itemId is missing', () => {
      expect(() => new MediaProgress({})).toThrow(ValidationError);
    });
  });

  describe('percent', () => {
    it('should calculate percentage correctly', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 500,
        duration: 1000
      });

      expect(progress.percent).toBe(50);
    });

    it('should return 0 when duration is 0', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 500,
        duration: 0
      });

      expect(progress.percent).toBe(0);
    });
  });

  describe('isWatched', () => {
    it('should return true when >= 90%', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 900,
        duration: 1000
      });

      expect(progress.isWatched()).toBe(true);
    });

    it('should return false when < 90%', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 890,
        duration: 1000
      });

      expect(progress.isWatched()).toBe(false);
    });
  });

  describe('isInProgress', () => {
    it('should return true when started but not finished', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 500,
        duration: 1000
      });

      expect(progress.isInProgress()).toBe(true);
    });

    it('should return false when not started', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 0,
        duration: 1000
      });

      expect(progress.isInProgress()).toBe(false);
    });

    it('should return false when finished', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 950,
        duration: 1000
      });

      expect(progress.isInProgress()).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize to canonical format', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 500,
        duration: 1000,
        playCount: 3,
        lastPlayed: '2026-02-02T14:30:00',
        watchTime: 1500
      });

      const json = progress.toJSON();

      expect(json).toEqual({
        itemId: 'plex:12345',
        playhead: 500,
        duration: 1000,
        percent: 50,
        playCount: 3,
        lastPlayed: '2026-02-02T14:30:00',
        watchTime: 1500
      });
    });

    it('should NOT include legacy field names', () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 500,
        duration: 1000
      });

      const json = progress.toJSON();

      expect(json).not.toHaveProperty('seconds');
      expect(json).not.toHaveProperty('mediaDuration');
      expect(json).not.toHaveProperty('time');
    });
  });
});
```

**Step 2: Run test to verify it passes (existing implementation should satisfy these)**

Run: `npx vitest run backend/tests/unit/suite/1_domains/content/entities/MediaProgress.test.mjs`
Expected: PASS (existing MediaProgress already implements this)

**Step 3: Commit**

```bash
git add backend/tests/unit/suite/1_domains/content/entities/MediaProgress.test.mjs
git commit -m "test: add MediaProgress entity unit tests"
```

---

### Task 2: Add Schema Validation Constants

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs`

**Step 1: Write the schema definition file**

```javascript
// backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs

/**
 * Canonical field names for media progress (after P0 migration)
 */
export const CANONICAL_FIELDS = Object.freeze([
  'playhead',
  'duration',
  'percent',
  'playCount',
  'lastPlayed',
  'watchTime'
]);

/**
 * Legacy field names that should NOT appear in new writes
 */
export const LEGACY_FIELDS = Object.freeze([
  'seconds',       // Legacy: use 'playhead'
  'mediaDuration', // Legacy: use 'duration'
  'time',          // Legacy: use 'lastPlayed'
  'title',         // Metadata: should not be in progress
  'parent',        // Metadata: should not be in progress
  'grandparent'    // Metadata: should not be in progress
]);

/**
 * Map of legacy field names to their canonical replacements
 */
export const LEGACY_TO_CANONICAL = Object.freeze({
  seconds: 'playhead',
  mediaDuration: 'duration',
  time: 'lastPlayed'
});

/**
 * Check if data contains any legacy fields
 * @param {Object} data - Data to validate
 * @returns {{ valid: boolean, legacyFields: string[] }}
 */
export function validateCanonicalSchema(data) {
  const foundLegacy = [];

  for (const field of LEGACY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      foundLegacy.push(field);
    }
  }

  return {
    valid: foundLegacy.length === 0,
    legacyFields: foundLegacy
  };
}
```

**Step 2: Run linter to verify syntax**

Run: `node --check backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs`
Expected: No output (syntax valid)

**Step 3: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs
git commit -m "feat: add media progress schema constants"
```

---

### Task 3: Create Schema Validation Unit Tests

**Files:**
- Create: `backend/tests/unit/suite/1_adapters/persistence/yaml/mediaProgressSchema.test.mjs`

**Step 1: Write the test file**

```javascript
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_FIELDS,
  LEGACY_FIELDS,
  LEGACY_TO_CANONICAL,
  validateCanonicalSchema
} from '#adapters/persistence/yaml/mediaProgressSchema.mjs';

describe('mediaProgressSchema', () => {
  describe('CANONICAL_FIELDS', () => {
    it('should include all canonical field names', () => {
      expect(CANONICAL_FIELDS).toContain('playhead');
      expect(CANONICAL_FIELDS).toContain('duration');
      expect(CANONICAL_FIELDS).toContain('percent');
      expect(CANONICAL_FIELDS).toContain('playCount');
      expect(CANONICAL_FIELDS).toContain('lastPlayed');
      expect(CANONICAL_FIELDS).toContain('watchTime');
    });

    it('should NOT include legacy field names', () => {
      expect(CANONICAL_FIELDS).not.toContain('seconds');
      expect(CANONICAL_FIELDS).not.toContain('mediaDuration');
      expect(CANONICAL_FIELDS).not.toContain('time');
    });
  });

  describe('LEGACY_FIELDS', () => {
    it('should include deprecated field names', () => {
      expect(LEGACY_FIELDS).toContain('seconds');
      expect(LEGACY_FIELDS).toContain('mediaDuration');
      expect(LEGACY_FIELDS).toContain('time');
    });

    it('should include metadata fields that don\'t belong', () => {
      expect(LEGACY_FIELDS).toContain('title');
      expect(LEGACY_FIELDS).toContain('parent');
      expect(LEGACY_FIELDS).toContain('grandparent');
    });
  });

  describe('LEGACY_TO_CANONICAL', () => {
    it('should map seconds to playhead', () => {
      expect(LEGACY_TO_CANONICAL.seconds).toBe('playhead');
    });

    it('should map mediaDuration to duration', () => {
      expect(LEGACY_TO_CANONICAL.mediaDuration).toBe('duration');
    });

    it('should map time to lastPlayed', () => {
      expect(LEGACY_TO_CANONICAL.time).toBe('lastPlayed');
    });
  });

  describe('validateCanonicalSchema', () => {
    it('should return valid for canonical data', () => {
      const data = {
        playhead: 500,
        duration: 1000,
        percent: 50,
        playCount: 1,
        lastPlayed: '2026-02-02T14:30:00',
        watchTime: 500
      };

      const result = validateCanonicalSchema(data);

      expect(result.valid).toBe(true);
      expect(result.legacyFields).toHaveLength(0);
    });

    it('should detect seconds as legacy field', () => {
      const data = {
        seconds: 500,  // Legacy!
        duration: 1000
      };

      const result = validateCanonicalSchema(data);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toContain('seconds');
    });

    it('should detect mediaDuration as legacy field', () => {
      const data = {
        playhead: 500,
        mediaDuration: 1000  // Legacy!
      };

      const result = validateCanonicalSchema(data);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toContain('mediaDuration');
    });

    it('should detect time as legacy field', () => {
      const data = {
        playhead: 500,
        time: '2026-02-02 14.30.00'  // Legacy!
      };

      const result = validateCanonicalSchema(data);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toContain('time');
    });

    it('should detect multiple legacy fields', () => {
      const data = {
        seconds: 500,        // Legacy!
        mediaDuration: 1000, // Legacy!
        time: '2026-02-02'   // Legacy!
      };

      const result = validateCanonicalSchema(data);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toHaveLength(3);
    });

    it('should detect metadata fields that don\'t belong', () => {
      const data = {
        playhead: 500,
        duration: 1000,
        title: 'Episode 1'  // Doesn't belong in progress!
      };

      const result = validateCanonicalSchema(data);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toContain('title');
    });
  });
});
```

**Step 2: Run test to verify it fails (schema module not importable yet via alias)**

Run: `npx vitest run backend/tests/unit/suite/1_adapters/persistence/yaml/mediaProgressSchema.test.mjs`
Expected: FAIL (module path issue or tests fail initially)

**Step 3: Ensure import alias works, then run again**

Run: `npx vitest run backend/tests/unit/suite/1_adapters/persistence/yaml/mediaProgressSchema.test.mjs`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/tests/unit/suite/1_adapters/persistence/yaml/mediaProgressSchema.test.mjs
git commit -m "test: add schema validation unit tests"
```

---

### Task 4: Add Validation to YamlMediaProgressMemory.set()

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs:112-117`

**Step 1: Write the failing test for set() validation**

Add to `backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs` (create if doesn't exist):

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YamlMediaProgressMemory } from '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('YamlMediaProgressMemory', () => {
  let memory;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-progress-test-'));
    memory = new YamlMediaProgressMemory({ basePath: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('set()', () => {
    it('should write canonical format to YAML', async () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 500,
        duration: 1000,
        playCount: 1,
        lastPlayed: '2026-02-02T14:30:00',
        watchTime: 500
      });

      await memory.set(progress, 'plex/test');

      // Verify file contains canonical fields
      const filePath = path.join(tempDir, 'plex/test.yml');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('playhead:');
      expect(content).toContain('duration:');
      expect(content).not.toContain('seconds:');
      expect(content).not.toContain('mediaDuration:');
    });

    it('should log warning when MediaProgress contains unexpected legacy fields', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Create a malformed object that bypasses MediaProgress (simulating bad caller)
      const badProgress = {
        itemId: 'plex:12345',
        toJSON: () => ({
          itemId: 'plex:12345',
          seconds: 500,        // Legacy!
          mediaDuration: 1000  // Legacy!
        })
      };

      await memory.set(badProgress, 'plex/test');

      // Should log warning about legacy fields
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('legacy fields'),
        expect.objectContaining({ legacyFields: expect.arrayContaining(['seconds', 'mediaDuration']) })
      );

      warnSpy.mockRestore();
    });
  });

  describe('get()', () => {
    it('should return MediaProgress entity with canonical fields', async () => {
      const progress = new MediaProgress({
        itemId: 'plex:12345',
        playhead: 500,
        duration: 1000
      });

      await memory.set(progress, 'plex/test');
      const retrieved = await memory.get('plex:12345', 'plex/test');

      expect(retrieved).toBeInstanceOf(MediaProgress);
      expect(retrieved.playhead).toBe(500);
      expect(retrieved.duration).toBe(1000);
      expect(retrieved.percent).toBe(50);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs`
Expected: FAIL (warning not logged yet)

**Step 3: Implement validation in set()**

Modify `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`:

```javascript
// Add import at top
import { validateCanonicalSchema, LEGACY_TO_CANONICAL } from './mediaProgressSchema.mjs';

// Replace set() method (lines 112-117)
  /**
   * Set media progress for an item
   * @param {MediaProgress} state
   * @param {string} storagePath
   * @returns {Promise<void>}
   */
  async set(state, storagePath) {
    const data = this._readFile(storagePath);
    const { itemId, ...rest } = state.toJSON();

    // P1: Validate canonical schema - warn on legacy fields
    const validation = validateCanonicalSchema(rest);
    if (!validation.valid) {
      console.warn(
        '[YamlMediaProgressMemory] Attempting to write data with legacy fields',
        {
          itemId,
          storagePath,
          legacyFields: validation.legacyFields,
          hint: 'Use canonical field names: ' +
            validation.legacyFields.map(f => `${f} → ${LEGACY_TO_CANONICAL[f] || 'remove'}`).join(', ')
        }
      );
    }

    data[itemId] = rest;
    this._writeFile(storagePath, data);
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
git add backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs
git commit -m "feat: add schema validation to YamlMediaProgressMemory.set()"
```

---

### Task 5: Run Full Test Suite and Verify No Regressions

**Files:**
- None (verification only)

**Step 1: Run all unit tests**

Run: `npm run test:unit`
Expected: All tests pass

**Step 2: Run content API regression tests**

Run: `npx jest tests/live/api/content/content-api.regression.test.mjs --testTimeout=30000`
Expected: All tests pass

**Step 3: Verify by testing a real progress update**

Run: `curl -X POST http://localhost:3112/api/v1/play/log -H 'Content-Type: application/json' -d '{"type":"plex","assetId":"999999","percent":50,"seconds":300}'`
Expected: Response with canonical fields (playhead, duration, percent)

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify P1 schema validation complete"
```

---

### Task 6: Update Audit Document

**Files:**
- Modify: `docs/_wip/audits/2026-02-02-watch-history-ddd-audit.md`

**Step 1: Update P1 status**

Add checkmark to P1 in the audit document:

```markdown
### P1 - Schema Validation ✅
Added schema validation to `YamlMediaProgressMemory.set()`:
- `mediaProgressSchema.mjs` defines canonical and legacy field names
- `set()` validates data and logs warning for legacy field usage
- Unit tests verify validation works correctly

Commit: [commit hash]
```

**Step 2: Commit**

```bash
git add docs/_wip/audits/2026-02-02-watch-history-ddd-audit.md
git commit -m "docs: mark P1 schema validation as complete in audit"
```

---

## Summary

This plan implements P1 (Schema Validation) from the watch history audit:

1. **Task 1**: Unit tests for MediaProgress entity (verify existing implementation)
2. **Task 2**: Schema constants module with canonical/legacy field definitions
3. **Task 3**: Unit tests for schema validation functions
4. **Task 4**: Add validation to `YamlMediaProgressMemory.set()` with warning logs
5. **Task 5**: Run full test suite to verify no regressions
6. **Task 6**: Update audit documentation

Total: 6 tasks, ~15-20 minutes execution time

The validation is non-blocking (warning only) to avoid breaking production while catching issues in logs. Future P1.1 could make it throw in development mode.
