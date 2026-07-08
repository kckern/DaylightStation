# DDD Compliance Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Execute all 18 items (P0–P3) of the remediation roadmap from `docs/_wip/audits/2026-07-06-ddd-layer-compliance-mega-audit.md`, bringing `backend/src/` into compliance with `docs/reference/core/layers-of-abstraction/`.

**Architecture:** Four phases. P0 records policy decisions, builds the enforcement tooling, and deletes dead code. P1 kills the systemic patterns new code keeps copying (error architecture, SSOT constants, raw fetch, config singletons) and ratchets them with an audit script. P2 relocates misplaced subsystems vertical-by-vertical (health, fitness, admin, piano, composition root, rendering). P3 executes the plan-first migrations (serialization ownership, neutral content IDs — phase 1 only; full migration is its own follow-on plan).

**Tech Stack:** Node ESM (`.mjs`), Express, vitest (`tests/unit/**/*.test.mjs`, run via `node tests/unit/harness.mjs` or `npx vitest run <file>`), YAML persistence, `#`-prefix subpath import aliases (defined in BOTH root `package.json` and `backend/package.json`).

---

## Ground Rules for the Executing Agent

1. **Work in a worktree, one branch per phase.** `git worktree add ../DaylightStation-ddd-p0 -b refactor/ddd-compliance-p0` (then `-p1`, `-p2`, `-p3` branched off the previous when merged). Never commit directly to `main`. Commit after every task with the message given in the task. Merge a phase branch into `main` only after the phase's final gate passes and the user approves.
2. **The audit is your map, not your territory.** Line numbers and counts are from 2026-07-06 and may drift. Before every edit: re-grep, re-read the file, confirm the finding still exists. If a file/line no longer matches, adapt; if a whole finding is gone, note it in the commit body and skip.
3. **Verification gates (used throughout, referenced by name):**
   - **GATE-IMPORT** — the whole backend module graph still links:
     ```bash
     node --input-type=module -e "await import('./backend/src/0_system/bootstrap.mjs'); await import('./backend/src/app.mjs'); console.log('IMPORT-OK')"
     ```
     Expected output: `IMPORT-OK` (importing is side-effect-safe; instantiation happens inside factory functions).
   - **GATE-UNIT** — `npm run test:unit` produces **no new failures vs the baseline** captured in Task P0.1 (`tests/output/results.unit.yml` compared to the saved baseline copy). Pre-existing failures are known (see `docs/_wip/audits/2026-04-25-pre-existing-test-failures-audit.md`); do not chase them, do not add to them.
   - **GATE-AUDIT** — `node scripts/audit-layer-imports.mjs` (built in Task P0.2) exits 0, i.e. no violation count increased over `scripts/audit-baseline.json`.
   - **GATE-GREP** — task-specific grep whose expected output is stated inline in each task.
4. **Never delete without re-verifying zero importers first:** `grep -rn "<basename or symbol>" backend/ cli/ frontend/ shared/ tests/ --include='*.mjs' --include='*.js' --include='*.jsx'` must return only the file itself (and this plan/audit docs). If it returns live importers, STOP, migrate the importers first (or flag to the user if unexpected).
5. **Behavior preservation is the default.** These are refactors: same inputs → same outputs, same routes → same responses. The only intentional behavior changes are the ones explicitly labeled **[BEHAVIOR CHANGE]** in a task (there are three: zone-threshold reconciliation P1.5, ConfigService timezone reconciliation P1.6, error-response bodies in migrated routers P1.3).
6. **Deprecation comment convention:** when a task says "leave a re-export shim", the shim file contains only re-exports plus a header: `// MOVED: canonical home is <new path>. This shim exists for import compatibility; do not add code here.`
7. **If a task references a Decision (D1–D7),** the ruling is recorded in Task P0.3 and is not up for re-litigation during execution.
8. **Docs rule:** never put hostnames/ports/real usernames in docs you edit (use `{env.*}` placeholders). Never use `console.log` in new backend code — accept an injected `logger` (default `console` is fine as a constructor default).

---

# PHASE P0 — Decisions, Tooling, Dead Code, Mechanical Cleanup

## Task P0.1: Worktree + test baseline

**Files:**
- Create: `scratch/` nothing — baseline goes to `tests/output/baseline.unit.yml` (gitignored dir) AND `scripts/audit-baseline.unit.txt` (committed summary)

**Step 1:** Create the worktree and branch:
```bash
git worktree add ../DaylightStation-ddd-p0 -b refactor/ddd-compliance-p0
cd ../DaylightStation-ddd-p0 && npm install
```
**Step 2:** Run the unit suite and capture the baseline:
```bash
npm run test:unit; cp tests/output/results.unit.yml tests/output/baseline.unit.yml
```
**Step 3:** Extract a committed summary (pass/fail counts per folder) so the baseline survives across machines:
```bash
node -e "
const yaml=require('yaml');const fs=require('fs');
const r=yaml.parse(fs.readFileSync('tests/output/results.unit.yml','utf8'));
fs.writeFileSync('scripts/audit-baseline.unit.txt', JSON.stringify(r.summary ?? r, null, 2));
console.log(fs.readFileSync('scripts/audit-baseline.unit.txt','utf8'));
"
```
(If the results file shape differs, adapt: the committed artifact just needs total/passed/failed counts per top-level folder.)

**Step 4:** Run GATE-IMPORT. Expected: `IMPORT-OK`.

**Exit criteria:**
- [ ] Worktree exists on branch `refactor/ddd-compliance-p0`
- [ ] `scripts/audit-baseline.unit.txt` committed with pass/fail counts
- [ ] GATE-IMPORT passes

**Commit:** `chore(ddd): capture unit-test + import baseline for remediation`

---

## Task P0.2: Build the layer-import audit script (the ratchet)

This is the enforcement tool every later task verifies against. Build it FIRST.

**Files:**
- Create: `scripts/audit-layer-imports.mjs`
- Create: `scripts/audit-baseline.json` (generated)
- Modify: `package.json` (add script `"audit:layers": "node scripts/audit-layer-imports.mjs"`)
- Test: `tests/unit/tooling/auditLayerImports.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/tooling/auditLayerImports.test.mjs
import { describe, it, expect } from 'vitest';
import { scanViolations, RULES } from '../../../scripts/audit-layer-imports.mjs';

describe('audit-layer-imports', () => {
  it('flags a domain file importing an adapter', () => {
    const v = scanViolations('backend/src/2_domains/x/Foo.mjs',
      "import { Bar } from '#adapters/thing/Bar.mjs';");
    expect(v.some(r => r.rule === 'domains-no-adapters')).toBe(true);
  });
  it('allows the composition root to import adapters', () => {
    const v = scanViolations('backend/src/0_system/bootstrap.mjs',
      "import { Bar } from '#adapters/thing/Bar.mjs';");
    expect(v.length).toBe(0);
  });
  it('flags raw fs import in 3_applications', () => {
    const v = scanViolations('backend/src/3_applications/x/Svc.mjs',
      "import fs from 'node:fs';");
    expect(v.some(r => r.rule === 'apps-no-fs')).toBe(true);
  });
  it('exposes a rule table', () => {
    expect(RULES.length).toBeGreaterThan(5);
  });
});
```

**Step 2:** Run: `npx vitest run tests/unit/tooling/auditLayerImports.test.mjs` — Expected: FAIL (module not found).

**Step 3: Implement the script**

```javascript
#!/usr/bin/env node
// scripts/audit-layer-imports.mjs
// Layer-import ratchet. Scans backend/src for forbidden import patterns per
// docs/reference/core/layers-of-abstraction/. Compares counts to
// scripts/audit-baseline.json; exits 1 if any rule's count INCREASED.
// Usage:
//   node scripts/audit-layer-imports.mjs             # check against baseline
//   node scripts/audit-layer-imports.mjs --update    # rewrite baseline (only after a task legitimately lowers counts)
//   node scripts/audit-layer-imports.mjs --list=<rule>  # print offending file:line for one rule
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const IMPORT_RE = /^\s*(?:import\b[^'"]*|export\b[^'"]*from\s*)['"]([^'"]+)['"]/;

// exempt: composition root (bootstrap) — the one sanctioned cross-layer zone
const isCompositionRoot = (f) =>
  f.includes('0_system/bootstrap') || f.endsWith('0_system/bootstrap.mjs') ||
  f.includes('5_composition/'); // future home (Task P2.7)
const isTest = (f) => f.includes('__tests__') || f.endsWith('.test.mjs');

export const RULES = [
  // rule id, applies-to path fragment, forbidden import matcher, exemption fn
  { rule: 'system-no-upward', layer: '0_system/', bad: s => /^#(domains|adapters|apps|applications|api|rendering)\//.test(s), exempt: isCompositionRoot },
  { rule: 'domains-no-adapters', layer: '2_domains/', bad: s => /^#(adapters|apps|applications|api|system|rendering)\//.test(s) },
  { rule: 'domains-no-node-io', layer: '2_domains/', bad: s => /^(node:)?(fs|fs\/promises|path|child_process)$/.test(s) },
  { rule: 'apps-no-adapters', layer: '3_applications/', bad: s => /^#adapters\//.test(s) || /1_adapters\//.test(s) },
  { rule: 'apps-no-config-internals', layer: '3_applications/', bad: s => /^#system\/config\//.test(s) },
  { rule: 'apps-no-fs', layer: '3_applications/', bad: s => /^(node:)?(fs|fs\/promises|child_process)$/.test(s) },
  { rule: 'apps-no-fileio', layer: '3_applications/', bad: s => /#system\/utils\/FileIO\.mjs$/.test(s) }, // Decision D5
  { rule: 'adapters-no-config-singleton', layer: '1_adapters/', bad: s => /^#system\/config\//.test(s) },
  { rule: 'adapters-no-rendering', layer: '1_adapters/', bad: s => /^#rendering\//.test(s) },
  { rule: 'adapters-no-cross-adapter', layer: '1_adapters/', bad: s => /^#adapters\//.test(s) }, // same-folder relatives allowed
  { rule: 'rendering-no-adapters-apps', layer: '1_rendering/', bad: s => /^#(adapters|apps|applications)\//.test(s) },
  { rule: 'api-no-adapters', layer: '4_api/', bad: s => /^#adapters\//.test(s) || /1_adapters\//.test(s) },
  { rule: 'api-no-apps', layer: '4_api/', bad: s => /^#(apps|applications)\//.test(s) || /3_applications\//.test(s) },
  { rule: 'api-no-domains', layer: '4_api/', bad: s => /^#domains\//.test(s) || /2_domains\//.test(s) },
  { rule: 'api-no-config', layer: '4_api/', bad: s => /^#system\/config\//.test(s) },
  { rule: 'no-applications-alias', layer: 'backend/src/', bad: s => /^#applications\//.test(s) },
  { rule: 'no-deep-relative-layer-cross', layer: 'backend/src/', bad: s => /^(\.\.\/){3,}.*(0_system|1_adapters|1_rendering|2_domains|3_applications|4_api)\//.test(s) },
];

export function scanViolations(filePath, content) {
  const out = [];
  const lines = content.split('\n');
  for (const r of RULES) {
    if (!filePath.includes(r.layer)) continue;
    if (r.exempt?.(filePath)) continue;
    lines.forEach((line, i) => {
      const m = line.match(IMPORT_RE);
      if (m && r.bad(m[1])) out.push({ rule: r.rule, file: filePath, line: i + 1, spec: m[1] });
    });
  }
  return out;
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.mjs') && !isTest(p)) acc.push(p);
  }
  return acc;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const all = walk('backend/src').flatMap(f => scanViolations(f, readFileSync(f, 'utf8')));
  const counts = {};
  for (const r of RULES) counts[r.rule] = all.filter(v => v.rule === r.rule).length;

  const listArg = args.find(a => a.startsWith('--list='));
  if (listArg) {
    const rule = listArg.split('=')[1];
    for (const v of all.filter(v => v.rule === rule)) console.log(`${v.file}:${v.line}  ${v.spec}`);
    process.exit(0);
  }
  const baselinePath = 'scripts/audit-baseline.json';
  if (args.includes('--update') || !existsSync(baselinePath)) {
    writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + '\n');
    console.log('Baseline written:', counts);
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  let regressed = false;
  for (const [rule, n] of Object.entries(counts)) {
    const base = baseline[rule] ?? 0;
    const mark = n > base ? 'REGRESSION' : n < base ? 'improved' : 'ok';
    if (n > base) regressed = true;
    console.log(`${rule.padEnd(36)} ${String(n).padStart(4)} (baseline ${base}) ${mark}`);
  }
  process.exit(regressed ? 1 : 0);
}
```

