# Print-Document Fidelity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four School print-document defects: (A) reproducing a historical print by ID requires a human to hand-reconstruct five CLI flags from scattered YAML — add a `reprint <instanceId>` command that does it from persisted data alone; (B) the page-2+ footer prints a blank "Name: ___" line instead of something that actually re-identifies a stray page — replace it with the card/student number; (C) fit policy `fill` greedily overpacks page 1 then stretches whatever's left on the last page into huge gaps — rebalance fragment count across pages and cap how far any single gap can grow; (D) the laser-printer adapter never requests double-sided printing — default it to duplex, config-driven.

**Architecture:** All four fixes are additive. Tracks A-C touch the existing School print-document pipeline (`backend/src/{2_domains,1_rendering,3_applications}/school/documents/`, `cli/school-docs.cli.mjs`); Track D touches the separate physical-printer adapter (`backend/src/1_adapters/hardware/laser-printer/`) and is independent of A-C — no shared files, no ordering dependency. No new services, no schema changes. Track A adds a small pure-function module (`reprintContext.mjs`) plus a new CLI subcommand. Track B removes a function and threads one new value (`cardId`) through an existing call chain. Track C adds two new parameters (`balance`, `maxFillAfterPt`) to the existing `placeFragments`/`distributeAnswerSpace` layout functions, threaded through `fit.mjs` → `RenderPrintDocument.mjs` → `DocumentPdfRenderer.mjs`, the same path `growLastPage` already uses. Track D wraps the raw JetDirect payload in a standard PJL preamble/trailer requesting duplex, defaulted on at the adapter constructor and overridable via `schoolFullConfig.printing`.

**Tech Stack:** Node.js ESM, vitest, js-yaml, pdfkit (via existing `DocumentPdfRenderer`). No new dependencies.

---

## Before you start

