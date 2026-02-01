# YouTubeJobHandler Bug Fix & Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the production bug where YouTube job fails due to undefined mediaPath, then refactor to remove vendor-specific naming from the application layer.

**Architecture:** The fix adds validation before registering the FreshVideo job handler, preventing runtime errors when mediaPath is not configured. The refactor renames `YouTubeJobHandler.mjs` → `FreshVideoJobHandler.mjs` and changes the job ID from `youtube` → `freshvideo` to align with Clean Architecture principles (no vendor names in application layer).

**Tech Stack:** Node.js ES Modules, Express, YAML config files

---

## Summary

| Task | Description | Priority |
|------|-------------|----------|
| 1 | Add unit test for missing mediaPath handling | P0 |
| 2 | Fix bug: validate mediaPath before registration | P0 |
| 3 | Add unit test for FreshVideoJobHandler rename | P2 |
| 4 | Rename YouTubeJobHandler.mjs → FreshVideoJobHandler.mjs | P2 |
| 5 | Update index.mjs exports | P2 |
| 6 | Update jobs.yml job ID: youtube → freshvideo | P2 |
| 7 | Update app.mjs registration to use 'freshvideo' | P2 |
| 8 | Remove deprecated createYouTubeJobHandler alias | P3 |
| 9 | Final verification | P0 |

---

## Task 1: Add unit test for missing mediaPath handling

**Files:**
- Create: `tests/unit/suite/applications/media/FreshVideoJobHandler.unit.test.mjs`

**Step 1: Create test directory if needed**

Run: `mkdir -p tests/unit/suite/applications/media`

**Step 2: Write the failing test for mediaPath validation**

```javascript
/**
 * FreshVideoJobHandler Unit Tests
 *
 * Tests the scheduler-compatible handler for fresh video downloads.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// Test subject - will be imported after implementation
// import { createFreshVideoJobHandler } from '@backend/src/3_applications/media/FreshVideoJobHandler.mjs';

describe('FreshVideoJobHandler', () => {
  describe('createFreshVideoJobHandler', () => {
    it('should throw if mediaPath is undefined', () => {
      // This test validates the bug fix: mediaPath must be defined
      // The handler creation should fail early rather than at runtime
      const mockGateway = { download: async () => ({}) };
      const mockLoadFile = async () => ({ sources: [] });
      const mockLogger = { info: () => {}, error: () => {} };

      assert.throws(
        () => createFreshVideoJobHandler({
          videoSourceGateway: mockGateway,
          loadFile: mockLoadFile,
          mediaPath: undefined,
          logger: mockLogger
        }),
        {
          name: 'ValidationError',
          message: /mediaPath.*required/i
        }
      );
    });

    it('should throw if mediaPath is null', () => {
      const mockGateway = { download: async () => ({}) };
      const mockLoadFile = async () => ({ sources: [] });
      const mockLogger = { info: () => {}, error: () => {} };

      assert.throws(
        () => createFreshVideoJobHandler({
          videoSourceGateway: mockGateway,
          loadFile: mockLoadFile,
          mediaPath: null,
          logger: mockLogger
        }),
        {
          name: 'ValidationError',
          message: /mediaPath.*required/i
        }
      );
    });

    it('should throw if mediaPath is empty string', () => {
      const mockGateway = { download: async () => ({}) };
      const mockLoadFile = async () => ({ sources: [] });
      const mockLogger = { info: () => {}, error: () => {} };

      assert.throws(
        () => createFreshVideoJobHandler({
          videoSourceGateway: mockGateway,
          loadFile: mockLoadFile,
          mediaPath: '',
          logger: mockLogger
        }),
        {
          name: 'ValidationError',
          message: /mediaPath.*required/i
        }
      );
    });

    it('should create handler successfully with valid mediaPath', () => {
      const mockGateway = { download: async () => ({}) };
      const mockLoadFile = async () => ({ sources: [] });
      const mockLogger = { info: () => {}, error: () => {} };

      const handler = createFreshVideoJobHandler({
        videoSourceGateway: mockGateway,
        loadFile: mockLoadFile,
        mediaPath: '/valid/path/to/media',
        logger: mockLogger
      });

      assert.strictEqual(typeof handler, 'function');
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `node tests/unit/harness.mjs --pattern=FreshVideoJobHandler`
Expected: FAIL - `createFreshVideoJobHandler` doesn't validate mediaPath yet

**Step 4: Commit test**

```bash
git add tests/unit/suite/applications/media/FreshVideoJobHandler.unit.test.mjs
git commit -m "test(freshvideo): add unit test for mediaPath validation