**Step 4:** Run the test again. Expected: PASS. Then generate the baseline and add the npm script:
```bash
node scripts/audit-layer-imports.mjs --update   # writes scripts/audit-baseline.json
node scripts/audit-layer-imports.mjs            # expected: all rules "ok", exit 0
```
Add to root `package.json` scripts: `"audit:layers": "node scripts/audit-layer-imports.mjs"`.

**Step 5:** Sanity-check the counts roughly match the audit (order of magnitude): `apps-no-adapters` ≈ 11, `adapters-no-config-singleton` ≈ 21, `api-no-domains` ≈ 10+. If a count is wildly off (e.g. 0 where the audit found 21), the regex is wrong — fix before proceeding.

**Exit criteria:**
- [ ] `npx vitest run tests/unit/tooling/auditLayerImports.test.mjs` → PASS
- [ ] `npm run audit:layers` exits 0 against a committed `scripts/audit-baseline.json`
- [ ] Counts sanity-checked against the audit doc

**Commit:** `feat(tooling): layer-import audit ratchet with committed baseline`

> **From this point on, EVERY task ends with GATE-AUDIT.** When a task reduces a count, run `node scripts/audit-layer-imports.mjs --update` as its final step and commit the lowered baseline with it — that's the ratchet.

---

## Task P0.3: Record the Decision Register rulings in the guideline docs

Rulings (already recommended in the audit; these are now FINAL for this plan):
- **D1:** Containers do NOT import adapters. Bootstrap injects. (3 containers to fix in P1/P2.)
- **D2:** `3_applications` MAY import `1_rendering` (injection preferred). The application-layer doc is amended; backend-architecture.md already agrees.
- **D3:** Ports live in `3_applications/*/ports/` only. Domain ports migrate. (`ILifelogExtractor` explicitly deferred to the P3 serialization plan — record that.)
- **D4:** `2_domains/core/utils/time.mjs` is the SSOT for pure time helpers; `0_system/utils/time.mjs` becomes a thin compat re-export. Hardcoded LA default stays for now (see P1.6 for the constant).
- **D5:** `#system/utils/FileIO.mjs` is banned in `3_applications` (data ops go through datastore ports). Enforced by the `apps-no-fileio` audit rule.
- **D6:** Domain hierarchy table extended; `content` is promoted to **Level 1 (shared)**. The two peer imports (fitness→content, barcode→content) become legal.
- **D7:** Where a port file exists, flagship adapters MUST `extends` it. Zero-importer port files are deleted, not kept as aspiration.

**Files:**
- Modify: `docs/reference/core/layers-of-abstraction/application-layer-guidelines.md` — ALLOWED imports list: add `1_rendering/ — renderers (inject as port where practical)`; add a "Container Rules" clarification line: "Containers never import concrete adapters — no exceptions (Decision D1, 2026-07-06)."
- Modify: `docs/reference/core/layers-of-abstraction/domain-layer-guidelines.md` — in "No Ports in Domain Layer" add: "(Decision D3, 2026-07-06 — confirmed; `2_domains/media/ports/` and `livestream/IAudioAssetResolver` migrated; `ILifelogExtractor` deferred to serialization migration plan)". In Cross-Domain Dependencies, move `content` into Level 1 list (D6) and append the previously unlisted domains to the level table: L1: `content`, `common`, `notification`; L2: `ambient, art, barcode, concierge, cost, feed, livestream, lifeplan, playback-hub, trigger`; L3: `weekly-review` (aggregates fitness/media). Add a sentence: "Every new domain must be added to this table in the same PR that creates it."
- Modify: `docs/reference/core/layers-of-abstraction/ddd-reference.md` — same Level-table update.
- Modify: `docs/reference/core/adapter-layer-guidelines.md` — under "Missing port interface" add "(Decision D7, 2026-07-06: enforced for gateway/datastore adapters where the port exists; internal helpers/parsers exempt)".
- Create: `docs/reference/core/layers-of-abstraction/decision-register.md` — table of D1–D7 with date, ruling, one-line rationale, link to the audit.

**Steps:** Make the edits above; each doc edit is small and additive.

**Exit criteria:**
- [ ] `decision-register.md` exists listing D1–D7 with rulings
- [ ] `grep -l "Decision D" docs/reference/core -r` → ≥4 files
- [ ] Level table includes all 29 domain folders (`ls backend/src/2_domains` count matches table entries + `core`)

**Commit:** `docs(ddd): record decision register D1-D7 rulings in guideline docs`

---

## Task P0.4: Delete the dead routing-toggle subsystem

**Files:**
- Delete: `backend/src/0_system/routing/` (entire folder: `ConfigLoader.mjs`, `RouteMatcher.mjs`, `RoutingMiddleware.mjs`, `index.mjs`)
- Modify: `backend/src/app.mjs` (remove the `loadRoutingConfig` block, audit ref lines 292–299 — re-grep)

**Step 1:** Verify deadness (Ground Rule 4):
```bash
grep -rn "0_system/routing\|RouteMatcher\|RoutingMiddleware\|loadRoutingConfig" backend/ cli/ --include='*.mjs' --include='*.js' | grep -v '0_system/routing/'
```
Expected: only the `app.mjs` load-site. If anything else imports it, STOP and reassess.
**Step 2:** In `app.mjs`, find the block (`grep -n "loadRoutingConfig\|routing.toggle" backend/src/app.mjs`), delete the import and the try/catch block. Verify `routingConfig` has no other references in the file.
**Step 3:** `rm -rf backend/src/0_system/routing/` (if rm is permission-blocked, `mv` to `_deleteme/` per project rules).
**Step 4:** GATE-IMPORT, GATE-UNIT, GATE-AUDIT.

**Exit criteria:**
- [ ] `grep -rn "loadRoutingConfig" backend/` → 0 hits
- [ ] `backend/src/0_system/routing/` does not exist
- [ ] All three gates pass

**Commit:** `chore(ddd): delete dead strangler-fig routing-toggle subsystem (audit X-3)`

## Task P0.5: Delete `server.mjs`; fix docs entry-point table

**Files:**
- Delete: `backend/src/server.mjs`
- Modify: `docs/reference/core/backend-architecture.md` (Entry Points table: `src/server.mjs` → `backend/index.js`)
- Modify: `backend/src/4_api/v1/handlers/nutribot/index.mjs` (comment references server.mjs — update comment only)

**Step 1:** Verify nothing executes it: `grep -rn "server.mjs" backend/ package.json backend/package.json scripts/ Dockerfile* docker* 2>/dev/null | grep -v node_modules`. Expected: comments only (index.js:76, nutribot handler:6) + docs. If a Dockerfile or script runs it, STOP and flag to user.
**Step 2:** Delete the file; fix the two comments and the docs table.
**Step 3:** GATE-IMPORT, GATE-UNIT.

**Exit criteria:**
- [ ] `test -f backend/src/server.mjs` → fails
- [ ] `grep -rn "server.mjs" docs/reference/core/backend-architecture.md` → 0 hits
- [ ] Gates pass

**Commit:** `chore(ddd): remove duplicate entry point server.mjs (audit X-12)`

## Task P0.6: Extract the vendor-error template, then delete the dead Telegram adapter

**Files:**
- Create: `backend/src/0_system/utils/errors/vendorError.mjs`
- Test: `tests/unit/system/vendorError.test.mjs`
- Delete: `backend/src/1_adapters/telegram/TelegramMessagingAdapter.mjs`
- Modify: `backend/src/1_adapters/telegram/index.mjs` (remove its export line; keep the live exports — parser, response context, IInputEvent for now; fix the stale `2_adapters/` header comment)

**Step 1: Failing test**
```javascript
// tests/unit/system/vendorError.test.mjs
import { describe, it, expect } from 'vitest';
import { translateVendorError, isTransientStatus } from '#system/utils/errors/vendorError.mjs';

describe('translateVendorError', () => {
  it('maps status to generic code and sets isTransient', () => {
    const e = translateVendorError({ status: 429, message: 'Telegram: too many requests' }, { op: 'sendMessage' });
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.isTransient).toBe(true);
    expect(e.message).not.toMatch(/Telegram/); // vendor name must not leak
  });
  it('flags network errors transient', () => {
    expect(isTransientStatus({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientStatus({ status: 404 })).toBe(false);
  });
});
```
**Step 2:** Run it — FAIL. **Step 3: Implement** (port the logic from `TelegramMessagingAdapter.mjs:40-73` `#callApi` + its `#mapErrorCode`/`#isTransient` — read that file first; the mapping table is in the audit A-4/adapter guidelines):
```javascript
// backend/src/0_system/utils/errors/vendorError.mjs
const CODE_MAP = { 400: 'INVALID_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'RATE_LIMITED', 500: 'SERVICE_ERROR', 502: 'SERVICE_UNAVAILABLE', 503: 'SERVICE_UNAVAILABLE', 504: 'SERVICE_UNAVAILABLE' };
export function isTransientStatus(err) {
  if (err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED') return true;
  const s = err?.status ?? err?.response?.status;
  return s === 429 || (s >= 500 && s <= 599);
}
/**
 * Wrap a vendor/HTTP error into a generic error safe to throw upward.
 * Vendor specifics belong in the adapter's log line, not in this error.
 * @param {Object} err - caught vendor error ({status?, code?, message?})
 * @param {Object} ctx - { op } operation name for the message
 */
export function translateVendorError(err, { op = 'request' } = {}) {
  const status = err?.status ?? err?.response?.status;
  const wrapped = new Error(`Operation failed: ${op}`);
  wrapped.code = CODE_MAP[status] || (err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR');
  wrapped.isTransient = isTransientStatus(err);
  wrapped.status = status;
  return wrapped;
}
```
**Step 4:** Test PASSES. Export from `0_system/utils/errors/index.mjs` if a barrel exists.
**Step 5:** Verify the dead adapter has zero importers (Ground Rule 4 grep on `TelegramMessagingAdapter`). Expected: only `1_adapters/telegram/index.mjs`. Delete the file, remove the barrel line, fix the barrel's stale header.
**Step 6:** GATE-IMPORT, GATE-UNIT, GATE-AUDIT.