Read these for context (don't re-derive what they already establish):
- `backend/src/3_applications/school/documents/RenderPrintDocument.mjs` — the v2 render use case all three tracks touch.
- `backend/src/1_rendering/school/documents/layout.mjs` — Track C's target file; read the module doc comment at the top first.
- `backend/src/1_rendering/school/documents/furniture.mjs` — Track B's target file; read the module doc comment (explains the reservation model) first.
- `docs/reference/school/print-documents.md` — the closest thing to a written spec; update it as each track lands (each track's last task does this).

Run the full School print-document test suite once before starting, to get a clean baseline:
```bash
npx vitest run backend/src/1_rendering/school/documents backend/src/2_domains/school/documents backend/src/3_applications/school/documents cli/school-docs.cli.test.mjs
```
Expected: all pass. If anything is already red, stop and report — do not build on a broken baseline.

---

## Track A — `reprint <instanceId>`: reproduce a historical print from persisted data alone

### Task 1: `reprintContext.mjs` — shared learner-name/date derivation

**Files:**
- Create: `backend/src/3_applications/school/documents/reprintContext.mjs`
- Test: `backend/src/3_applications/school/documents/reprintContext.test.mjs`

**Why this file exists:** `IssueDocument.mjs:359-364` already derives a title-cased learner name and a formatted issue date inline, every time it prints or reprints a worksheet. That's the ONE place today that knows how to turn a bare `learnerId`/`issuedAt` into what actually gets printed on the page. Track A needs the identical derivation for a new CLI path — duplicating it risks the exact drift `ReplaceLostAnswerSheet.mjs:58` already has (it prints the raw `learnerId` as the name instead of title-casing it). This file is the single source of truth both paths use.

**Step 1: Write the failing test**

```javascript
// backend/src/3_applications/school/documents/reprintContext.test.mjs
import { describe, it, expect } from 'vitest';
import { deriveLearnerName, deriveIssueDate, buildReprintContext } from './reprintContext.mjs';

describe('deriveLearnerName', () => {
  it('title-cases a plain learner id', () => {
    expect(deriveLearnerName('felix')).toBe('Felix');
  });

  it('title-cases each word of a hyphenated/underscored id', () => {
    expect(deriveLearnerName('mary-jane_doe')).toBe('Mary Jane Doe');
  });
});

describe('deriveIssueDate', () => {
  it('formats an ISO timestamp as day-month-year in America/Los_Angeles', () => {
    // 2026-08-14T17:55:20.033Z is still 2026-08-14 in America/Los_Angeles (UTC-7 in August)
    expect(deriveIssueDate('2026-08-14T17:55:20.033Z')).toBe('14 Aug 2026');
  });
});

describe('buildReprintContext', () => {
  const instance = () => ({
    id: 'civilization/young-peoples-atlas-us/ws-ses-f6buxumv',
    sessionId: 'ses_f6Buxumv',
    learnerId: 'felix',
    issuedAt: '2026-08-14T17:55:20.033Z',
    omr: { cardId: '5922785', recordId: 'x:v0:7-16', rowRange: { start: 7, end: 16 } },
  });

  it('builds the full render context from a card-backed instance', () => {
    expect(buildReprintContext(instance())).toEqual({
      cardId: '5922785',
      startRow: 7,
      learnerId: 'felix',
      learnerName: 'Felix',
      date: '14 Aug 2026',
      sessionId: 'ses_f6Buxumv',
    });
  });

  it('throws a ValidationError when the instance has no card allocation', () => {
    const { omr, ...noCard } = instance();
    expect(() => buildReprintContext(noCard)).toThrow(/no card allocation/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/school/documents/reprintContext.test.mjs`
Expected: FAIL — `Cannot find module './reprintContext.mjs'`

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/school/documents/reprintContext.mjs
/**
 * Deriving what actually gets PRINTED on a sheet — the learner's display name
 * and the issue date — from the bare data a worksheet instance persists
 * (`learnerId`, `issuedAt`). This is the SAME derivation IssueDocument.mjs's
 * production issue/reprint path runs inline; both it and the `school-docs
 * reprint` CLI command import from here so the two can never drift apart
 * (ReplaceLostAnswerSheet.mjs's own inline learnerName — the raw id, never
 * title-cased — is the drift this module exists to stop from spreading).
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

/** `'mary-jane_doe'` -> `'Mary Jane Doe'` — split on hyphen/underscore/space, title-case each part. */
export function deriveLearnerName(learnerId) {
  return String(learnerId)
    .split(/[-_\s]+/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

/** An ISO timestamp as it prints on the sheet's Date line — day-month-year, household timezone. */
export function deriveIssueDate(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleDateString('en-GB', {
    timeZone: 'America/Los_Angeles', day: 'numeric', month: 'short', year: 'numeric',
  });
}

/**
 * The exact render context a card-attached worksheet instance needs to
 * reproduce its print byte-for-byte: same cardId/row range (so
 * `RenderPrintDocument`'s allocation-store idempotent-reprint path returns
 * the SAME live record unchanged, never mutating it), same learner identity,
 * same printed name/date.
 */
export function buildReprintContext(instance) {
  if (!instance?.omr?.cardId || !instance?.omr?.rowRange) {
    throw new ValidationError(
      `worksheet instance '${instance?.id ?? '(unknown)'}' has no card allocation `
      + '(omr.cardId/rowRange); nothing to reprint identically',
      { code: 'REPRINT_NO_CARD', details: { instanceId: instance?.id ?? null } },
    );
  }
  return {
    cardId: instance.omr.cardId,
    startRow: instance.omr.rowRange.start,
    learnerId: instance.learnerId,
    learnerName: deriveLearnerName(instance.learnerId),
    date: deriveIssueDate(instance.issuedAt),
    sessionId: instance.sessionId ?? null,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/school/documents/reprintContext.test.mjs`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/documents/reprintContext.mjs backend/src/3_applications/school/documents/reprintContext.test.mjs
git commit -m "feat(school-docs): add shared learner-name/date derivation for reprints"
```

---

### Task 2: `IssueDocument.mjs` uses the shared derivation (dedupe, no behavior change)

**Files:**
- Modify: `backend/src/3_applications/school/usecases/IssueDocument.mjs:359-364`

**Step 1: Confirm the existing behavior is pinned by a test**

Run: `npx vitest run backend/src/3_applications/school/usecases/IssueDocument.test.mjs` (or whatever the actual test file is named — `ls backend/src/3_applications/school/usecases/IssueDocument*.test.mjs` to confirm)
Expected: PASS (baseline, before touching production code)

**Step 2: Replace the inline derivation with the shared functions**

Add the import near the other `#apps/...` import (line 42):
```javascript
import { PublishPrintDocument } from '#apps/school/documents/PublishPrintDocument.mjs';
import { deriveLearnerName, deriveIssueDate } from '#apps/school/documents/reprintContext.mjs';
```

Replace lines 359-364:
```javascript
    const learnerName = String(instance.learnerId)
      .split(/[-_\s]+/).filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
    const issueDate = new Date(instance.issuedAt).toLocaleDateString('en-GB', {
      timeZone: 'America/Los_Angeles', day: 'numeric', month: 'short', year: 'numeric',
    });
```
with:
```javascript
    const learnerName = deriveLearnerName(instance.learnerId);
    const issueDate = deriveIssueDate(instance.issuedAt);
```

Do NOT touch the three-way `context` branch below it (lines 375-382) — it still builds its own object shape per branch (reprint / reusable-card / fresh-card); only the two pure derivations were duplicated, and this removes that duplication without changing what gets rendered.

**Step 3: Run test to verify nothing changed**

Run: `npx vitest run backend/src/3_applications/school/usecases/IssueDocument.test.mjs`
Expected: PASS, identical to Step 1's baseline — this is a pure refactor, no assertion should need updating.

**Step 4: Commit**

```bash
git add backend/src/3_applications/school/usecases/IssueDocument.mjs
git commit -m "refactor(school-docs): IssueDocument reuses shared learner-name/date derivation"
```

---

### Task 3: `reprint <instanceId>` CLI command

**Files:**
- Modify: `cli/school-docs.cli.mjs`
- Test: `cli/school-docs.cli.test.mjs`

**Step 1: Write the failing test**

Add to `cli/school-docs.cli.test.mjs` (near the other `describe('render --card...')` block — same file, same `withTmpDir` helper already defined at the top):

```javascript
describe('reprint <instanceId>', () => {
  it('reproduces an exact historical print from a worksheet-instance file alone — no manual flags', async () => withTmpDir(async (root) => {
    const dataDir = path.join(root, 'data');
    const contentRoot = path.join(dataDir, 'content/school/print-documents');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));

    const published = await runSchoolDocs(['publish', 'quiz.yml', '--data-dir', dataDir]);
    expect(published.exitCode).toBe(0);
    const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);

    // Mint the card the instance will point at, exactly as a real issuance would.
    const minted = await runSchoolDocs([
      'render', publishedFile, '--out', path.join(root, 'first.pdf'), '--data-dir', dataDir,
      '--fresh-card', '--learner-id', 'felix', '--learner-name', 'Felix', '--date', '14 Aug 2026',
    ]);
    expect(minted.exitCode).toBe(0);
    const cardId = minted.report.allocation.cardId;

    const instancesDir = path.join(dataDir, 'household/apps/school/worksheet-instances');
    await mkdir(instancesDir, { recursive: true });
    await writeFile(path.join(instancesDir, 'ws-fixture.yml'), dump({
      id: 'ws-fixture',
      sessionId: 'ses_fixture',
      learnerId: 'felix',
      documentId: 'teacher-cli-fixture',
      documentRevision: published.report.rev,
      issuedAt: '2026-08-14T17:55:20.033Z',
      omr: {
        cardId, recordId: minted.report.allocation.recordId, rowRange: minted.report.allocation.rowRange,
      },
    }));

    const { exitCode, report } = await runSchoolDocs([
      'reprint', 'ws-fixture', '--out', path.join(root, 'reprinted.pdf'), '--data-dir', dataDir,
    ]);

    expect(exitCode).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.allocation).toMatchObject({ cardId, status: 'live' });

    const text = await pdfText(path.join(root, 'reprinted.pdf'));
    expect(text).toContain('Felix');
    expect(text).toContain('14 Aug 2026');
    expect(text).toContain(cardId);
  }));

  it('never mutates the allocation store — reprinting twice yields byte-identical PDFs', async () => withTmpDir(async (root) => {
    const dataDir = path.join(root, 'data');
    const contentRoot = path.join(dataDir, 'content/school/print-documents');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(path.join(contentRoot, 'quiz.yml'), dump(sourceQuizDoc()));
    const published = await runSchoolDocs(['publish', 'quiz.yml', '--data-dir', dataDir]);
    const publishedFile = path.join(contentRoot, 'published', `teacher-cli-fixture@${published.report.rev}.yml`);
    const minted = await runSchoolDocs([
      'render', publishedFile, '--out', path.join(root, 'first.pdf'), '--data-dir', dataDir,
      '--fresh-card', '--learner-id', 'felix', '--learner-name', 'Felix', '--date', '14 Aug 2026',
    ]);
    const cardId = minted.report.allocation.cardId;
    const instancesDir = path.join(dataDir, 'household/apps/school/worksheet-instances');
    await mkdir(instancesDir, { recursive: true });
    await writeFile(path.join(instancesDir, 'ws-fixture.yml'), dump({
      id: 'ws-fixture',
      sessionId: 'ses_fixture',
      learnerId: 'felix',
      documentId: 'teacher-cli-fixture',
      documentRevision: published.report.rev,
      issuedAt: '2026-08-14T17:55:20.033Z',
      omr: {
        cardId, recordId: minted.report.allocation.recordId, rowRange: minted.report.allocation.rowRange,
      },
    }));

    await runSchoolDocs(['reprint', 'ws-fixture', '--out', path.join(root, 'a.pdf'), '--data-dir', dataDir]);
    await runSchoolDocs(['reprint', 'ws-fixture', '--out', path.join(root, 'b.pdf'), '--data-dir', dataDir]);

    const [a, b] = await Promise.all([
      readFile(path.join(root, 'a.pdf')), readFile(path.join(root, 'b.pdf')),
    ]);
    expect(a.equals(b)).toBe(true);

    const allocationRaw = await readFile(path.join(contentRoot, 'allocations', `${cardId}.yml`), 'utf8');
    expect(allocationRaw.match(/status: live/g)?.length).toBe(1); // still exactly one live record — no duplicate written
  }));

  it('fails clearly when the instance id does not resolve to a file', async () => withTmpDir(async (root) => {
    const dataDir = path.join(root, 'data');
    await mkdir(dataDir, { recursive: true });
    const { exitCode, report } = await runSchoolDocs(['reprint', 'nope', '--out', path.join(root, 'x.pdf'), '--data-dir', dataDir]);
    expect(exitCode).toBe(1);
    expect(report.errors[0]).toMatch(/nope/);
  }));
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run cli/school-docs.cli.test.mjs -t reprint`
Expected: FAIL — `Unknown command: reprint`

**Step 3: Write minimal implementation**

In `cli/school-docs.cli.mjs`, add imports (near the existing `RenderPrintDocument`/`createYamlBankReader` import):
```javascript
import { buildReprintContext } from '#apps/school/documents/reprintContext.mjs';
```
(`YamlAllocationStore` and `YamlPrintDocumentRepository` are already imported.)

Add a new flag set near the other `*_FLAGS` constants:
```javascript
const REPRINT_FLAGS = new Set([...COMMON_FLAGS, 'out']);
```

Add `'reprint'` to `KNOWN_COMMANDS` (line ~603) and to the `allowedFlags` map (line ~608-610):
```javascript
  const KNOWN_COMMANDS = new Set(['validate', 'publish', 'render', 'release-card', 'list-cards', 'reprint']);
  ...
  const allowedFlags = {
    validate: VALIDATE_FLAGS, publish: PUBLISH_FLAGS, render: RENDER_FLAGS, 'release-card': RELEASE_CARD_FLAGS, 'list-cards': LIST_CARDS_FLAGS, reprint: REPRINT_FLAGS,
  }[subcommand];
```

Add the dispatch branch in `runSchoolDocs`, right before the `// render` block near the end:
```javascript
  if (subcommand === 'reprint') {
    if (positional.length !== 1) {
      return usageResult(['reprint requires exactly one <instanceId> argument']);
    }
    let outValue;
    try {
      outValue = valueFlag(flags.out, '--out');
    } catch (error) {
      return usageResult([error.message]);
    }
    if (outValue === undefined) return usageResult(['--out needs a path']);
    const outPath = path.isAbsolute(outValue) ? path.resolve(outValue) : path.resolve(process.cwd(), outValue);
    const report = await runReprint({ instanceId: positional[0], outPath, paths });
    return { exitCode: report.ok ? EXIT_OK : EXIT_FAIL, report };
  }
```

Add the implementation function (near `runRender`, above `runReleaseCard`):
```javascript
/** `<dataDir>/household/apps/school/worksheet-instances/<instanceId>.yml` — the single-household convention this codebase's other worksheet-instance readers already use. */
function resolveWorksheetInstancePath(dataDir, instanceId) {
  return path.join(dataDir, 'household/apps/school/worksheet-instances', `${instanceId}.yml`);
}

/**
 * `reprint <instanceId>` (fixes the "human hand-reconstructs five flags" gap):
 * reads the ALREADY-PERSISTED worksheet instance (learner, issue date, card/
 * row assignment) and reproduces its render byte-for-byte, no flags needed.
 * Resolves the PUBLISHED document (never the raw source) the same way card
 * mode does in `runRender`, and always passes the instance's own `learnerId`/
 * `cardId`/`startRow`, which is what makes `RenderPrintDocument`'s allocation
 * store recognize this as the identical live record and return it unchanged
 * (`YamlAllocationStore.allocate`'s idempotent-reprint shortcut) rather than
 * writing a new one or colliding.
 *
 * @param {{instanceId: string, outPath: string, paths: {dataDir: string, contentRoot: string}}} args
 */
export async function runReprint({ instanceId, outPath, paths }) {
  const instancePath = resolveWorksheetInstancePath(paths.dataDir, instanceId);
  let instance;
  try {
    instance = loadYamlDocument(instancePath);
  } catch (error) {
    return {
      ok: false, mode: 'reprint', instanceId, out: outPath, pages: null, density: null, allocation: null, warnings: [],
      errors: [`could not read worksheet instance '${instanceId}' at ${instancePath}: ${error.message}`],
    };
  }

  const repository = new YamlPrintDocumentRepository({ directory: paths.contentRoot });
  const published = await repository.getPublished(instance.documentId, instance.documentRevision);
  if (!published) {
    return {
      ok: false, mode: 'reprint', instanceId, out: outPath, pages: null, density: null, allocation: null, warnings: [],
      errors: [`no published revision '${instance.documentRevision}' found for document '${instance.documentId}'`],
    };
  }

  let context;
  try {
    context = buildReprintContext(instance);
  } catch (error) {
    return {
      ok: false, mode: 'reprint', instanceId, out: outPath, pages: null, density: null, allocation: null, warnings: [],
      errors: [error.message],
    };
  }

  const banks = createYamlBankReader({ dataDir: paths.dataDir });
  const allocationStore = new YamlAllocationStore({ directory: paths.contentRoot });
  const useCase = new RenderPrintDocument({ repository, banks, allocationStore });

  try {
    const result = await useCase.execute({ document: published, context });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.bytes);
    return {
      ok: true,
      mode: 'reprint',
      instanceId,
      out: outPath,
      pages: result.pageCount,
      density: result.density,
      allocation: result.allocation ?? null,
      warnings: result.warnings,
      errors: [],
    };
  } catch (error) {
    return {
      ok: false, mode: 'reprint', instanceId, out: outPath, pages: null, density: null, allocation: null,
      warnings: [], errors: [error?.message ?? String(error)],
    };
  }
}
```

Add report formatting in `formatSchoolDocsReport` (mirror the `render` branch — reuse it by aliasing the mode check):
```javascript
  if (report.mode === 'render' || report.mode === 'reprint') {
```
(change the existing `if (report.mode === 'render') {` line to the above — the render/reprint report shapes are identical, so one branch formats both.)

Update `HELP` text: add `school-docs.cli.mjs reprint <instanceId> --out <pdf>` to Usage, and:
```
  reprint <instanceId>   reproduce an exact historical print from a
                         persisted worksheet-instance file — same learner
                         name, date, card number, row range, question
                         order/content — no manual flags needed.
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run cli/school-docs.cli.test.mjs -t reprint`
Expected: PASS (3 tests)

Then run the full CLI suite to confirm no regressions from the `formatSchoolDocsReport` branch merge:
Run: `npx vitest run cli/school-docs.cli.test.mjs`
Expected: PASS (all)

**Step 5: Commit**

```bash
git add cli/school-docs.cli.mjs cli/school-docs.cli.test.mjs
git commit -m "feat(school-docs): add 'reprint <instanceId>' — reproduce a historical print with no manual flags"
```

---

### Task 4: Update docs

**Files:**
- Modify: `docs/reference/school/print-documents.md`

**Step 1:** Add a short section (near wherever the CLI commands are documented) describing `reprint <instanceId>`: what it's for (exact reproduction of a historical print, keyed by worksheet-instance id — the CLI has no ambiguity-tolerant cardId lookup because one card can hold multiple documents/records), and that it never mutates the allocation store when the instance's own live record still matches.

**Step 2: Commit**

```bash
git add docs/reference/school/print-documents.md
git commit -m "docs(school): document the reprint <instanceId> CLI command"
```

---

## Track B — card-number footer, remove the blank continuation strip

### Task 5: `furniture.mjs` — drop the continuation strip, footer gains the card number

**Files:**
- Modify: `backend/src/1_rendering/school/documents/furniture.mjs`
- Modify: `backend/src/1_rendering/school/documents/workbookTheme.mjs`
- Test: `backend/src/1_rendering/school/documents/furniture.test.mjs`

**Step 1: Write the failing test**

Read the existing `backend/src/1_rendering/school/documents/furniture.test.mjs` first (it has an existing `describe('furniture — contentBox')` and a `describe` for `drawFurniture`, using a `createRecorder()` stub — reuse both). Replace/add tests reflecting the new contract:

```javascript
describe('furniture — contentBox', () => {
  it('reserves only the footer band out of pageHeightPt, no gutter by default', () => {
    const box = contentBox(theme, {});
    expect(box.pageHeightPt).toBeCloseTo(theme.page.heightPt - theme.furniture.footerBandPt, 6);
    expect(box.marginPt).toBe(theme.page.marginPt);
    expect(box.gutterPt).toBe(0);
    expect(box.contentLeftPt).toBe(theme.page.marginPt);
  });
});

describe('furniture — drawFurniture footer', () => {
  it('prints plain "Page X of Y" when no cardId is given', () => {
    const { chain, calls } = createRecorder();
    drawFurniture(chain, { theme, page: 2, pageCount: 3 });
    const texts = textCalls(calls).map((c) => c.str);
    expect(texts).toEqual(['Page 2 of 3']);
  });

  it('appends the card number, delimited, when cardId is given — on every page, not just 2+', () => {
    const { chain, calls } = createRecorder();
    drawFurniture(chain, {
      theme, page: 1, pageCount: 2, cardId: '5922785',
    });
    const texts = textCalls(calls).map((c) => c.str);
    expect(texts).toEqual(['Page 1 of 2 · 5922785']);
  });

  it('never draws a title or a "Name:" line — the continuation strip is gone', () => {
    const { chain, calls } = createRecorder();
    drawFurniture(chain, {
      theme, page: 2, pageCount: 2, cardId: '5922785',
    });
    const texts = textCalls(calls).map((c) => c.str);
    expect(texts.some((t) => t.includes('Name:'))).toBe(false);
    expect(texts).toEqual(['Page 2 of 2 · 5922785']);
  });
});
```

Delete (or rewrite, per the above) any pre-existing test asserting `continuationStripPt`, the strip's title/name-line content, or "omits the continuation strip on page 1" — those assertions describe behavior this task removes. Grep first to find them all: `grep -n "continuation\|nameLine\|BLANK_RULE\|stripTitle" backend/src/1_rendering/school/documents/furniture.test.mjs`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/1_rendering/school/documents/furniture.test.mjs`
Expected: FAIL (old tests still reference the removed strip; new tests fail because `drawFurniture` doesn't accept/use `cardId` yet)

**Step 3: Write minimal implementation**

In `backend/src/1_rendering/school/documents/workbookTheme.mjs`, remove `continuationStripPt` from the `furniture` block (line ~325):
```javascript
    furniture: {
      footerBandPt: density === 'compact' ? 22 : 28,
      gutterPt: 18,
```
(drop the `continuationStripPt: ...,` line entirely — grep the file for any other reference first: `grep -n continuationStripPt backend/src/1_rendering/school/documents/workbookTheme.mjs` should show nothing left after this edit.)

In `backend/src/1_rendering/school/documents/furniture.mjs`:

1. Delete the `BLANK_RULE` constant (line 58) and the entire `drawContinuationStrip` function (lines 140-157) — dead code, nothing calls it anymore.

2. Update `contentBox` (line 105):
```javascript
  const reservedBottomPt = furniture.footerBandPt;
```

3. Update `drawFooterBand` to accept and print `cardId`:
```javascript
/** The "page x of y" band — drawn on every page; appends " · <cardId>" when card-attached, so a stray page can be matched back to its physical answer card by number alone. */
function drawFooterBand(doc, theme, {
  xPt, widthPt, topPt, page, pageCount, cardId,
}) {
  const { footer } = theme;
  setFont(doc, theme, 'regular', footer.sizePt, 'muted');
  const textYPt = theme.page.heightPt - footer.bottomInsetPt - footer.sizePt;
  const text = cardId ? `Page ${page} of ${pageCount} · ${cardId}` : `Page ${page} of ${pageCount}`;
  doc.text(text, xPt, textYPt, {
    width: widthPt, align: 'center', lineBreak: false,
  });
}
```

4. Update `drawFurniture` — drop `title`/`nameLine`, add `cardId`, drop the strip call and its geometry:
```javascript
/**
 * Draw one page's footer — "Page X of Y", plus the card number when this
 * render is card-attached — gutter-adjusted horizontally.
 *
 * Called once per page, after that page's own fragments are drawn.
 *
 * @param {Object} doc - a pdfkit document (or anything exposing the same
 *   `.font/.fontSize/.fillColor/.text` chainable surface)
 * @param {Object} opts
 * @param {Object} opts.theme - workbook-family theme (`page`, `furniture`, `footer`, `styles`)
 * @param {number} opts.page - 1-based page number being drawn
 * @param {number} opts.pageCount - total pages in the document
 * @param {string|number|null} [opts.cardId=null] - the physical OMR card/student
 *   number this render is attached to; appended to the footer so a page that
 *   gets separated from its stack can be matched back by number. Null for a
 *   render with no card context — the footer stays a plain "Page X of Y".
 * @param {boolean} [opts.duplex=false] - alternate gutter side by page parity
 * @param {boolean|number} [opts.gutter=false] - gutter width; see `contentBox`
 */
export function drawFurniture(doc, {
  theme, page, pageCount, cardId = null, duplex = false, gutter = false,
}) {
  if (!theme?.page || !theme?.furniture) {
    throw new Error('drawFurniture: theme must carry page + furniture tokens');
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`drawFurniture: page must be a positive integer, got ${page}`);
  }
  if (!Number.isInteger(pageCount) || pageCount < page) {
    throw new Error(`drawFurniture: pageCount (${pageCount}) must be an integer >= page (${page})`);
  }

  const pageIndex = page - 1;
  const { xPt: contentLeftPt, widthPt: contentWidthPt } = contentBox(theme, { gutter, duplex, pageIndex });
  const { furniture, page: pageTheme } = theme;
  const footerTopPt = pageTheme.heightPt - pageTheme.marginPt - furniture.footerBandPt;

  drawFooterBand(doc, theme, {
    xPt: contentLeftPt, widthPt: contentWidthPt, topPt: footerTopPt, page, pageCount, cardId,
  });
}
```

5. Update the module doc comment at the top (lines 1-56) — it currently describes the continuation strip and the "reserved on every page, painted only on 2+" model at length; trim it to describe the footer-only reservation. Minimal edit: replace the second paragraph and the "## Reservation model" section's continuation-strip-specific prose with a short note that the footer band is the only reserved bottom furniture now, and that it always carries the card number when one is attached (no page-1-only asymmetry to explain anymore, since the footer already drew on every page before this change too).

**Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/1_rendering/school/documents/furniture.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_rendering/school/documents/furniture.mjs backend/src/1_rendering/school/documents/workbookTheme.mjs backend/src/1_rendering/school/documents/furniture.test.mjs
git commit -m "fix(school-docs): footer prints card number instead of a blank continuation-strip name line"
```

---

### Task 6: Thread `cardId` from `DocumentPdfRenderer` into `drawFurniture`, drop `title`/`nameLine` from furniture options

**Files:**
- Modify: `backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs:1027-1039`
- Modify: `backend/src/3_applications/school/documents/RenderPrintDocument.mjs` (the `furnitureOpts` build, ~line 849-854)
- Test: `backend/src/1_rendering/school/documents/DocumentPdfRenderer.test.mjs` and/or `backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs` (whichever already asserts on furniture/footer text — grep first: `grep -rn "Page.*of\|continuation\|stripTitle" backend/src/1_rendering/school/documents/DocumentPdfRenderer.test.mjs backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs`)

**Step 1: Write/update the failing test**

Find the existing test(s) that render a real multi-page card-attached document and inspect page-2 text (`RenderPrintDocument.test.mjs:380-414` was flagged by research as asserting on `stripTitle` under duplex — read that block first). Replace its "strip title flips under duplex" assertion with one confirming the footer carries the card number on the relevant page. Also add, if not already covered, a small end-to-end assertion in `DocumentPdfRenderer.test.mjs`:

```javascript
it('footer carries the card number when the render is card-attached', async () => {
  const renderer = createDocumentPdfRenderer({ theme, texToSvg });
  const doc = /* existing multi-page furniture fixture from this file */;
  const result = await renderer.render(doc, {
    furniture: { title: 'X', nameLine: null }, // title/nameLine now ignored by furniture — harmless to pass
    card: { cardId: '5922785', startRow: 1, endRow: 2, firstUse: false },
  });
  const text = await pdfText(result.pdf); // use whatever PDF-text helper this test file already imports
  expect(text).toContain('5922785');
});
```
(Adapt to whatever fixture-building helpers already exist in that test file — don't invent a new PDF-text extraction utility if `tests/_lib/school/pdfText.mjs` is already imported elsewhere in the suite.)

**Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/1_rendering/school/documents/DocumentPdfRenderer.test.mjs backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

In `DocumentPdfRenderer.mjs`, update the `drawFurniture` call site (lines 1027-1036):
```javascript
        if (furniture) {
          drawFurniture(out, {
            theme,
            page: index + 1,
            pageCount: pages.length,
            cardId: card?.cardId ?? null,
            duplex: furniture.duplex,
            gutter: furniture.gutter,
          });
        } else {
          drawFooter(out, { page: index + 1, pageCount: pages.length, variant: document.variant ?? 0 });
        }
```
(dropped `title`/`nameLine`, added `cardId`.)

In `RenderPrintDocument.mjs`, simplify `furnitureOpts` (~line 849-854) — `title`/`nameLine` are no longer read by anything:
```javascript
    const furnitureOpts = {
      gutter,
      duplex: DUPLEX_ARCHETYPES.has(document.archetype),
    };
```
Grep the rest of `RenderPrintDocument.mjs` for any other read of `furnitureOpts.title`/`furnitureOpts.nameLine` before removing (`grep -n "furnitureOpts\." backend/src/3_applications/school/documents/RenderPrintDocument.mjs`) — there should be none besides the `contentBox(theme, furnitureOpts)` call at `#measureAttempt`, which only reads `gutter`/`duplex`/`pageIndex`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/1_rendering/school/documents/DocumentPdfRenderer.test.mjs backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs`
Expected: PASS

Then run the full doc-rendering suite to catch any other test relying on the old `furnitureOpts.title`/`nameLine` shape:
Run: `npx vitest run backend/src/1_rendering/school/documents backend/src/3_applications/school/documents`
Expected: PASS. Fix any remaining red tests that reference `title`/`nameLine` in a `furniture:` render option the same way — update their assertions to check the footer's card number instead, following Step 1's pattern.

**Step 5: Commit**

```bash
git add backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs backend/src/3_applications/school/documents/RenderPrintDocument.mjs backend/src/1_rendering/school/documents/DocumentPdfRenderer.test.mjs backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs
git commit -m "fix(school-docs): thread card number into the page footer, drop unused furniture title/nameLine"
```

---

### Task 7: Fix `acceptance.phaseA.test.mjs` and update docs

**Files:**
- Modify: `backend/src/3_applications/school/documents/acceptance.phaseA.test.mjs` (lines flagged by research: ~171, 192-213, 544)
- Modify: `docs/reference/school/print-documents.md:153`

**Step 1:** Read the flagged sections. Update the footer assertion (~192-194) to still expect `"Page N of 2"` (unchanged for a non-card render) and remove/replace the continuation-strip content assertions (~197-213, and the `footerBandPt`/`continuationStripPt` both-greater-than-zero assertion) with an assertion that `contentBox`'s reservation now equals `footerBandPt` alone. Update the page-2 visual snapshot test (~544) if it's a literal rendered-text/pixel comparison — regenerate it against the new output.

**Step 2: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/school/documents/acceptance.phaseA.test.mjs`
Expected: PASS

**Step 3:** Update `docs/reference/school/print-documents.md:153` — replace "page furniture (x-of-y footers, continuation strips, duplex gutters)" with "page furniture (x-of-y footers with the card number when card-attached, duplex gutters)".

**Step 4: Commit**

```bash
git add backend/src/3_applications/school/documents/acceptance.phaseA.test.mjs docs/reference/school/print-documents.md
git commit -m "test(school-docs): update phaseA acceptance suite for the card-number footer"
```

---

## Track C — balanced page fill + max-gap cap

### Task 8: `layout.mjs` — extract the placement loop, add balanced two-pass placement

**Files:**
- Modify: `backend/src/1_rendering/school/documents/layout.mjs`
- Create: `backend/src/1_rendering/school/documents/layout.test.mjs` (none exists today)

**Step 1: Write the failing test**

```javascript
// backend/src/1_rendering/school/documents/layout.test.mjs
import { describe, it, expect } from 'vitest';
import { placeFragments, contentHeightPt } from './layout.mjs';

const SPACING = { question: { question: 14 } };

/** N identical fixed-height question fragments, no answerSpace/fillAfter — pure bin-packing fixture. */
const questions = (count, heightPt = 60) => Array.from({ length: count }, (_, i) => ({
  id: `q${i + 1}`, heightPt, atomic: true, spacingClass: 'question',
}));

describe('placeFragments — balance', () => {
  it('without balance: greedily overpacks page 1, leaves page 2 sparse (baseline reproduction of the reported bug)', () => {
    // Page usable height ~700pt (750 - 2*margin below); 60pt fragments + 14pt gaps
    // pack ~7 per page greedily before a same-size 8th doesn't fit.
    const { pages } = placeFragments(questions(10), {
      pageHeightPt: 750, marginPt: 25, spacing: SPACING,
    });
    expect(pages.length).toBe(2);
    expect(pages[0].fragments.length).toBeGreaterThan(pages[1].fragments.length + 1); // confirms the imbalance exists without balance:true
  });

  it('with balance: splits evenly across the same page count', () => {
    const { pages } = placeFragments(questions(10), {
      pageHeightPt: 750, marginPt: 25, spacing: SPACING, balance: true,
    });
    expect(pages.length).toBe(2);
    expect(pages[0].fragments.length).toBe(5);
    expect(pages[1].fragments.length).toBe(5);
  });

  it('balance never increases page count vs the unbalanced placement (falls back on disagreement)', () => {
    // One oversized fragment among small ones: forces the safety fallback if
    // the soft-target break would otherwise strand it awkwardly.
    const mixed = [{ id: 'big', heightPt: 650, atomic: true, spacingClass: 'question' }, ...questions(6, 20)];
    const unbalanced = placeFragments(mixed, { pageHeightPt: 750, marginPt: 25, spacing: SPACING });
    const balanced = placeFragments(mixed, {
      pageHeightPt: 750, marginPt: 25, spacing: SPACING, balance: true,
    });
    expect(balanced.pages.length).toBeLessThanOrEqual(unbalanced.pages.length);
  });

  it('balance is a no-op for a single-page document', () => {
    const unbalanced = placeFragments(questions(3), { pageHeightPt: 750, marginPt: 25, spacing: SPACING });
    const balanced = placeFragments(questions(3), {
      pageHeightPt: 750, marginPt: 25, spacing: SPACING, balance: true,
    });
    expect(balanced.pages.length).toBe(1);
    expect(balanced.pages).toEqual(unbalanced.pages);
  });
});

describe('placeFragments — maxFillAfterPt caps fillAfter growth', () => {
  const flexQuestion = (id) => ({
    id, heightPt: 40, atomic: true, spacingClass: 'question', fillAfter: true,
  });

  it('uncapped (default Infinity): a big spare consumes all of it in one gap, same as before this change', () => {
    const { pages } = placeFragments([flexQuestion('a'), flexQuestion('b'), flexQuestion('c')], {
      pageHeightPt: 750, marginPt: 25, spacing: SPACING, growLastPage: true,
    });
    const [a, b] = pages[0].fragments;
    expect(b.yPt - (a.yPt + a.heightPt)).toBeGreaterThan(200); // the reported bug: an enormous single gap
  });

  it('capped: no single fillAfter gap exceeds maxFillAfterPt, remainder is left as blank trailing space', () => {
    const { pages } = placeFragments([flexQuestion('a'), flexQuestion('b'), flexQuestion('c')], {
      pageHeightPt: 750, marginPt: 25, spacing: SPACING, growLastPage: true, maxFillAfterPt: 30,
    });
    const [a, b, c] = pages[0].fragments;
    expect(b.yPt - (a.yPt + a.heightPt)).toBeLessThanOrEqual(30 + SPACING.question.question + 0.01);
    expect(c.yPt - (b.yPt + b.heightPt)).toBeLessThanOrEqual(30 + SPACING.question.question + 0.01);
    const bottomOfContent = c.yPt + c.heightPt;
    expect(700 - bottomOfContent).toBeGreaterThan(0); // real leftover space now sits blank at the page bottom
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/1_rendering/school/documents/layout.test.mjs`
Expected: FAIL — `balance`/`maxFillAfterPt` options don't exist yet; page split is still the greedy 7/3-style imbalance.

**Step 3: Write minimal implementation**

Extract the existing `placeFragments` while-loop into a private `runPlacement` helper parametrized by an optional soft per-page target, then have `placeFragments` call it once (unbalanced) and, when `balance` is requested and there's more than one page, once more (balanced) — keeping the unbalanced result as a safety fallback if the balanced pass would produce a different page count. Also thread `maxFillAfterPt` into `distributeAnswerSpace`.

Replace the whole `placeFragments` function (lines 232-340) and the `distributeAnswerSpace` function (lines 129-177) with:

```javascript
/**
 * Grows the page's answer spaces into its trailing free space, evenly, each
 * capped at its own maxPt, with the remainder re-shared among those still
 * below their cap. Any space still left over after answer spaces distributes
 * CSS-`space-around`-style among `fillAfter` fragments — capped at
 * `maxFillAfterPt` PER SHARE so a sparse page never balloons into one huge
 * gap between two questions; whatever a cap leaves unconsumed simply stays
 * blank at the bottom of the page, which is the point (spec: prefer trailing
 * blank space over an oversized interior gap).
 */
function distributeAnswerSpace(pageFragments, contentTopPt, contentBottomPt, spacing, maxFillAfterPt = Infinity) {
  const last = pageFragments[pageFragments.length - 1];
  let sparePt = contentBottomPt - (last.yPt + last.heightPt);
  if (sparePt <= EPSILON) return;

  let growable = pageFragments
    .filter((fragment) => fragment.answerSpace)
    .map((fragment) => ({ fragment, headroomPt: fragment.answerSpace.maxPt - fragment.heightPt }))
    .filter((entry) => entry.headroomPt > EPSILON);

  while (sparePt > EPSILON && growable.length > 0) {
    const share = sparePt / growable.length;
    let consumed = 0;
    const stillGrowable = [];
    for (const entry of growable) {
      const growth = Math.min(share, entry.headroomPt);
      entry.fragment.heightPt += growth;
      entry.headroomPt -= growth;
      consumed += growth;
      if (entry.headroomPt > EPSILON) stillGrowable.push(entry);
    }
    if (consumed <= EPSILON) break;
    sparePt -= consumed;
    growable = stillGrowable;
  }

  let leadingFillPt = 0;
  if (sparePt > EPSILON) {
    const flexible = pageFragments.filter((fragment) => fragment.fillAfter === true);
    if (flexible.length) {
      const share = Math.min(sparePt / flexible.length, maxFillAfterPt);
      leadingFillPt = share / 2;
      flexible.slice(0, -1).forEach((fragment) => { fragment.heightPt += share; });
    }
  }

  reflow(pageFragments, contentTopPt, spacing, leadingFillPt);
}

/**
 * One greedy forward pass, exactly the algorithm this function always ran.
 * `targetPerPagePt`, when given, forces an EARLIER page break once a
 * non-empty page's accumulated height reaches it — the true page-height
 * ceiling (`contentBottomPt`) still governs the per-fragment fit check below
 * unchanged, so a single oversized fragment can never be wrongly rejected
 * just because it exceeds the soft target; it only ever gets its own page
 * started early, same as it always could.
 */
function runPlacement(fragments, {
  contentTopPt, contentBottomPt, spacing, targetPerPagePt = null,
}) {
  const errors = [];
  const queue = fragments.map((fragment) => normalizeFragment(fragment, errors));
  const pages = [];

  let pageFragments = [];
  let cursor = contentTopPt;
  let previousClass = null;

  const startNewPage = () => {
    pages.push({ fragments: pageFragments });
    pageFragments = [];
    cursor = contentTopPt;
    previousClass = null;
  };

  while (queue.length > 0) {
    const fragment = queue.shift();
    const pageIsEmpty = pageFragments.length === 0;

    if (fragment.forceBreak) {
      if (!pageIsEmpty) startNewPage();
      continue;
    }

    // Balanced placement (fit policy `fill`'s rebalance pass): once a page has
    // reached its soft target height, stop adding to it, even though the
    // hard page-height ceiling below might still have room.
    if (targetPerPagePt !== null && !pageIsEmpty && (cursor - contentTopPt) >= targetPerPagePt - EPSILON) {
      queue.unshift(fragment);
      startNewPage();
      continue;
    }

    const gapPt = gapBetween(spacing, previousClass, fragment.spacingClass);
    const availablePt = contentBottomPt - cursor - gapPt;

    if (fragment.heightPt <= availablePt + EPSILON) {
      if (fragment.stickToNextId && !pageIsEmpty) {
        const partner = queue[0];
        if (partner && partner.id === fragment.stickToNextId) {
          const cursorAfterFragment = cursor + gapPt + fragment.heightPt;
          const gapToPartner = gapBetween(spacing, fragment.spacingClass, partner.spacingClass);
          const partnerAvailablePt = contentBottomPt - cursorAfterFragment - gapToPartner;
          if (partner.heightPt > partnerAvailablePt + EPSILON) {
            queue.unshift(fragment);
            startNewPage();
            continue;
          }
        }
      }
      fragment.yPt = cursor + gapPt;
      cursor = fragment.yPt + fragment.heightPt;
      previousClass = fragment.spacingClass;
      pageFragments.push(fragment);
      continue;
    }

    if (Array.isArray(fragment.lines) && !fragment.atomic) {
      const linesBefore = chooseBreakPoint(fragment, availablePt, pageIsEmpty);
      if (linesBefore >= 1) {
        const [head, tail] = splitFragment(fragment, linesBefore);
        head.yPt = cursor + gapPt;
        pageFragments.push(head);
        queue.unshift(tail);
        startNewPage();
        continue;
      }
    }

    if (pageIsEmpty) {
      errors.push(overflowError(fragment));
      continue;
    }

    queue.unshift(fragment);
    startNewPage();
  }

  if (pageFragments.length > 0) pages.push({ fragments: pageFragments });
  return { pages, errors };
}

export function placeFragments(fragments, {
  pageHeightPt, marginPt, spacing = {}, growLastPage = false, balance = false, maxFillAfterPt = Infinity,
}) {
  const contentTopPt = marginPt;
  const contentBottomPt = pageHeightPt - marginPt;
  if (!(contentBottomPt - contentTopPt > 0)) {
    throw new Error(`page geometry leaves no content height: ${pageHeightPt}pt page, ${marginPt}pt margins`);
  }

  let { pages, errors } = runPlacement(fragments, { contentTopPt, contentBottomPt, spacing });

  if (balance && errors.length === 0 && pages.length > 1) {
    const totalContentPt = contentHeightPt(fragments, { spacing });
    const targetPerPagePt = totalContentPt / pages.length;
    const rebalanced = runPlacement(fragments, {
      contentTopPt, contentBottomPt, spacing, targetPerPagePt,
    });
    // Only adopt the rebalanced layout if it didn't change the page count —
    // never let balancing make pagination WORSE than the unbalanced pass.
    if (rebalanced.errors.length === 0 && rebalanced.pages.length === pages.length) {
      ({ pages, errors } = rebalanced);
    }
  }

  // Trailing space on the last page belongs to the document, not the
  // answers — UNLESS `growLastPage` (fit policy `fill`) asks the last page to
  // bottom out too, in which case it grows exactly like every other page.
  const pagesToGrow = growLastPage ? pages : pages.slice(0, -1);
  for (const finished of pagesToGrow) {
    distributeAnswerSpace(finished.fragments, contentTopPt, contentBottomPt, spacing, maxFillAfterPt);
  }

  return { pages, errors };
}
```

Update the `placeFragments` JSDoc block above it (currently lines 179-196) to document the two new options (`balance`, `maxFillAfterPt`), following the existing `growLastPage` doc style.

**Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/1_rendering/school/documents/layout.test.mjs`
Expected: PASS (8 tests)

Then run every existing consumer of `placeFragments` to confirm the extraction changed nothing for callers that don't pass `balance`/`maxFillAfterPt`:
Run: `npx vitest run backend/src/1_rendering/school/documents backend/src/3_applications/school/documents`
Expected: PASS (unchanged — defaults reproduce prior behavior exactly, per the `Infinity`/`false` defaults).

**Step 5: Commit**

```bash
git add backend/src/1_rendering/school/documents/layout.mjs backend/src/1_rendering/school/documents/layout.test.mjs
git commit -m "feat(school-docs): add balanced page placement + max fill-gap cap to placeFragments"
```

---

### Task 9: Thread `balance` through `fit.mjs` → `RenderPrintDocument.mjs` → `DocumentPdfRenderer.mjs`; thread `maxFillAfterPt` from theme

**Files:**
- Modify: `backend/src/2_domains/school/documents/fit.mjs:34-40`
- Modify: `backend/src/3_applications/school/documents/RenderPrintDocument.mjs` (~line 916-933)
- Modify: `backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs` (render/renderPlaced signatures + the student-page `placeFragments` call, ~lines 859-908, 1137-1166)
- Modify: `backend/src/1_rendering/school/documents/workbookTheme.mjs` (new `pagination` theme section)
- Test: `backend/src/2_domains/school/documents/fit.test.mjs` (none exists today — create it), `backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/src/2_domains/school/documents/fit.test.mjs
import { describe, it, expect } from 'vitest';
import { resolveFitPlan } from './fit.mjs';

describe('resolveFitPlan — fill', () => {
  it('sets both growLastPage and balance', () => {
    const { attempt } = resolveFitPlan({
      policy: 'fill',
      attempts: [{ density: 'normal', pageCount: 2, oversetPt: 0 }],
    });
    expect(attempt.growLastPage).toBe(true);
    expect(attempt.balance).toBe(true);
  });
});

describe('resolveFitPlan — flow/one-page do not request balance', () => {
  it('flow', () => {
    const { attempt } = resolveFitPlan({
      policy: 'flow',
      attempts: [{ density: 'normal', pageCount: 2, oversetPt: 0 }],
    });
    expect(attempt.balance).toBeUndefined();
  });
});
```

Add to `RenderPrintDocument.test.mjs` (near the existing `growLastPage` threading test flagged by research at ~151-182): an assertion that a `fit.policy: fill` document with enough questions to force 2 pages ends up with a roughly even fragment count split — easiest to verify indirectly via `result.pageCount` staying stable and (if the test file already has a way to inspect placed fragments/page text) checking question numbers present on each page. Follow whatever pattern that existing `growLastPage` test already uses for inspecting render output; mirror it for `balance`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/documents/fit.test.mjs backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

`fit.mjs` (lines 34-40):
```javascript
  if (policy === 'fill') {
    // Fit policy `fill` (spec §7) is the ONLY policy that inverts
    // `placeFragments`'s deliberate last-page growth exclusion (`growLastPage`)
    // AND asks for balanced page assignment (`balance`) — see layout.mjs.
    return { attempt: { ...normalAttempt, growLastPage: true, balance: true } };
  }
```

`workbookTheme.mjs` — add a new theme section near `footer`/`furniture` (~line 197):
```javascript
    /**
     * Layout-quality bounds that aren't part of the fixed spacing table
     * (`spacing[prevClass][nextClass]`) because they only apply to GROWTH —
     * how far `distributeAnswerSpace` (layout.mjs) is allowed to stretch a
     * `fillAfter` gap before leaving the remainder as blank trailing space
     * instead. Scaled by density like everything else.
     */
    pagination: {
      maxFillGrowthPt: density === 'compact' ? 22 : 32,
    },
```

`DocumentPdfRenderer.mjs`:
- `renderPlaced` signature (line 859-861): add `balance = false,`.
- Its `placeFragments` call (lines 900-908): add
  ```javascript
      balance,
      maxFillAfterPt: theme.pagination?.maxFillGrowthPt ?? Infinity,
  ```
- `render` signature (lines 1137-1140): add `balance = false,`.
- Both `renderPlaced(...)` calls inside `render` (lines 1156-1159, 1162-1165): add `balance,` to the options object passed through.
- Update the `@param {boolean} [options.growLastPage]` JSDoc block (~1100-1103) with a matching `@param {boolean} [options.balance]` entry: "fit policy `fill`: forwarded to `placeFragments`'s `balance`, so fragments are redistributed evenly across the already-decided page count instead of greedily overpacking early pages. Default false reproduces every existing render byte-for-byte."

`RenderPrintDocument.mjs` — the `renderer.render(document, {...})` call (~line 916-933): add
```javascript
      balance: chosen.balance ?? false,
```
right next to the existing `growLastPage: chosen.growLastPage ?? false,` line.

**Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/2_domains/school/documents/fit.test.mjs backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs`
Expected: PASS

Run the full School print-document suite:
Run: `npx vitest run backend/src/1_rendering/school/documents backend/src/2_domains/school/documents backend/src/3_applications/school/documents cli/school-docs.cli.test.mjs`
Expected: PASS, all tracks.

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/documents/fit.mjs backend/src/2_domains/school/documents/fit.test.mjs backend/src/3_applications/school/documents/RenderPrintDocument.mjs backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs backend/src/1_rendering/school/documents/workbookTheme.mjs
git commit -m "feat(school-docs): fit policy fill now balances pages and caps fillAfter growth end-to-end"
```

---

### Task 10: Update docs

**Files:**
- Modify: `docs/reference/school/print-documents.md` (the `fill` policy description, ~line 95-98)

**Step 1:** Replace "`fill` grows answer spaces into leftover page space" with something like: "`fill` balances question count evenly across the page count `flow` would have produced, then grows answer spaces/spacers into any remaining leftover space, capped per-gap at `theme.pagination.maxFillGrowthPt` — anything beyond the cap is left as blank trailing space on the page rather than an oversized gap."

**Step 2: Commit**

```bash
git add docs/reference/school/print-documents.md
git commit -m "docs(school): describe fill policy's balanced placement and max-gap cap"
```

---

## Track D — printer adapter: default to double-sided (duplex) printing, config-driven

**Added after the initial plan was written** — a separate, independent defect: the physical print path (`LaserPrinterAdapter`, `backend/src/1_adapters/hardware/laser-printer/`), not the PDF pipeline Tracks A-C touch. Confirmed by direct code reading: this adapter does **not** use CUPS/`lp`/`lpr` at all — printing goes over raw JetDirect (port 9100) via a plain TCP socket, with the printer's own "PDF Direct Print" firmware feature parsing the raw bytes (`LaserPrinterAdapter.mjs:7-15`). IPP (port 631) is used only for `getStatus`/`ping`, never for the print job itself. No duplex/sides option is sent anywhere today (`printPdf` at `LaserPrinterAdapter.mjs:91-131` only handles `jobName`/`user`/`copies`).

Since there's no CUPS layer, the standard `-o sides=...` flag doesn't apply here. The mechanism that DOES apply to a raw JetDirect job is a **PJL (Printer Job Language) preamble/trailer** wrapped around the PDF bytes — `@PJL SET DUPLEX=ON` / `@PJL SET BINDING=LONGEDGE`, terminated by Universal Exit Language (`\x1B%-12345X`) escapes. This is the de facto standard most PJL-compliant laser printers (including HP's PJL spec, which Brother's firmware implements) honor for raw port-9100 jobs.

**Flag for whoever picks this up:** this PJL mechanism is standard and well-documented, but has **not been verified against the physical Brother HL-L2460DW this codebase targets** — no hardware test was run as part of writing this plan. Task 11 below explicitly calls out a real physical test print before this is trusted in the field. Label it as such in code comments too, per this project's own standing rule against asserting unverified device facts.

No config-data-file edit is required for this task: "config-driven" is satisfied by making the adapter's constructor accept `duplex`/`binding` options (default `true`/`'LONGEDGE'`) and wiring `app.mjs` to read them from `schoolFullConfig.printing`, if present — the household's actual `data/household/config/school.yml` (Dropbox-external on this dev machine, not part of this git worktree) is a separate, later change the user can make if they ever want to override the default; it needs no edit for double-sided to become the default.

### Task 11: `LaserPrinterAdapter` — PJL duplex wrapping, config-driven default

**Files:**
- Modify: `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs`
- Modify: `backend/src/1_adapters/hardware/laser-printer/VirtualLaserPrinterAdapter.mjs`
- Modify: `backend/src/app.mjs` (~lines 3304-3318, the `LaserPrinterAdapter` construction)
- Test: `tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs`, `tests/isolated/adapter/school/virtualLaserPrinter.test.mjs` (read both first — grep for existing byte-count/payload assertions, since PJL wrapping changes `payload.length`)

**Step 1: Write the failing test**

Add to `tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs` (read the file first to match its existing mock-socket harness style — it almost certainly already stubs `net.createConnection`; reuse that harness rather than inventing a new one):

```javascript
it('defaults to duplex ON with LONGEDGE binding, wrapped in a PJL preamble/trailer', async () => {
  // ... using whatever socket-capture harness this file already has ...
  const printer = new LaserPrinterAdapter({ host: '10.0.0.1', logger: silentLogger });
  await printer.printPdf(fakePdf(), { jobName: 'test-job' });
  const sent = capturedBytes(); // however this file already captures what was written to the socket
  const text = sent.toString('latin1');
  expect(text).toContain('@PJL SET DUPLEX=ON');
  expect(text).toContain('@PJL SET BINDING=LONGEDGE');
  expect(text).toContain('@PJL JOB NAME="test-job"');
  expect(text).toContain('%PDF-'); // the real PDF bytes are still in there, untouched
});

it('duplex can be disabled per-adapter (config-driven)', async () => {
  const printer = new LaserPrinterAdapter({ host: '10.0.0.1', duplex: false, logger: silentLogger });
  await printer.printPdf(fakePdf(), { jobName: 'test-job' });
  const text = capturedBytes().toString('latin1');
  expect(text).toContain('@PJL SET DUPLEX=OFF');
  expect(text).not.toContain('BINDING=');
});

it('duplex can be disabled per-job, overriding the adapter default', async () => {
  const printer = new LaserPrinterAdapter({ host: '10.0.0.1', logger: silentLogger }); // duplex defaults true
  await printer.printPdf(fakePdf(), { jobName: 'test-job', duplex: false });
  const text = capturedBytes().toString('latin1');
  expect(text).toContain('@PJL SET DUPLEX=OFF');
});
```

If the existing test file has an assertion like `expect(sentBytes.length).toBe(pdf.length)` or similar exact-byte-count checks from BEFORE this change, update them to account for the PJL header/trailer's added length (`sentBytes.length` should now equal `pdf.length + header.length + trailer.length`, or just assert `sentBytes.length > pdf.length` if exact byte-counting isn't the point of that particular test).

Add to `tests/isolated/adapter/school/virtualLaserPrinter.test.mjs`:

```javascript
it('records duplex/binding in the job sidecar, defaulting to true/LONGEDGE', async () => {
  const printer = new VirtualLaserPrinterAdapter({ captureDir: tmpDir });
  await printer.printPdf(fakePdf(), { jobName: 'x' });
  const [job] = printer.listJobs();
  expect(job.duplex).toBe(true);
  expect(job.binding).toBe('LONGEDGE');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs tests/isolated/adapter/school/virtualLaserPrinter.test.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

In `LaserPrinterAdapter.mjs`, add near the top (after the `PRINTER_STATE` const):

```javascript
/** Universal Exit Language — enters/exits PJL job-control mode around a raw print job. */
const UEL = '\x1B%-12345X';

/**
 * Standard PJL preamble/trailer around raw PDF bytes for a JetDirect (port
 * 9100) job — sets per-job DUPLEX/BINDING before the printer enters PDF
 * parsing mode. This is the de facto standard most PJL-compliant laser
 * printers honor (HP's PJL spec, which this Brother's firmware implements) —
 * UNVERIFIED against the physical HL-L2460DW as of writing; confirm with one
 * real duplex print before relying on it (see Task 11 of the print-document
 * fidelity plan).
 */
function pjlWrap(pdf, { jobName, duplex, binding }) {
  const safeName = String(jobName).replace(/"/g, "'");
  const header = [
    `${UEL}@PJL JOB NAME="${safeName}"`,
    `@PJL SET DUPLEX=${duplex ? 'ON' : 'OFF'}`,
    ...(duplex ? [`@PJL SET BINDING=${binding}`] : []),
    '@PJL ENTER LANGUAGE=PDF',
    '',
  ].join('\r\n');
  const trailer = `\r\n${UEL}@PJL EOJ\r\n${UEL}`;
  return Buffer.concat([Buffer.from(header, 'latin1'), pdf, Buffer.from(trailer, 'latin1')]);
}
```

Update the `LaserPrinterConfig` typedef (lines 26-34) — add:
```javascript
 * @property {boolean} [duplex=true] - default double-sided printing (config-driven; per-job override in printPdf)
 * @property {'LONGEDGE'|'SHORTEDGE'} [binding='LONGEDGE'] - duplex flip style; LONGEDGE = book-style, the right default for portrait text
```

Update the class field declarations (line 36) and constructor (lines 39-54):
```javascript
  #host; #port; #rawPort; #path; #timeout; #printTimeout; #duplexDefault; #bindingDefault; #logger;
  #requestId = 0;

  constructor({
    host, port = 631, rawPort = 9100, path = '/ipp/print', timeout = 15000, printTimeout = 60000,
    duplex = true, binding = 'LONGEDGE', logger = console,
  } = {}) {
    if (!host) {
      throw new InfrastructureError('LaserPrinterAdapter requires host', {
        code: 'MISSING_DEPENDENCY', dependency: 'host',
      });
    }
    this.#host = host;
    this.#port = port;
    this.#rawPort = rawPort;
    this.#path = path.startsWith('/') ? path : `/${path}`;
    this.#timeout = timeout;
    this.#printTimeout = printTimeout;
    this.#duplexDefault = duplex;
    this.#bindingDefault = binding;
    this.#logger = logger;
  }
```

Update `printPdf` (lines 91-99 specifically; the rest of the function body below is unchanged except where noted):
```javascript
  printPdf(pdf, {
    jobName = 'daylight-print', user = 'daylight', copies = 1,
    duplex = this.#duplexDefault, binding = this.#bindingDefault,
  } = {}) {
    if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
      return Promise.reject(new InfrastructureError('printPdf requires non-empty PDF buffer', { code: 'INVALID_DOCUMENT' }));
    }
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return Promise.reject(new InfrastructureError('document is not a PDF', { code: 'INVALID_DOCUMENT' }));
    }
    const nCopies = Math.max(1, Math.floor(copies));
    const rawPayload = nCopies === 1 ? pdf : Buffer.concat(Array.from({ length: nCopies }, () => pdf));
    const payload = pjlWrap(rawPayload, { jobName, duplex, binding });
```
(everything below this in the function — the `new Promise(...)` socket logic — is unchanged EXCEPT the two spots that log/resolve with job metadata: add `duplex` to both the `this.#logger.info?.('laser-printer.job-sent', {...})` call and the `resolve({ ok: true, bytes: payload.length, copies: nCopies })` call, i.e. `resolve({ ok: true, bytes: payload.length, copies: nCopies, duplex })`.)

Update the `printPdf` JSDoc (lines 76-90) to add `@param {boolean} [opts.duplex]` and `@param {'LONGEDGE'|'SHORTEDGE'} [opts.binding]`, and note in the returns shape that `duplex` is echoed back.

In `VirtualLaserPrinterAdapter.mjs`, mirror the surface (no PJL wrapping needed here — it never talks to a real printer, it just needs to RECORD what it was asked for so tests can assert on it):
- `printPdf` signature (line 82): add `duplex = true, binding = 'LONGEDGE',` to the destructured options.
- Sidecar object (lines 103-111): add `duplex,` and `binding,` fields.
- Update the JSDoc block above it (lines 73-81) to match.

In `backend/src/app.mjs`, update the `LaserPrinterAdapter` construction (~lines 3313-3318):
```javascript
    const laserPrinter = new LaserPrinterAdapter({
      host: printerHost,
      port: schoolFullConfig.printing?.port || 631,
      path: schoolFullConfig.printing?.path || '/ipp/print',
      duplex: schoolFullConfig.printing?.duplex ?? true,
      binding: schoolFullConfig.printing?.binding || 'LONGEDGE',
      logger: rootLogger.child({ module: 'school-print' })
    });
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs tests/isolated/adapter/school/virtualLaserPrinter.test.mjs`
Expected: PASS

Then run every consumer test that stubs `printPdf` as a bare `vi.fn()` (found via research: `backend/src/3_applications/school/PrintService.preview.test.mjs`, `backend/src/3_applications/school/surfaces/acceptance.v1.test.mjs`, `backend/src/3_applications/school/usecases/ReplaceLostAnswerSheet.test.mjs`) to confirm nothing there asserts on the OLD (unwrapped) payload shape in a way that would now be wrong — these stub `printPdf` entirely, so they almost certainly don't care about PJL wrapping at all, but confirm:
Run: `npx vitest run backend/src/3_applications/school/PrintService.preview.test.mjs backend/src/3_applications/school/surfaces/acceptance.v1.test.mjs backend/src/3_applications/school/usecases/ReplaceLostAnswerSheet.test.mjs`
Expected: PASS, unchanged.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs backend/src/1_adapters/hardware/laser-printer/VirtualLaserPrinterAdapter.mjs backend/src/app.mjs tests/isolated/adapter/hardware/laserPrinterAdapter.test.mjs tests/isolated/adapter/school/virtualLaserPrinter.test.mjs
git commit -m "feat(printing): default to duplex (double-sided) printing via PJL, config-driven"
```

### Task 12: Docs + physical verification note

**Files:**
- Modify: `docs/reference/school/print-documents.md` (or wherever printer/adapter behavior is documented — grep for "LaserPrinterAdapter" or "JetDirect" across `docs/` first)

**Step 1:** Add a short section documenting: default behavior is double-sided (long-edge binding), config-driven via `schoolFullConfig.printing.duplex`/`.binding` (both optional, default `true`/`'LONGEDGE'`), implemented as a PJL wrap around the raw JetDirect payload (not CUPS/IPP job attributes, since this printer's IPP path rejects PDF). **Explicitly flag that PJL duplex has not been verified against the physical Brother HL-L2460DW** — the next person to hold the printed output should confirm one physical duplex print actually comes out double-sided, and update this doc to say "confirmed working as of <date>" or "confirmed NOT supported, fell back to X" once they do.

**Step 2: Commit**

```bash
git add docs/reference/school/print-documents.md
git commit -m "docs(printing): document duplex-by-default + flag PJL as unverified against physical hardware"
```

---

## Final Task: Visual QA — render the real card 5922785 instance and look at it

This is the document that started all three fixes (`civilization/young-peoples-atlas-us/ws-ses-f6buxumv`, card 5922785, rows 7-16, 10 questions forced onto 2 pages). Confirm all three fixes together, by eye, not just by test assertions — per this project's own standing guidance to verify UI/visual output with a rendering + screenshot pass rather than trusting the math alone.

**Steps:**
1. Set `export DAYLIGHT_BASE_PATH=/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation` (or the current machine's real data path — check `.claude/settings.local.json`/`.env`).
2. Render via the NEW command (Track A): `node cli/school-docs.cli.mjs reprint civilization/young-peoples-atlas-us/ws-ses-f6buxumv --out /tmp/qa-facsimile.pdf` — no manual flags.
3. Confirm the JSON report shows `allocation.status: "live"` and no unexpected warnings.
4. `pdftoppm -png -r 150 /tmp/qa-facsimile.pdf /tmp/qa-page` then read both PNGs (Read tool supports images).
5. Check against all three fixes:
   - **Track A:** Name "Felix", Date "14 Aug 2026", Student No. 5922785 all present without having been passed manually.
   - **Track B:** Page 2's footer reads "Page 2 of 2 · 5922785" (or similar) — no title/blank "Name: ___" line anywhere on page 2.
   - **Track C:** Questions split roughly evenly (aim for 5 on page 1, 5 on page 2, given 10 total) rather than 7/3; no single gap between questions looks dramatically larger than the others; any genuine leftover space sits as blank space at the bottom of page 2, not stretched into the middle.
6. If the balance or gap cap looks off in practice (e.g., `maxFillGrowthPt: 32` still looks too loose or too tight), adjust the constant in `workbookTheme.mjs`'s new `pagination` section — it's a single number, tune and re-render rather than re-deriving the algorithm.
7. Confirm the two allocation-store byte-identical-reprint tests from Task 3 still hold by re-running `reprint` a second time and diffing the PDFs (`cmp /tmp/qa-facsimile.pdf /tmp/qa-facsimile-2.pdf`).

No commit for this task — it's verification, not code. If step 6 requires a constant tweak, that's a one-line follow-up commit against Task 9's `workbookTheme.mjs` change.