Sets up failing test that validates the bug fix for undefined mediaPath.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Fix bug - validate mediaPath before registration

**Files:**
- Modify: `backend/src/3_applications/media/YouTubeJobHandler.mjs:21-27`

**Step 1: Add ValidationError import and validation**

At the top of the file, add the import:

```javascript
import { ValidationError } from '#system/utils/errors/index.mjs';
```

Then modify the `createFreshVideoJobHandler` function to validate mediaPath:

```javascript
export function createFreshVideoJobHandler({ videoSourceGateway, loadFile, mediaPath, logger }) {
  // Validate required mediaPath to fail fast instead of at runtime
  if (!mediaPath) {
    throw new ValidationError('mediaPath is required for FreshVideoJobHandler', {
      field: 'mediaPath',
      received: mediaPath
    });
  }

  const service = new FreshVideoService({
    videoSourceGateway,
    configLoader: () => loadFile('state/youtube'),
    mediaPath,
    logger,
  });
  // ... rest unchanged
```

**Step 2: Update app.mjs to handle registration failure gracefully**

In `backend/src/app.mjs`, around lines 954-967, wrap registration in a conditional:

```javascript
  // Register fresh video download handler (only if mediaPath is configured)
  const mediaBasePath = configService.getMediaDir();

  if (mediaBasePath) {
    const mediaPath = join(mediaBasePath, 'video', 'news');

    const videoSourceGateway = new YtDlpAdapter({
      logger: rootLogger.child({ module: 'ytdlp' })
    });

    mediaExecutor.register('youtube', createFreshVideoJobHandler({
      videoSourceGateway,
      loadFile,
      mediaPath,
      logger: rootLogger.child({ module: 'freshvideo' })
    }));
  } else {
    rootLogger.warn?.('freshvideo.disabled', {
      reason: 'mediaBasePath not configured - video downloads disabled'
    });
  }
```

**Step 3: Run tests to verify they pass**

Run: `node tests/unit/harness.mjs --pattern=FreshVideoJobHandler`
Expected: PASS - All 4 tests pass

**Step 4: Commit the fix**

```bash
git add backend/src/3_applications/media/YouTubeJobHandler.mjs backend/src/app.mjs
git commit -m "fix(freshvideo): validate mediaPath before handler creation

Fixes production bug where YouTube job failed with 'path argument must be
string, received undefined'. Now fails fast at registration time with
clear error message, and gracefully degrades when mediaPath not configured.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add unit test for file rename

**Files:**
- Modify: `tests/unit/suite/applications/media/FreshVideoJobHandler.unit.test.mjs`

**Step 1: Add import statement test**

Add this test to verify the new file location works:

```javascript
describe('Module exports', () => {
  it('should export createFreshVideoJobHandler from FreshVideoJobHandler.mjs', async () => {
    // This test will pass after the rename
    // For now, it imports from the old location to establish baseline
    const module = await import('@backend/src/3_applications/media/FreshVideoJobHandler.mjs');
    assert.strictEqual(typeof module.createFreshVideoJobHandler, 'function');
  });

  it('should NOT export createYouTubeJobHandler (deprecated alias removed)', async () => {
    const module = await import('@backend/src/3_applications/media/FreshVideoJobHandler.mjs');
    assert.strictEqual(module.createYouTubeJobHandler, undefined);
  });
});
```

**Step 2: Run to verify it fails (file doesn't exist yet)**

Run: `node tests/unit/harness.mjs --pattern=FreshVideoJobHandler`
Expected: FAIL - Cannot find module 'FreshVideoJobHandler.mjs'

**Step 3: Commit test**

```bash
git add tests/unit/suite/applications/media/FreshVideoJobHandler.unit.test.mjs
git commit -m "test(freshvideo): add import test for renamed file

Prepares for file rename from YouTubeJobHandler to FreshVideoJobHandler.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Rename YouTubeJobHandler.mjs → FreshVideoJobHandler.mjs

**Files:**
- Rename: `backend/src/3_applications/media/YouTubeJobHandler.mjs` → `backend/src/3_applications/media/FreshVideoJobHandler.mjs`

**Step 1: Rename the file**

Run: `git mv backend/src/3_applications/media/YouTubeJobHandler.mjs backend/src/3_applications/media/FreshVideoJobHandler.mjs`

**Step 2: Update the module docstring**

Change line 7 from:
```javascript
 * @module applications/media/YouTubeJobHandler
```
to:
```javascript
 * @module applications/media/FreshVideoJobHandler
```