**Exit criteria:**
- [ ] vendorError test passes; `translateVendorError` importable via `#system/utils/errors/vendorError.mjs`
- [ ] `find backend -name TelegramMessagingAdapter.mjs` → nothing
- [ ] Gates pass

**Commit:** `refactor(ddd): extract vendor-error translation util; delete dead TelegramMessagingAdapter (audit X-8, A-4)`

## Task P0.7: Delete zero-importer duplicate ports

**Files (verify each with Ground Rule 4 grep before deleting — search for BOTH the filename and the class name):**
- Delete: `backend/src/3_applications/nutribot/ports/IMessagingGateway.mjs`
- Delete: `backend/src/3_applications/common/ports/IConversationStateDatastore.mjs` (keep the homebot copy — it has the 1 importer)
- Delete: `backend/src/3_applications/common/ports/INotificationChannel.mjs` AND/OR `backend/src/3_applications/notification/ports/INotificationChannel.mjs` — **keep whichever one has importers**; audit found both at zero, so if still zero, keep the `notification/` copy (it's in the owning app) and delete the `common/` copy, then have the notification adapters `extends` it in P1 (D7).

**Steps:** grep, delete, update any barrel `index.mjs` in those ports folders, gates.

**Exit criteria:**
- [ ] Exactly one `IConversationStateDatastore.mjs`, one `INotificationChannel.mjs`, one `IMessagingGateway.mjs` (the `common/` one) under `backend/src/3_applications/`:
  `find backend/src/3_applications -name 'IMessagingGateway.mjs' -o -name 'IConversationStateDatastore.mjs' -o -name 'INotificationChannel.mjs' | wc -l` → `3`
- [ ] Gates pass

**Commit:** `chore(ddd): delete zero-importer duplicate port files (audit X-8, X-9)`

## Task P0.8: Fix stale facts in backend-architecture.md

**Files:**
- Modify: `docs/reference/core/backend-architecture.md`

**Fix list (verify each against the tree as you go):**
1. `routing/` row in the 0_system table → delete the row (subsystem deleted in P0.4).
2. Remove `shims/` from the 4_api table and the `/admin/legacy`, `/admin/shims` bullet (don't exist).
3. Remove/replace the "Strangler Fig Migration" section with two sentences: migration completed; `_legacy/` deleted; see the decision register.
4. Entry point table (done in P0.5 — verify).
5. Dependency-rules block: change `0_system → standalone (no upward imports)` to `0_system → standalone (no upward imports; the composition root is the sole exception and is being relocated — see remediation plan P2.7)`.
6. File counts in headers (26/76/111/60/39) are stale → replace with "(~counts as of 2026-07: 104/310/36/295/487/142)" or drop counts entirely (preferred: drop).
7. Rendering section: add the four undocumented renderer families (eink framework, newsreporter, qrcode, timelapse) as a bullet list.

**Exit criteria:**
- [ ] `grep -n "ShimMetrics\|RoutingConfig.mjs\|admin/shims\|admin/legacy\|server.mjs" docs/reference/core/backend-architecture.md` → 0 hits
- [ ] `git rev-parse HEAD > docs/docs-last-updated.txt` refreshed (per CLAUDE.md freshness protocol) and committed

**Commit:** `docs(ddd): fix stale architecture facts (routing, shims, entry point, counts)`

## Task P0.9: Alias unification — kill `#applications`, add `#shared/*`

**Files:**
- Modify: `backend/package.json` (remove the `#applications/*` imports entry)
- Modify: root `package.json` + `backend/package.json` (add `"#shared/*": "./shared/*"` — root; `"#shared/*": "../shared/*"` — backend; **verify `shared/` exists at repo root first**: `ls shared/` — if it doesn't, skip the alias addition and note it)
- Modify: every file using `#applications/` (audit found 7 usages in `0_system/bootstrap.mjs`, `4_api/v1/routers/eink.mjs`, `4_api/v1/routers/piano.mjs` — re-grep)

**Step 1:** `grep -rln "from '#applications/" backend/src` → file list. For each, replace `#applications/` → `#apps/` (plain string replace; the paths are identical).
**Step 2:** Remove the alias from `backend/package.json`.
**Step 3:** Add `#shared/*` aliases (both manifests) if `shared/` exists. Convert `backend/src/3_applications/piano/loopManifest.mjs:8-9` relative traversals to `#shared/music/...`.
**Step 4:** GATE-IMPORT (this is the gate that catches alias mistakes), GATE-UNIT, GATE-AUDIT (`no-applications-alias` should drop to 0 → `--update` baseline).

**Exit criteria:**
- [ ] `grep -rn "#applications/" backend/src` → 0 hits
- [ ] `grep -n '"#applications' backend/package.json` → 0 hits
- [ ] Gates pass; baseline updated

**Commit:** `refactor(ddd): unify on #apps alias; add #shared alias (audit X-13)`

## Task P0.10: Codemod deep-relative cross-layer imports (44 lines / 17 files)

**Files:** discovered by grep, e.g. `1_adapters/persistence/yaml/YamlHubConfigDatastore.mjs` (13 lines), `4_api/v1/routers/admin/art.mjs`, `3_applications/playback-hub/usecases/SendHubCommand.mjs`, …

**Step 1:** Get the live list:
```bash
grep -rnE "from '(\.\./){3,}" backend/src --include='*.mjs' | grep -E "0_system|1_adapters|1_rendering|2_domains|3_applications|4_api"
```
**Step 2:** For each line, mechanically map the resolved path to its alias: `.../0_system/X` → `#system/X`, `1_adapters/X` → `#adapters/X`, `1_rendering/X` → `#rendering/X`, `2_domains/X` → `#domains/X`, `3_applications/X` → `#apps/X`, `4_api/X` → `#api/X`. **Do not change same-layer relative imports** (e.g. `../lib/foo.mjs` within a folder is fine); only rewrite ones that traverse into a different numbered layer.
**Step 3:** GATE-IMPORT, GATE-UNIT, GATE-AUDIT (`no-deep-relative-layer-cross` → 0, update baseline).

**Exit criteria:**
- [ ] The Step-1 grep → 0 hits
- [ ] Gates pass; baseline updated

**Commit:** `refactor(ddd): replace deep-relative cross-layer imports with # aliases (audit X-13)`

## Task P0.11: Codemod domain-internal relative `core` imports (~60 files)

**Step 1:** List: `grep -rln "from '\.\./\.\./core/errors" backend/src/2_domains --include='*.mjs'` (also `'../../core/utils`, and playback-hub's direct `errors/ValidationError.mjs` reaches).
**Step 2:** Rewrite to `#domains/core/errors/index.mjs` (and `#domains/core/utils/...`). For playback-hub's per-file error imports, switch to the barrel.
**Step 3:** GATE-IMPORT, GATE-UNIT.

**Exit criteria:**
- [ ] `grep -rn "\.\./\.\./core/errors" backend/src/2_domains` → 0
- [ ] Gates pass

**Commit:** `refactor(domains): use #domains/core alias for shared-kernel imports (audit D-13)`

## Task P0.12: Delete rendering dead code (audit R-10 list)

**Files:**
- Modify: `backend/src/1_rendering/fitness/FitnessReceiptRenderer.mjs` — delete `downsampleValues()` (≈lines 45-55); replace the local `zoneOrder` literal (≈:536) with the already-imported `ZONE_ORDER` **only if their values are identical — compare first; if they differ, leave the literal and add `// TODO(zone-ssot): reconcile in P1.5`**.
- Modify: `backend/src/1_rendering/fitness/TimelapseFrameRenderer.mjs` — delete unused `roundRect` (:395-404) and `containRect` (:514-519) **after** grep-verifying they're unused within the file.
- Modify: `backend/src/1_rendering/qrcode/QRCodeRenderer.mjs` — remove the never-read `config.mediaPath` param + its JSDoc.
- Modify: `backend/src/1_rendering/gratitude/GratitudeCardRenderer.mjs` — remove unused `canvasService` param (:22,26); add null-guard: `if (!selections) return null;` before first property access (audit R-9 crash fix — this is a bug fix, note in commit).

**Steps:** verify each symbol unused (grep within file + repo), delete, gates.

**Exit criteria:**
- [ ] `grep -n "downsampleValues\|containRect" backend/src/1_rendering -r` → 0 hits
- [ ] Gratitude renderer returns null (not TypeError) on null selections — add a unit test if `tests/unit/` has a rendering folder; otherwise verify by reading the guard
- [ ] Gates pass

**Commit:** `chore(rendering): delete dead code; null-guard gratitude selections (audit R-9, R-10)`

### PHASE P0 FINAL GATE
- [ ] All P0 exit criteria checked
- [ ] `npm run test:unit` — no new failures vs baseline
- [ ] `npm run audit:layers` — exit 0, several counts lower than the original baseline
- [ ] Present the phase diff summary to the user; merge `refactor/ddd-compliance-p0` → `main` on approval

---

# PHASE P1 — Stop the Bleeding (branch `refactor/ddd-compliance-p1`)

## Task P1.1: Create the four system error classes

**Files:**
- Create: `backend/src/0_system/utils/errors/ConfigurationError.mjs`, `SchedulerError.mjs`, `EventBusError.mjs`, `FileIOError.mjs`
- Modify: `backend/src/0_system/utils/errors/index.mjs` (add exports; read it first — an errors barrel already exists with `DomainError` etc.)
- Test: `tests/unit/system/systemErrors.test.mjs`

**Step 1: Failing test**
```javascript
import { describe, it, expect } from 'vitest';
import { ConfigurationError, SchedulerError, EventBusError, FileIOError } from '#system/utils/errors/index.mjs';

describe('system error classes', () => {
  it('ConfigurationError carries code/key/value', () => {
    const e = new ConfigurationError('API key required', { code: 'MISSING_SECRET', key: 'OPENAI_API_KEY' });
    expect(e.name).toBe('ConfigurationError');
    expect(e.code).toBe('MISSING_SECRET');
    expect(e.key).toBe('OPENAI_API_KEY');
    expect(e).toBeInstanceOf(Error);
  });
  it.each([[SchedulerError], [EventBusError], [FileIOError]])('%p carries code and details', (Cls) => {
    const e = new Cls('boom', { code: 'X', details: { a: 1 } });
    expect(e.code).toBe('X');
    expect(e.details).toEqual({ a: 1 });
  });
});
```
**Step 2:** FAIL. **Step 3:** Implement per the spec in `system-layer-guidelines.md:188-200` (ConfigurationError has `{code, key, value, details}`; the other three `{code, details}`). **Do not** import `nowTs24` or anything from `utils/time.mjs` (audit S-4 coupling — use nothing time-dependent). **Step 4:** PASS. **Step 5:** Gates.

**Exit criteria:**
- [ ] Test passes; all four classes exported from the errors barrel
- [ ] `grep -n "from.*time" backend/src/0_system/utils/errors/*.mjs` → 0 new hits

**Commit:** `feat(system): implement prescribed system error classes (audit S-5)`

## Task P1.2: Migrate system-layer config/scheduler throw sites to typed errors

**Files (re-grep each; audit refs):**
- `backend/src/0_system/config/ConfigService.mjs:306`, `config/index.mjs:46,95`, `config/BotConfigLoader.mjs:96,139` → `ConfigurationError`
- `backend/src/0_system/scheduling/TaskRegistry.mjs:23,63-69` → `SchedulerError`

**Steps:** For each site: read the surrounding function; replace `throw new Error('msg')` with the typed class + a `code` (SCREAMING_SNAKE derived from the message, e.g. `HOUSEHOLD_NOT_FOUND`, `UNKNOWN_SECRETS_PROVIDER`, `ALREADY_INITIALIZED`, `CONFIG_DIR_REQUIRED`, `CONFIG_VALIDATION_FAILED`, `TASK_INVALID`, `TASK_DUPLICATE`). Check each site's callers (`grep -rn "<function name>" backend/`) for `catch` blocks that string-match the old message — if any do, update them to match on `.code`. Gates.

**Exit criteria:**
- [ ] `grep -n "throw new Error" backend/src/0_system/config/ConfigService.mjs backend/src/0_system/config/index.mjs backend/src/0_system/config/BotConfigLoader.mjs backend/src/0_system/scheduling/TaskRegistry.mjs` → 0 hits
- [ ] GATE-UNIT (this is where message-matching callers break — the gate catches them)

**Commit:** `refactor(system): typed ConfigurationError/SchedulerError at config+scheduler throw sites (audit S-5)`

## Task P1.3: 4_api error-middleware adoption — fitness, piano, admin/* first **[BEHAVIOR CHANGE: error bodies]**

Migrated routers stop echoing `err.message` in 500 bodies; clients get `{ error: { code, message } }` with a generic message for unexpected errors. This is the deliberate information-leak fix.

**Files:**
- Read first (the model): `backend/src/4_api/v1/routers/playbackHub.mjs` (:66-88 `statusForError`/`mapPlaybackHubErrors` + how routes use asyncHandler)
- Read: `backend/src/0_system/http/middleware/` — confirm `errorHandlerMiddleware` + `asyncHandler` exports and their exact behavior
- Modify (one router per commit, in this order): `v1/routers/fitness.mjs`, `piano.mjs`, `admin/household.mjs`, `admin/config.mjs`, `admin/apps.mjs`, `admin/scheduler.mjs`, `admin/integrations.mjs`, `local.mjs`, `proxy.mjs`

**Recipe per router:**
1. `grep -n "res.status(500)" <router>` → list of catch blocks.
2. For each route handler: remove the try/catch; wrap the handler in `asyncHandler(...)` (import from the system middleware barrel). **Exception:** keep a catch only where the catch produces a real product behavior (e.g. placeholder image fallback) — judge by whether the catch body does more than log+500.
3. At the bottom of the router factory (before `return router`), add `router.use(errorHandlerMiddleware());` — or, if the router needs typed-error mapping, a small `mapErrors` middleware modeled on playbackHub that switches on `err.code`/`err.status`.
4. Smoke: `GATE-IMPORT`; then if a live dev server is available, curl one happy-path GET per router and one known-404 to confirm shapes (`curl -s localhost:$(node -e "console.log(3112)")/api/v1/fitness/... `— use the env's backend port from `.claude/settings.local.json`; skip if no server).

**Exit criteria (per router):**
- [ ] `grep -c "res.status(500)" <router>` → 0
- [ ] `grep -c "asyncHandler" <router>` ≥ number of async routes
- [ ] Router factory applies error middleware exactly once
- [ ] GATE-UNIT after each router

**Exit criteria (task):**
- [ ] `grep -rln "res.status(500)" backend/src/4_api/v1/routers | wc -l` reduced from ~38 to ≤ 29 (the 9 migrated files at 0)
- [ ] Add rule to audit script? No — this one is grep-tracked in the phase gate instead.

**Commit (per router):** `refactor(api): <router> errors propagate to middleware; stop leaking err.message (audit API-4)`

## Task P1.4: Domain generic-Error sweep — health domain first

**Files:** `backend/src/2_domains/health/services/*.mjs` (~50 of the 130 sites: `HealthArchiveScope` (9), `PeriodResolver`, `PeriodMemory`, `MetricAggregator`, `HealthAnalyticsService` (8 each), `HealthArchiveIngestion`, …)

**Recipe:** For each `throw new Error(msg)` in the folder: classify — bad input → `ValidationError`; broken business rule → `DomainInvariantError`; missing entity → `EntityNotFoundError` (all from `#domains/core/errors/index.mjs`); genuinely infrastructural (fs adapter missing) → leave for the P2.1 relocation, mark `// TODO(P2.1)`. Add a `code`. Check callers for message matching (same as P1.2).

**Exit criteria:**
- [ ] `grep -rn "throw new Error(" backend/src/2_domains/health --include='*.mjs' | grep -v test | wc -l` ≤ 5 (only the TODO(P2.1)-tagged infra ones)
- [ ] GATE-UNIT

**Commit:** `refactor(domains/health): typed domain errors with codes (audit D-6)`

## Task P1.5: Zone SSOT — reconcile threshold drift **[BEHAVIOR CHANGE — investigate first]**

**Files:**
- Modify: `backend/src/2_domains/fitness/entities/Zone.mjs` (becomes SSOT: `ZONE_ORDER`, thresholds, canonical colors)
- Modify: `backend/src/2_domains/fitness/services/ZoneService.mjs` (`getDefaultThresholds`, `getZoneColor` delegate to Zone.mjs)
- Modify: `backend/src/1_adapters/fitness/AmbientLedAdapter.mjs:19` (import `ZONE_ORDER` instead of local literal)
- Modify: `backend/src/1_rendering/fitness/TimelapseFrameRenderer.mjs:350-359` (`zoneMeta` colors keyed off domain constants — theme may map them, but the source values import from the domain)
- Test: `tests/unit/domains/fitness/zoneSSOT.test.mjs`

**Step 1 — INVESTIGATE (do not skip):** Determine which threshold set live sessions actually use. `grep -rn "getDefaultThresholds\|createDefaultZones\|createZonesForDisplay" backend/ frontend/src --include='*.mjs' --include='*.js' --include='*.jsx'` and read the call paths. Also check whether real households define zones in config (per audit S-1, user profiles carry `heart_rate_zones` — defaults may rarely fire). Record findings in the commit body.
**Step 2 — Decide:** Whichever set the *display path* uses (audit says `createZonesForDisplay` → Zone.mjs's 0.7/0.85 set) wins; the other becomes a delegate. If the investigation shows the defaults never fire in practice (all households configure zones), the reconciliation is safe regardless.
**Step 3 — Failing test:**
```javascript
import { describe, it, expect } from 'vitest';
import { Zone, ZONE_ORDER } from '#domains/fitness/index.mjs';
import { ZoneService } from '#domains/fitness/index.mjs';

describe('zone SSOT', () => {
  it('ZoneService default thresholds equal Zone entity defaults', () => {
    const svc = new ZoneService();
    const maxHr = 185;
    const fromService = svc.getDefaultThresholds(maxHr);
    const fromEntity = Zone.createDefaultZones(maxHr);
    for (const z of ZONE_ORDER) {
      expect(fromService[z] ?? null).toEqual(
        fromEntity.find(e => e.name === z)?.min ?? null
      );
    }
  });
});
```
(Adapt accessor names to the real APIs after reading both files — the assertion is "the two sources agree for every zone".)
**Step 4:** Make it pass by delegation, not duplication. **Step 5:** Point AmbientLedAdapter + TimelapseFrameRenderer at the domain constants. **Step 6:** Gates + if a fitness receipt/timelapse unit test exists (`node tests/unit/harness.mjs --only=fitness`), run it.

**Exit criteria:**
- [ ] zoneSSOT test passes
- [ ] `grep -rn "ZONE_ORDER = \[" backend/src | grep -v Zone.mjs` → 0 hits
- [ ] Zone hex colors defined in exactly one backend file: `grep -rn "'#F97316'\|'#ff4d4f'" backend/src | wc -l` → 1 source (theme files may *reference* imported constants)
- [ ] Investigation findings recorded in commit body

**Commit:** `fix(fitness): single source of truth for zone thresholds/order/colors (audit X-5)`

## Task P1.6: Timezone SSOT **[BEHAVIOR CHANGE: ConfigService UTC→LA default]**

**Files:**
- Create: `backend/src/2_domains/core/utils/timezone.mjs` — `export const DEFAULT_TIMEZONE = 'America/Los_Angeles';`
- Modify: `backend/src/0_system/config/ConfigService.mjs:97-98` (household timezone default `'UTC'` → `DEFAULT_TIMEZONE`) and `:575-576` (import the constant)
- Modify: the two `time.mjs` files (defaults reference the constant)
- Test: `tests/unit/config/timezoneDefault.test.mjs`

**Step 1:** Confirm the internal drift still exists: `grep -n "UTC\|America/Los_Angeles" backend/src/0_system/config/ConfigService.mjs`.
**Step 2:** Failing test asserting `getTimezone()` with no configured timezone returns `DEFAULT_TIMEZONE`, and that the household-load default equals it too (read ConfigService's test setup patterns in `tests/unit/config/` for how to construct it).
**Step 3:** Implement; run.
**Step 4:** Reduce the 96 hardcoded literals opportunistically ONLY in `0_system` and `2_domains/core` (the two time.mjs files + ConfigService). The other ~45 files keep their literal defaults for now (they're defaults-of-last-resort and P2/P3 tasks touch many of those files anyway); add no new ones.
**Step 5:** Gates.

**Exit criteria:**
- [ ] `grep -c "America/Los_Angeles" backend/src/0_system/config/ConfigService.mjs` → 0 (imports constant)
- [ ] `grep -n "'UTC'" backend/src/0_system/config/ConfigService.mjs` → 0 hits for the household default path
- [ ] New test passes; GATE-UNIT

**Commit:** `fix(config): one DEFAULT_TIMEZONE; reconcile ConfigService UTC-vs-LA drift (audit X-6)`

## Task P1.7: Utility consolidation — time.mjs (D4), shortId, deepMerge

**Sub-task A — time.mjs:**
1. Read both files fully: `0_system/utils/time.mjs` (230 lines, has extra members incl. the `ts` proxy + configService import) and `2_domains/core/utils/time.mjs` (117 lines, pure).
2. `grep -rn "from '#system/utils/time" backend/src --include='*.mjs' | grep -v test` → list system-copy consumers (~9). `grep -rn "\bts\." backend/src --include='*.mjs' | grep "utils/time"` → find `ts` proxy consumers specifically (grep for `import { ts }` / `, ts`).
3. In `0_system/utils/time.mjs`: delete the duplicated `formatLocalTimestamp`/`parseToDate` bodies; re-export from the domain copy with a compat wrapper preserving the `date = new Date()` default:
   ```javascript
   import { formatLocalTimestamp as _flt, parseToDate } from '#domains/core/utils/time.mjs';
   export { parseToDate };
   export function formatLocalTimestamp(date = new Date(), timezone = DEFAULT_TIMEZONE) { return _flt(date, timezone); }
   ```
4. The `ts` proxy + configService import (audit S-4): if `ts` has ≤3 consumers, replace each with an explicit `formatLocalTimestamp(...)`/`TimestampService` instance created where a configService is already in scope, then delete the proxy and the `import { configService }` line. If it has more consumers, migrate them all — the import must go either way.
5. **Layer note:** `0_system` importing `#domains/core/utils` is technically upward. This is sanctioned by D4 (shared kernel) — add `{ rule: 'system-no-upward', ... }` exemption in the audit script for the exact spec `#domains/core/utils/` (edit RULES: `bad: s => /^#(domains(?!\/core\/utils)|adapters|apps|applications|api|rendering)\//.test(s)`), update the script test.

**Sub-task B — shortId:** grep importers of `#system/utils/shortId.mjs` (audit: 1). Point them at `#domains/core/utils/id.mjs`; delete `0_system/utils/shortId.mjs`; update the utils barrel.

**Sub-task C — deepMerge:** Read all four (`BotConfigLoader.mjs:66`, `configLoader.mjs:83`, `agents/framework/loadAgentConfig.mjs:31`, `emulator/lib/deepMerge.mjs`). Copy the emulator one (handles arrays + undefined) to `backend/src/0_system/utils/deepMerge.mjs` with a unit test covering: nested merge, array-override-wins, undefined-skipped, null-base. Replace the other three with imports. **Careful:** the three had different semantics — after replacing, GATE-UNIT is the tripwire; additionally hand-check one config load path (`node --input-type=module -e "import('./backend/src/0_system/config/configLoader.mjs').then(()=>console.log('OK'))"`).

**Exit criteria:**
- [ ] `grep -rn "function deepMerge" backend/src | wc -l` → 1 (+1 emulator re-export shim if needed)
- [ ] `find backend/src/0_system/utils -name shortId.mjs` → nothing
- [ ] `grep -n "configService" backend/src/0_system/utils/time.mjs` → 0 hits
- [ ] deepMerge unit test passes; GATE-UNIT, GATE-IMPORT, GATE-AUDIT (baseline update for the audit-rule tweak)

**Commit:** `refactor(system): consolidate time/shortId/deepMerge to single sources (audit X-10, S-4)`

## Task P1.8: Household-path SSOT

**Sub-task A — dedupe the three folder-name resolvers:** `YamlSecretsProvider.mjs:103-126` and `configValidator.mjs:50` import `listHouseholdDirs`/`parseHouseholdId`/`toFolderName` from `configLoader.mjs` (which already exports them) instead of re-implementing. Delete the private copies.
**Sub-task B — raw `'household'` joins (20 sites, 9 files):**
```bash
grep -rn "path.join([^)]*'household'" backend/src --include='*.mjs'
```
For each site, replace with the configService/DataService accessor already available in that file's scope: routers/services that already receive `configService` use `configService.getHouseholdPath(<rel>, hid)`; `WeeklyReviewService` (8 sites) instead gains a constructor param `householdDir` (wired from bootstrap via `configService.getHouseholdPath(...)`) — mechanical: `path.join(this.#dataPath, 'household', 'common', X)` → `path.join(this.#householdDir, 'common', X)`. Files without any config access in scope (art adapters): add a `householdDir`/`dataRoot` constructor param and wire at the composition point (grep who constructs them).
**Careful:** verify `getHouseholdPath`'s signature first (`grep -n "getHouseholdPath" backend/src/0_system/config/ConfigService.mjs` and read it).

**Exit criteria:**
- [ ] `grep -rn "path.join([^)]*'household'" backend/src --include='*.mjs' | grep -v 0_system/config | wc -l` → 0
- [ ] `grep -n "#listHouseholdDirs\|#toFolderName" backend/src/0_system/secrets/providers/YamlSecretsProvider.mjs` → 0
- [ ] GATE-UNIT, GATE-IMPORT

**Commit:** `refactor(ddd): household path construction goes through getHouseholdPath (audit X-11)`

## Task P1.9: Route raw-`fetch` adapters through HttpClient (10 files)

**Files (re-grep: `grep -rln "await fetch(\|fetch(" backend/src/1_adapters --include='*.mjs' | grep -v test`):**
`feed/WebContentAdapter.mjs`, `feed/sources/{RedditFeedAdapter,GoogleNewsFeedAdapter,YouTubeFeedAdapter,ABSEbookFeedAdapter,KomgaFeedAdapter,GoodreadsFeedAdapter}.mjs`, `komga/KomgaPagedMediaAdapter.mjs`, `playback-hub/HttpPlaybackHubAdapter.mjs`, `content/media/youtube/YouTubeAdapter.mjs`

**Step 0:** Read `backend/src/0_system/services/HttpClient.mjs` — learn its API (get/post signatures, how it exposes status/body/buffer, its error type) and read ONE existing consumer as the pattern (e.g. grep `httpClient` in `1_adapters` and pick a feed-free example).
**Recipe per file:**
1. Add `httpClient` to the constructor deps (`if (!deps.httpClient) throw new Error('httpClient required')` — match sibling style) OR accept it in the existing deps object.
2. Replace each `fetch(url, opts)` with the equivalent `this.#httpClient` call. Binary responses: check HttpClient for a buffer method; if it lacks one, ADD it to HttpClient (with a unit test) rather than keeping fetch.
3. Where the file throws `new Error(\`Vendor API ${res.status}\`)` — replace with `translateVendorError({ status: res.status }, { op: '<method>' })` from P0.6, logging the vendor detail via `this.#logger.warn?.()` first (audit A-4).
4. Update the constructor call sites (grep the class name; wiring lives in bootstrap/app.mjs) to pass `httpClient` — there is an HttpClient instance in bootstrap already (grep `new HttpClient`).
5. GATE-IMPORT + GATE-UNIT per file (feed adapters have unit tests: `node tests/unit/harness.mjs --only=feed` if that folder exists, else full run).

**Exit criteria:**
- [ ] `grep -rn "await fetch(" backend/src/1_adapters --include='*.mjs' | grep -v test | wc -l` → 0
- [ ] `grep -rn "throw new Error(\`.*API.*status" backend/src/1_adapters/feed | wc -l` → 0
- [ ] Gates pass

**Commit (per 2-3 files):** `refactor(adapters): <files> use system HttpClient + generic vendor errors (audit A-3, A-4)`

## Task P1.10: Harvester + proxy modernization (21 configService-singleton files)

The single biggest adapter-layer cleanup. Three sub-batches, one commit each.

**Sub-task A — the 13 harvesters** (`backend/src/1_adapters/harvester/{fitness/StravaHarvester,communication/GmailHarvester,communication/GCalHarvester,productivity/TodoistHarvester,productivity/ClickUpHarvester,productivity/GitHubHarvester,finance/BuxferHarvester,finance/ShoppingHarvester,social/RedditHarvester,social/LastfmHarvester,social/FoursquareHarvester,fitness/WithingsHarvester,other/WeatherHarvester}.mjs` — re-grep for the accurate list: `grep -rln "import { configService }" backend/src/1_adapters/harvester`).

**Recipe per harvester:**
1. Read the file. Inventory every `configService.` call — both the module-singleton and any injected `this.#configService`.
2. Delete the singleton import. Every value it fetched becomes either (a) a constructor config value (secrets, static config — resolved once at wiring), or (b) a call on an injected narrow function for runtime lookups: constructor gains `getUserAuth` (a `(service, username) => auth` function) when the harvester re-reads per-user auth at runtime (Gmail/Todoist/ClickUp/Strava pattern, audit A-1).
3. **Kill the dual-source pattern:** where the code does `injected || singleton` fallback (GmailHarvester.mjs:195-199 pattern), the constructor-resolved value wins; delete the fallback.
4. Find the wiring point (`grep -rn "new <Name>Harvester" backend/src`) — in bootstrap; resolve the values there (`configService.getSecret(...)` is legal in the composition root) and pass them in.
5. Hardcoded fallbacks (audit A-14): `StravaHarvester.mjs:594` `|| './data/users/...'` and `|| './media'` → delete the fallback; throw `new Error('userDir required')` style instead.
6. GATE-IMPORT after each file.

**Sub-task B — the 5 proxies** (`proxy/{Plex,Immich,Komga,FreshRSS,Audiobookshelf}ProxyAdapter.mjs`): same recipe; additionally each has a bottom-of-file `createX()` factory using the singleton (audit A-11) — **move the factory body to bootstrap** (find the import site: `grep -rn "createPlexProxy\|PlexProxyAdapter" backend/src/0_system backend/src/app.mjs`), and delete the factory from the adapter file. Also `PlexProxyAdapter.mjs:22-28`: move the module-level `shutoffValve` test hook into the constructor config (`config.shutoff = { enabled: false }`) and update whatever test uses `enablePlexShutoff` (grep it).

**Sub-task C — the stragglers:** `hardware/tts/TTSAdapter.mjs`, `hardware/mqtt-sensor/MQTTSensorAdapter.mjs`, `camera/index.mjs` (this one is also a P-1 rogue composition root — here, just remove the singleton usage by having its factory receive `configService` as a parameter from bootstrap; full container-ization is out of scope). Also rename `TTSAdapter` → `OpenAITTSAdapter` (class + file), updating importers (audit A-14) — `grep -rn "TTSAdapter" backend/`.

**Exit criteria:**
- [ ] `grep -rln "import { configService }" backend/src/1_adapters | wc -l` → 0
- [ ] `node scripts/audit-layer-imports.mjs` — `adapters-no-config-singleton` → 0; `--update` baseline
- [ ] GATE-IMPORT, GATE-UNIT after each sub-task
- [ ] `find backend/src/1_adapters -name "TTSAdapter.mjs"` → nothing (renamed)

**Commits:** `refactor(adapters): harvesters receive config via constructor (audit A-1)` / `...proxies...` / `...tts/mqtt/camera + OpenAITTSAdapter rename...`

## Task P1.11: Codify remaining ratchet rules + phase gate

**Files:**
- Modify: `scripts/audit-layer-imports.mjs` — add two content rules (not import-based, so add a second scan pass): count of `res.status(500)` occurrences under `4_api/` (rule `api-handrolled-500`), and count of `{ success: false` under `3_applications/` (rule `apps-success-false`). Implement as simple line-regex counters in the same walk; add to RULES output + baseline.
- Modify: `tests/unit/tooling/auditLayerImports.test.mjs` — cover one of the new rules.

**Exit criteria:**
- [ ] `npm run audit:layers` shows the two new rules with current counts; baseline updated
- [ ] Test passes

**Commit:** `feat(tooling): ratchet res.status(500) and success:false counts`

### PHASE P1 FINAL GATE
- [ ] GATE-UNIT (no new failures), GATE-IMPORT, GATE-AUDIT all green
- [ ] Baseline counts vs P0: `adapters-no-config-singleton` 21→0, `no-applications-alias` 0, raw-fetch adapters 0, deepMerge 1
- [ ] If a dev server is available: boot it (`npm run backend:dev`), hit `/api/v1/fitness/...` happy path + one admin config read, confirm 200s; check `dev.log` for startup errors
- [ ] User approval → merge to main

---

# PHASE P2 — Structural Relocations (branch `refactor/ddd-compliance-p2`)

> Each task here is a *move-and-delegate* refactor. The invariant recipe: (1) create the new home, (2) move code verbatim (no logic edits in the same commit as a move), (3) leave a re-export shim if >3 importers, else update all importers, (4) gates, (5) follow-up commit for any logic cleanup.

## Task P2.1: Health domain relocation

**Files:**
- Create: `backend/src/3_applications/health/archive/` — move `HealthArchiveIngestion.mjs`, `HealthArchiveScope.mjs`, `HealthArchiveScopeFactory.mjs` from `2_domains/health/services/`
- Create: `backend/src/3_applications/health/analytics/` — move the fetch-and-orchestrate services: `MetricAggregator.mjs`, `MetricComparator.mjs`, `MetricTrendAnalyzer.mjs`, `HealthAnalyticsService.mjs`, `PeriodMemory.mjs`, `PeriodResolver.mjs`, `HistoryReflector.mjs`, `WeightProcessor.mjs`, `CalibrationConstants.mjs`
- Keep in domain: `health/policies/PrivacyExclusions.mjs`, entities, and any pure calculators — **inventory first**: read every file under `2_domains/health/services/`; the classification test is "does it hold an injected store/fs/logger and fetch?" (move) vs "pure function of its arguments?" (stay).
- Modify: `2_domains/health/index.mjs` barrel — remove moved exports, add a comment pointing to the new home (pattern precedent: `2_domains/lifelog/index.mjs:9-10`)
- Modify: all importers — `grep -rn "domains/health/services" backend/ cli/ --include='*.mjs'`

**Steps:**
1. Inventory + classify (list in commit body).
2. `git mv` each moving file; update its internal imports (`../..` depths change; prefer `#domains/`/`#apps/` aliases while touching them).
3. Update importers (likely: `3_applications/health/*` use cases, `bootstrap.mjs`, agents health-coach tools, `cli/ingest-health-archive.cli.mjs`).
4. The `// TODO(P2.1)` infra throws from P1.4: now in app layer — convert to typed errors or `ConfigurationError` as appropriate.
5. Also fix the swallowed catches that moved (`HistoryReflector.mjs:40-41,63`, `MetricAggregator.mjs:234-235`): add `this.#logger.warn?.('health.<op>.failed', { error: e.message })` before the degradation.
6. Gates. `node tests/unit/harness.mjs --only=health` if the folder exists.

**Exit criteria:**
- [ ] `grep -rn "node:path\|from 'path'" backend/src/2_domains --include='*.mjs' | grep -v test` → 0 hits
- [ ] `grep -rn "logger" backend/src/2_domains/health --include='*.mjs' | grep -v test | wc -l` → 0 (loggers moved with the services)
- [ ] audit rule `domains-no-node-io` → 0 except `livestream/SourceFeeder` (fixed next task); baseline updated
- [ ] GATE-UNIT, GATE-IMPORT

**Commit:** `refactor(health): relocate archive+analytics services from domain to application layer (audit D-2, D-4)`

## Task P2.2: Remaining domain purity — SourceFeeder, domain ports, clock reads

**Sub-task A — SourceFeeder → adapters:** `git mv backend/src/2_domains/livestream/SourceFeeder.mjs backend/src/1_adapters/livestream/SourceFeeder.mjs`; update importers (`grep -rn "SourceFeeder" backend/src`; expect `3_applications/livestream/ChannelManager.mjs` + livestream barrel); remove from the domain barrel.
**Sub-task B — domain ports (D3):** `git mv backend/src/2_domains/media/ports/IMediaQueueDatastore.mjs backend/src/3_applications/media/ports/`; `git mv backend/src/2_domains/livestream/IAudioAssetResolver.mjs backend/src/3_applications/livestream/ports/` (create `ports/` dirs). Update importers (adapters implementing them + app services). Rewrite the IMediaQueueDatastore header comment that argued against the guideline. **Do NOT touch `ILifelogExtractor`** (deferred, D3).
**Sub-task C — clock reads (audit D-5 list):** For each of: `fitness/entities/Session.mjs:66-81` (4 timelapse mutators), `cost/value-objects/BudgetPeriod.mjs` defaults, `fitness/services/cycleLadder.mjs:18`, `lifeplan/entities/Belief.mjs:70` + `lifeplan/services/BeliefEvaluator.mjs:17`, `health/entities/HealthArchiveManifest.mjs:105`, `gratitude/services/PrintSelectionService.mjs:23`:
- Change the method/function to require a `now` param (Session mutators: `markTimelapseProcessing(now)` etc.).
- Update every caller (grep each method name) to pass `Date.now()` / `new Date()` from the application layer.
- Where the caller IS a renderer or another domain fn, thread the param up until you reach app/API layer.
- `MediaProgress.mjs:40` documents its fallback — leave it (documented pattern), or tighten if trivial.
**Sub-task D — StreamFormat mutable Sets (audit D-13):** `content/value-objects/StreamFormat.mjs:8-9` → export frozen arrays + `isStreamFormat(x)` lookup fns; update consumers (grep `STREAM_FORMATS`).
**Sub-task E — orphaned test:** `git mv backend/src/2_domains/lifelog/services/__tests__/LifelogAggregator.test.mjs tests/unit/applications/lifelog/` (create dir); delete the empty `2_domains/lifelog/services/`.

**Exit criteria:**
- [ ] `grep -rn "child_process" backend/src/2_domains` → 0
- [ ] `find backend/src/2_domains -type d -name ports` → nothing
- [ ] `grep -rn "Date.now()" backend/src/2_domains --include='*.mjs' | grep -v test | wc -l` ≤ 2 (MediaProgress documented fallback + any explicitly-annotated stragglers)
- [ ] audit `domains-no-node-io` → 0; baseline updated; GATE-UNIT

**Commit (per sub-task):** `refactor(domains): <subtask> (audit D-1/D-7/D-5/D-13)`

## Task P2.3: `selectPrimaryMedia` + Strava helpers → domain; fitness app services de-vendored

**Sub-task A:** `git mv backend/src/1_adapters/fitness/selectPrimaryMedia.mjs backend/src/2_domains/fitness/services/selectPrimaryMedia.mjs` and `git mv backend/src/1_adapters/fitness/buildStravaDescription.mjs backend/src/2_domains/fitness/services/buildActivityDescription.mjs` (rename: it builds a description, Strava is just the consumer — check the file first; if it's genuinely Strava-format-specific markup, it stays an adapter and only the import direction gets fixed by having the app service receive it injected). Update importers: `3_applications/fitness/{StravaReconciliationService,FitnessActivityEnrichmentService}.mjs`, `YamlSessionDatastore` (A-2 — next sub-task), bootstrap.
**Sub-task B:** `YamlSessionDatastore.mjs:369-410` — replace the inline "pick primary media" loops with a call to the moved domain service. The datastore hydrates raw media/events; primary derivation happens in the domain fn it now imports (adapters may import domains — legal). Add/extend a unit test in `tests/unit/` capturing current behavior FIRST (characterization: feed it a fixture session YAML shape with 3 media items, assert which is primary — derive the fixture from the current code's logic before changing it).
**Sub-task C — de-vendor the two fitness app services (audit P-2):**
1. Rename `StravaReconciliationService` → `ActivityReconciliationService` (file + class); constructor param `stravaClient` → `activityGateway`; JSDoc de-vendored. Create port `3_applications/fitness/ports/IActivityGateway.mjs` documenting the methods actually called (read the service; list them).
2. The config dig (`fitnessConfig?.plex?.reconciliation_lookback_days`) → constructor receives `{ lookbackDays, selectionConfig }` resolved in bootstrap.
3. Same treatment for `FitnessActivityEnrichmentService` (also remove its `userService` singleton import — inject).
4. Update bootstrap wiring + any scheduler task registrations (`grep -rn "StravaReconciliation\|strava-reconcile" backend/src`). **Keep the scheduler task NAME `fitness:strava-reconcile` unchanged** (it's referenced in ops config/memory).

**Exit criteria:**
- [ ] `find backend/src/1_adapters/fitness -name "selectPrimaryMedia.mjs"` → nothing; audit `apps-no-adapters` count drops by 2+
- [ ] `grep -rn "stravaClient" backend/src/3_applications | wc -l` → 0
- [ ] Characterization test for primary-media selection passes before AND after
- [ ] GATE-UNIT, GATE-IMPORT; baseline updated

**Commits:** one per sub-task.

## Task P2.4: fitness.mjs god-router decomposition (1,739 lines → thin router)

Four extractions, one commit each. After each: the router file shrinks, routes answer identically.

**Sub-task A — FitnessSimulationService:** Create `backend/src/3_applications/fitness/services/FitnessSimulationService.mjs` owning the module-level `simulationState` + `spawn`/`kill` logic (fitness.mjs:61-66, 1145-1203). Constructor: `{ logger }`. Methods: `start(opts)`, `stop()`, `status()`. Router handlers become 3-liners calling it. Wire in bootstrap; inject into `createFitnessApiRouter`. The module-level `new SessionLockService()` (:58) moves to bootstrap wiring too (inject).
**Sub-task B — fingerprint/manage-access:** Create `backend/src/3_applications/fitness/usecases/ManageAccess.mjs` (or extend the existing `#apps/fitness/manageAccessPolicy` the router already imports — READ IT FIRST; the router may be duplicating what the app module half-does). Target: the policy cluster at :1458-1474, :1528-1573, :1605-1637, :1656-1713 lives in app layer with unit tests for the eligibility rules; router keeps req parsing.
**Sub-task C — session queries:** `usecases/QuerySessions.mjs` absorbing :332-347 (relative-date parsing "30d", sort, limit) + :400-411 (enrichment merge). Unit-test the date-window parser (`"30d"`, `"2w"`, absolute dates — read the regex for supported forms).
**Sub-task D — webhook policy + FS leftovers:** the `event.calories > 200` coaching gate (:1298-1313) moves into the existing webhook/enrichment use case path (find where webhook processing lives in `#apps/fitness`); the debug voice-memo write (:956-961) and menu-music dir listing (:1331-1343) move behind injected functions or existing services. `configService.getDefaultHouseholdId()` × 10 → resolve once in the router factory (`const defaultHouseholdId = ...` passed as dep) or via `householdResolver` middleware.

**Exit criteria (task):**
- [ ] `wc -l backend/src/4_api/v1/routers/fitness.mjs` ≤ 700
- [ ] `grep -n "spawn\|process.kill\|readdirSync\|writeFileSync" backend/src/4_api/v1/routers/fitness.mjs` → 0 hits
- [ ] `grep -c "configService.getDefaultHouseholdId" backend/src/4_api/v1/routers/fitness.mjs` ≤ 1
- [ ] No module-scope `new` or `let` state: `grep -n "^const .* = new \|^let " backend/src/4_api/v1/routers/fitness.mjs` → 0 relevant hits
- [ ] New use-case unit tests pass; GATE-UNIT; if dev server available, smoke: session list + simulation status endpoints return 200

**Commits:** one per sub-task, `refactor(api/fitness): extract <X> from god-router (audit API-3)`

## Task P2.5: Admin routers get a real backend

Create `backend/src/3_applications/admin/` with four services; the five routers become thin.

**Files:**
- Create: `3_applications/admin/HouseholdAdminService.mjs` (absorbs `admin/household.mjs:26-153` + CRUD rules), `YamlConfigFileService.mjs` (absorbs `admin/config.mjs` file collection, allow/mask policy, traversal guards — **the security rules move verbatim; write unit tests for path traversal + masking BEFORE moving**), `AppsConfigService.mjs` (`admin/apps.mjs` APP_CONFIGS + read/validate/write), `SchedulerAdminService.mjs` (`admin/scheduler.mjs` jobs.yml CRUD; the fake `POST /jobs/:id/run` 202 → either wire to the real scheduler (`grep -rn "registerTask\|runTask" backend/src/0_system/scheduling`) or return 501), `IntegrationsQueryService.mjs` (`admin/integrations.mjs` merge logic; the `process.env.DAYLIGHT_ENV` read moves to a constructor param).
- Modify: the 5 routers + their wiring (find mount: `grep -rn "createAdminRouter" backend/src`).
- Test: `tests/unit/applications/admin/yamlConfigFileService.test.mjs` — MUST cover: path traversal rejected (`../../etc/passwd`), auth dirs masked in listing, masked file read/write rejected, happy read/write round-trip (use a temp dir fixture).

**Recipe:** per router: write the service test (characterize current behavior from the router code), implement service by moving code, shrink router to param-extraction + service call + (error middleware from P1.3 already in place).

**Exit criteria:**
- [ ] `grep -rn "import fs\|from 'fs\|js-yaml\|yaml'" backend/src/4_api/v1/routers/admin/*.mjs` → 0 hits
- [ ] Security tests pass (traversal, masking)
- [ ] `grep -n "202" backend/src/4_api/v1/routers/admin/scheduler.mjs` → 0 (wired or 501)
- [ ] GATE-UNIT, GATE-IMPORT; audit `api-no-adapters`/`api-no-apps` unchanged or lower (routers now receive services via factory params — note: injecting an app-layer service via params is the SANCTIONED pattern; only *imports* violate)

**Commit (per router):** `refactor(admin): <router> delegates to <Service> (audit API-3)`

## Task P2.6: Piano backend — PianoContainer + use cases

**Files:**
- Create: `backend/src/3_applications/piano/PianoContainer.mjs`, `piano/ports/IPianoStudioStore.mjs` (+ producer/progress stores as needed), `piano/usecases/GetCourseProgress.mjs`, `piano/usecases/GetPlayableUnits.mjs`
- Create: `backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs` (absorbs the router's loadYaml/saveYaml/listYamlFiles/deleteYaml/writeBinary calls + path building from configService)
- Modify: `backend/src/4_api/v1/routers/piano.mjs` (630 → thin), bootstrap wiring

**Steps:**
1. Read `piano.mjs` fully + the three `#apps/piano` helpers it imports (midiFile, courseProgress, loopManifest). The two algorithms (grading/ranking :387-440, co-progress lock :442-559) move into the two use cases; **characterization tests first** — construct minimal progress fixtures and assert current outputs (rank order, `aheadBy`/`rule.buffer` lock results) before moving.
2. Datastore absorbs persistence; use case orchestrates; container wires; router injects container.
3. Remove the `userService` singleton import (:12) — inject resolved user info via middleware/params.
4. Keep URL shapes and response bodies byte-identical (the kiosk frontend depends on them — see `docs/reference/piano/producer.md` for the contract).

**Exit criteria:**
- [ ] `grep -n "loadYaml\|saveYaml\|writeBinary\|getUserDir\|getMediaDir" backend/src/4_api/v1/routers/piano.mjs` → 0
- [ ] Characterization tests for both algorithms pass before and after
- [ ] `wc -l backend/src/4_api/v1/routers/piano.mjs` ≤ 300
- [ ] GATE-UNIT; if piano dev flow testable, smoke `/api/v1/piano/courses/progress`

**Commit:** `refactor(piano): PianoContainer + use cases; router sheds persistence (audit API-3)`

## Task P2.7: Composition-root consolidation

The XL one. Order matters; each sub-task independently shippable.

**Sub-task A — extract bootstrap's inline business logic (audit S-3):**
- `posterProvider` (:1124-1141) → `backend/src/1_adapters/content/media/plex/PlexPosterProvider.mjs` (constructor: `{ host, token, httpClient, logger }`).
- avatar/equipment providers (:1142-1168) → `backend/src/1_adapters/fitness/AssetResolver.mjs` (or similar; constructor takes the base dirs).
- saved-query inline datastore (:578-620) → `backend/src/1_adapters/persistence/yaml/YamlSavedQueryDatastore.mjs`.
- cron expressions (:3510-3517) → read from config (`getHouseholdAppConfig('coaching')` or scheduler config — check where other cron schedules live: `grep -rn "registerTask" backend/src/0_system/bootstrap.mjs | head` and follow the existing pattern); fallback defaults stay as constants passed at wiring.
**Sub-task B — three containers stop importing adapters (D1):** `NotificationContainer`, `NewsReporterContainer`, `LifeplanContainer` — move the `new XAdapter(...)` calls to bootstrap; containers receive instances. Delete the "one place allowed" docstring in NewsReporterContainer; its `DEFAULT_MODEL = 'openai/gpt-4o'` → config value resolved in bootstrap.
**Sub-task C — rogue roots:** `3_applications/devices/services/DeviceFactory.mjs` and `camera/index.mjs`: bootstrap passes an adapter-constructor map / pre-built adapters. Recipe for DeviceFactory: constructor receives `{ adapterFactories }` (an object of `type → (cfg) => adapter` functions built in bootstrap); the six imports move to bootstrap. Same shape for camera. `agents/framework/buildAgentRuntime.mjs` MastraAdapter import → injected. `HeadlineService`'s Google-News constant → config/param. `ListManagementService`'s normalizer import → move those two pure helpers to `2_domains/content/` (read them first — they're pure per audit) or inject.
**Sub-task D — relocate the composition root out of tier 0:**
1. `mkdir backend/src/5_composition`; `git mv backend/src/0_system/bootstrap.mjs backend/src/5_composition/bootstrap.mjs`; `git mv backend/src/0_system/bootstrap backend/src/5_composition/modules`.
2. Update importers: `grep -rn "0_system/bootstrap\|#system/bootstrap" backend/ --include='*.mjs' --include='*.js'` (expect `app.mjs`, `index.js`, maybe tests).
3. Add alias `"#composition/*": "./backend/src/5_composition/*"` (root) / `"./src/5_composition/*"` (backend) to both package.json manifests.
4. Update the audit script: composition-root exemption path becomes `5_composition/`; `system-no-upward` should now approach its true count. `--update` baseline.
5. Update `backend-architecture.md` layer diagram (+ the P0.8 footnote about relocation → now done).
**Sub-task E — move the `create*ApiRouter` factories** out of the old bootstrap into `4_api` router files or `5_composition/modules/*` per-domain modules (they're wiring — modules is the right home). Mechanical cut-paste per factory; GATE-IMPORT after each.

**Deliberately out of scope:** shrinking app.mjs's 1,950-line router section into modules is folded into sub-task E only where a factory already exists; a full app.mjs rewrite is follow-on work — record remaining size in the commit body.

**Exit criteria:**
- [x] `test -d backend/src/0_system/bootstrap` → fails; `test -f backend/src/5_composition/bootstrap.mjs` → passes
- [x] audit `system-no-upward` → 0 (true zero — the exemption now covers only `5_composition/`); baseline unchanged at 0
- [x] `grep -n "fetch(\|readFileSync" backend/src/5_composition/bootstrap.mjs` → 0 (business logic extracted)
- [x] `grep -rn "#adapters" backend/src/3_applications --include='*Container.mjs'` → 0
- [x] GATE-UNIT (410/23), GATE-IMPORT, GATE-REFACTOR (95); dev-server smoke boot: 5 endpoints 200, 0 boot errors

**Status: DONE 2026-07-08.** All 18 `create*ApiRouter*` factories (incl. the content `createApiRouters` aggregate) live in `5_composition/modules/`; bootstrap.mjs 4454 → 3509 lines. app.mjs full modularization remains follow-on.

**Commits:** one per sub-task.

## Task P2.8: UserDataService retirement — delegate, then migrate top consumers

**Step 1 — delegate (safe, mechanical):** read `UserDataService.mjs` and `DataService.mjs` side by side; for every UserDataService method that re-implements path building DataService also does, rewrite the body as a delegation call. Behavior identical; path logic exists once. GATE-UNIT.
**Step 2 — stop the bleeding:** add a `no-userdataservice` content rule to the audit script counting `userDataService` references outside `0_system/config/` (baseline ≈142; ratchet).
**Step 3 — migrate the top 5 consumer files** (by reference count: `grep -rc "userDataService\|UserDataService" backend/src --include='*.mjs' | sort -t: -k2 -rn | head`) to DataService per the deprecation header's mapping. One commit each.
**Deliberately incremental:** full 142-site migration continues opportunistically; the ratchet prevents growth.

**Exit criteria:**
- [ ] Zero path-construction bodies left in UserDataService (all delegate): `grep -n "path.join\|toFolderName" backend/src/0_system/config/UserDataService.mjs | wc -l` ≤ 2 (the delegation imports)
- [ ] Audit rule added + baseline; top-5 consumers migrated; GATE-UNIT

**Commit:** `refactor(config): UserDataService delegates to DataService; ratchet added (audit X-7)`

## Task P2.9: Rendering pass

**Sub-task A — eink data fetching out (R-1):** move `resolveData` from `1_rendering/eink/providers/DataResolver.mjs` to `backend/src/3_applications/eink/DataResolver.mjs`; `EinkRenderer.render(screenConfig, { data })` requires data (throw if absent); `EinkPanelService` (already the caller) fetches then renders. Remove `resolveData` from the rendering barrel. Add warn logging per rejected source while moving (R-9): the moved resolver accepts a `logger`.
**Sub-task B — gratitude selection out (R-2):** the `getSelectionsForPrint` callback (wired where? `grep -rn "createGratitudeCardRenderer" backend/src`) now performs `selectItemsForPrint` and returns `{ items, selectedIds }`; renderer draws what it receives. Move the 2/2 counts from `gratitudeCardTheme.mjs:52-56` to the app-layer call site (config). Renderer's return contract (selectedIds for print-count updates) preserved — check the caller.
**Sub-task C — receipt stats out (R-3):** extend `2_domains/fitness/services/SessionStatsService.mjs` with `computeHrHistogram(hr, zones, {buckets})` (move :606-650 logic incl. zone majority-vote) and `coinsPerMinute`; move event flattening/dedup (:168-236) into a domain fn `normalizeSessionEvents(session)`. Renderer imports these (rendering→domains legal). Unit-test the histogram + event dedup with fixtures derived from current behavior FIRST.
**Sub-task D — themes:** create `eink/einkTheme.mjs` (absorb `DEFAULT_THEME` + Header/Weather/Placeholder font strings via `lib/fonts.mjs` `font()`), `fitness/timelapseFrameTheme.mjs` (COL palette + zone styles keyed off domain constants from P1.5 + the named layout ratios), move receipt's inline 11px font + section heights + zone maps into `fitnessReceiptTheme.mjs`. Wire QRCode theme's dead `label.color`/`sublabelColor` into the renderer with values matching CURRENT rendered output (black text, white box) — behavior-preserving.
**Sub-task E — lib adoption:** both thermal renderers use `lib/CanvasFactory.initCanvas` (fix its default font path first: one import.meta-relative path modeled on TimelapseFrameRenderer.mjs:34; delete the dead `backend/journalist/fonts` fallbacks) and `lib/LayoutHelpers.drawBorder`; add `roundRect` + `drawCover` to LayoutHelpers, dedupe from WeatherWidget/Timelapse/PhotoWidget; dedupe `DAYS`/`MONTHS` into `eink/widgets/lib/`.
**Sub-task F — 0_system/canvas → 1_rendering (S-9):** `git mv backend/src/0_system/canvas backend/src/1_rendering/canvas`; update importers (`grep -rn "#system/canvas\|0_system/canvas" backend/src`) — note eink imports it; `compositeHero` consumer is proxy.mjs komga path (grep). `utils/placeholderImage.mjs` → `1_rendering/placeholder/` with `fontPath` as a parameter (S-10; fix the `process.env.path?.media` dead code). **Watch for a new violation:** if anything in `1_adapters` or `0_system` imported canvas utils, that becomes a forbidden edge — resolve by injection at wiring.
**Sub-task G — NutriReportRenderer (A-12):** `git mv backend/src/1_adapters/nutribot/rendering/NutriReportRenderer.mjs backend/src/1_rendering/nutribot/NutriReportRenderer.mjs`; update the nutribot wiring importer; add `1_rendering/nutribot/index.mjs`.
**Sub-task H — EpaperAdapter peer import (A-6):** constructor gains `renderFn`; bootstrap passes the eink render function; delete the `#rendering` import from the adapter.

**Exit criteria:**
- [ ] `grep -rn "fetch(" backend/src/1_rendering --include='*.mjs' | grep -v test` → 0
- [ ] `grep -rn "selectItemsForPrint" backend/src/1_rendering` → 0
- [ ] audit `adapters-no-rendering` → 0; `rendering-no-adapters-apps` → 0; baseline updated
- [ ] `test -d backend/src/0_system/canvas` → fails
- [ ] Histogram/event characterization tests pass before and after
- [ ] Visual check: if a receipt/timelapse test fixture flow exists (see `docs/_wip/audits/2026-02-15-session-chart-historical-rendering-audit.md` harness or `TimelapseFrameRenderer.test.mjs`), render one before/after and compare dimensions + pixel-diff roughly (or at minimum: renders without throwing)

**Commits:** one per sub-task.

### PHASE P2 FINAL GATE
- [ ] All exit criteria; GATE-UNIT/IMPORT/AUDIT green with baseline substantially lower: `system-no-upward` 0, `domains-no-node-io` 0, `apps-no-adapters` ≤ 2, `api-no-*` reduced
- [ ] Dev-server boot + smoke of: fitness session list, piano course progress, one admin config read, eink render endpoint, gratitude print (if reachable)
- [ ] User approval → merge

---

# PHASE P3 — Plan-First Migrations (branch `refactor/ddd-compliance-p3`)

## Task P3.1: Serialization-ownership migration — plan doc + phase 1 implementation

**Sub-task A — write the migration plan** at `docs/_wip/plans/2026-XX-XX-serialization-ownership-migration.md` (date = when executed):
1. Generate the inventory: `grep -rln "toJSON()" backend/src/2_domains --include='*.mjs' | grep -v test` and same for `static fromJSON`. Table: entity → datastore(s) that call its toJSON/fromJSON (`grep -rn "<Entity>.fromJSON\|\.toJSON()" backend/src/1_adapters`) → migration order (in-memory round-trippers first, then per-datastore).
2. Define the target pattern (from adapter-layer-guidelines Hydration Pattern): datastore `#hydrate(raw) → Entity.create/new Entity`, `#dehydrate(entity) → plain object`; entity loses toJSON/fromJSON; entity gains explicit getters for everything the dehydrator needs.
3. Ratchet: add audit content rule `domains-tojson` counting `toJSON()` definitions under 2_domains (baseline ≈75).
**Sub-task B — implement phase 1 (the in-memory corrupters, audit D-3):**
1. `messaging/services/ConversationService.mjs:101,116` — `Conversation` holds `Message` entities internally (not JSON blobs); `addMessage(message)` takes the entity; the datastore (grep for the conversation store) dehydrates on save. Characterization tests first: round-trip a conversation with 2 messages through the current code, assert the stored shape; then refactor keeping the STORED YAML SHAPE IDENTICAL (only the in-memory representation changes).
2. `gratitude/services/GratitudeService.mjs:77,102,158` — same treatment.
**Sub-task C — ratchet + convention:** audit rule added; `coding-standards.md` gains: "New entities MUST NOT define toJSON/fromJSON; datastores own hydration (see migration plan)."

**Exit criteria:**
- [ ] Migration plan doc exists with full inventory table + ordered phases
- [ ] `grep -n "fromJSON\|toJSON" backend/src/2_domains/messaging/services/ConversationService.mjs backend/src/2_domains/gratitude/services/GratitudeService.mjs` → 0
- [ ] Stored-shape characterization tests prove YAML output unchanged
- [ ] Audit rule `domains-tojson` in baseline; GATE-UNIT

**Commit:** `refactor(ddd): serialization migration plan + phase 1 (messaging, gratitude) (audit D-3)`

## Task P3.2: Neutral content-ID scheme — design doc + inventory (NOT full implementation)

Full `plex:{id}` extirpation is beyond safe mechanical execution — this task produces the design + inventory + first safe step.

**Sub-task A — design doc** at `docs/_wip/plans/2026-XX-XX-neutral-content-id-design.md`:
1. Inventory: `grep -rn "plex:" backend/src frontend/src --include='*.mjs' --include='*.js' --include='*.jsx' | grep -v test | wc -l` + per-layer breakdown; read `2_domains/content/value-objects/ItemId.mjs` (already parses `source:localId`) and `3_applications/devices/contentIdKeys.mjs` (partial neutral scheme).
2. Design: `contentId = {source}:{localId}` as the universal key (already the de-facto format — the problem is code that assumes `source === 'plex'`); enumerate every assumption site; define the gateway seam (`IContentSource.resolve(contentId)`).
3. Phased rollout plan with per-phase exit criteria (this doc is itself executable later).
**Sub-task B — first safe step:** rename vendor-named variables in `3_applications/fitness` suggestion strategies (`plexId` → `contentId` where the value is already a compound id — VERIFY by reading each; where it's a bare ratingKey, wrap at the boundary instead — if ambiguous, document, don't guess). Rename `IFitnessSyncerGateway` → keep as-is UNLESS trivially renameable (it's vendor-named after the FitnessSyncer service; renaming touches bootstrap + adapter — do it if <5 files: `grep -rln "IFitnessSyncerGateway\|FitnessSyncer" backend/src`).

**Exit criteria:**
- [ ] Design doc exists with counted inventory + phased plan
- [ ] Suggestion-strategy renames done with GATE-UNIT green
- [ ] No behavior change (ids are renamed variables, not reformatted values)

**Commit:** `docs(ddd): neutral content-id design + first vendor-name renames (audit P-2)`

### PHASE P3 FINAL GATE
- [ ] GATE-UNIT/IMPORT/AUDIT green
- [ ] Both plan docs reviewed by user
- [ ] Merge on approval

---

# Master Exit Criteria (whole plan)

| Ratchet rule | Start (2026-07-06) | Target after P3 |
|---|---|---|
| `system-no-upward` | ~211 | **0** |
| `adapters-no-config-singleton` | 21 | **0** |
| `apps-no-adapters` | ~11 | **≤ 2** (documented exceptions only) |
| `apps-no-fs` | ~17 | **≤ 5** (P2 relocations; stragglers ticketed) |
| `api-no-adapters` + `api-no-apps` + `api-no-domains` | ~20 files | **≤ 6** (ContentExpression cluster pending shared-contracts decision) |
| `domains-no-node-io` | ~5 | **0** |
| `no-applications-alias` / deep-relative | 7 / 44 | **0 / 0** |
| `api-handrolled-500` | 157 | **≤ 90** (9 routers migrated; rest ratcheted) |
| `domains-tojson` | ~75 | **≤ 73** + ratchet + migration plan |
| Unit tests | baseline | **no new failures; ≥ 15 new tests added** |

Post-merge follow-ups to file (not in this plan): remaining 4_api error-middleware routers, full UserDataService call-site migration, serialization phases 2+, neutral-content-id phases, app.mjs full modularization, remaining timezone literals.