**Step 3: Run tests**

Run: `node tests/unit/harness.mjs --pattern=FreshVideoJobHandler`
Expected: Tests should find the new file location

**Step 4: Commit**

```bash
git add backend/src/3_applications/media/FreshVideoJobHandler.mjs
git commit -m "refactor(freshvideo): rename YouTubeJobHandler to FreshVideoJobHandler

Removes vendor-specific naming from application layer.
Clean Architecture: application layer should be platform-agnostic.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Update index.mjs exports

**Files:**
- Modify: `backend/src/3_applications/media/index.mjs:10`

**Step 1: Update the export statement**

Change line 10 from:
```javascript
export { createFreshVideoJobHandler, createYouTubeJobHandler } from './YouTubeJobHandler.mjs';
```
to:
```javascript
export { createFreshVideoJobHandler } from './FreshVideoJobHandler.mjs';
```

**Step 2: Run tests**

Run: `node tests/unit/harness.mjs --pattern=FreshVideoJobHandler`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/3_applications/media/index.mjs
git commit -m "refactor(media): update index exports for renamed handler

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update jobs.yml job ID

**Files:**
- Modify: `data/system/jobs.yml:67-69`

**Step 1: Update job configuration**

Change:
```yaml
- id: youtube
  name: YouTube Subscriptions
  schedule: "0 3 * * *"
```
to:
```yaml
- id: freshvideo
  name: Fresh Video Downloads
  schedule: "0 3 * * *"
```

**Step 2: Commit**

```bash
git add data/system/jobs.yml
git commit -m "config(jobs): rename youtube job to freshvideo

Updates job ID to use domain concept instead of vendor name.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Update app.mjs registration to use 'freshvideo'

**Files:**
- Modify: `backend/src/app.mjs:962` (or wherever the registration is after Task 2 changes)

**Step 1: Update the registration call**

Change:
```javascript
mediaExecutor.register('youtube', createFreshVideoJobHandler({
```
to:
```javascript
mediaExecutor.register('freshvideo', createFreshVideoJobHandler({
```

**Step 2: Update the import if needed**

The import should still work via index.mjs re-export. Verify the import path:
```javascript
import { createFreshVideoJobHandler } from './3_applications/media/index.mjs';
```

**Step 3: Run a quick sanity check**

Run: `node -e "import('./backend/src/app.mjs').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: OK (or startup begins)

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor(app): register freshvideo job with domain-based ID

Completes rename from 'youtube' to 'freshvideo' job ID.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Remove deprecated createYouTubeJobHandler alias

**Files:**
- Modify: `backend/src/3_applications/media/FreshVideoJobHandler.mjs:56-57`

**Step 1: Remove the alias**

Delete these lines:
```javascript
// Keep old export name for backward compatibility during transition
export const createYouTubeJobHandler = createFreshVideoJobHandler;
```

**Step 2: Run tests**

Run: `node tests/unit/harness.mjs --pattern=FreshVideoJobHandler`
Expected: PASS - The test for "should NOT export createYouTubeJobHandler" should pass now

**Step 3: Commit**

```bash
git add backend/src/3_applications/media/FreshVideoJobHandler.mjs
git commit -m "chore(freshvideo): remove deprecated createYouTubeJobHandler alias

Completes migration from vendor-specific naming.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Final verification

**Step 1: Run all unit tests**

Run: `node tests/unit/harness.mjs`
Expected: All tests pass

**Step 2: Verify no references to old names remain**

Run: `grep -r "YouTubeJobHandler\|createYouTubeJobHandler" backend/src/ --include="*.mjs" --include="*.js"`
Expected: No output (no references remain)

Run: `grep -r "id: youtube" data/system/`
Expected: No output (job ID updated)

**Step 3: Check git status**

Run: `git status`
Expected: Working tree clean

**Step 4: Review commit history**

Run: `git log --oneline -10`
Expected: See all commits from this plan

---

## Rollback Plan

If issues are discovered in production:

1. **Immediate rollback:** Revert the last commit with `git revert HEAD`
2. **Full rollback:** `git revert --no-commit HEAD~N..HEAD` where N is number of commits from this plan

The job state in `cron-runtime.yml` uses the job ID as key. Renaming from `youtube` to `freshvideo` will lose run history, but this is acceptable (low impact - the job runs daily anyway).

---

## Related Documentation

- WIP analysis: `docs/_wip/2026-01-31-youtube-job-handler-refactor.md`
- Testing guide: `docs/ai-context/testing.md`
- DDD architecture: `docs/reference/core/backend-architecture.md`
