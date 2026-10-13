# Open-Source Readiness — Roadmap + Sub-project A (Repo Hygiene) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DaylightStation publishable as an open-source framework that contributors extend in `__app_modules/`, using `__backend/` and `__capabilities/` as-is — with no household data, private infrastructure, or third-party assets in the repo or its history.

**Architecture:** The work splits into seven sub-projects (A–G below), ordered so each leaves `main` deployable. A machine-checked **public-tree audit** (`npm run audit:public`) is built first and enforced in CI; every sub-project widens its rule scope, so "done" is a green audit rather than a judgement. History is rewritten last, once the tree is clean.

**Tech Stack:** Node ESM (`.mjs`), vitest (config at `tests/_infrastructure/config/vitest.config.mjs`), GitHub Actions, `git filter-repo` (G only).

**Spec:** In-chat brainstorm 2026-10-12, owner rulings verbatim:
1. Secrets/household data: "externalize it all if not already, should be in mounted ymls."
2. Household coupling in framework: "should all be externalized."
3. Docs: "each module needs a readme and complex ones their own docs folder."
4. Hygiene: "lets clean up."
5. Newcomer build/run/test: "lets test."
6. Third-party assets: "should all be externalized and provided by installer, no in repo." Explicitly includes Korean textbook fixtures, Lincolnshire OMR manuals, Zebra DS2278 sheet, chess pieces — "in mounted folders only".
7. History: "keep repo, squash history as needed."

Audit evidence (2026-10-12, five read-only sweeps) is summarized per sub-project below.

## Global Constraints

- Nothing household-specific in tracked files: no family names, user ids that resolve to real people, LAN IPs, MACs, `*.kckern.*` hosts, `/Users/kckern` or `/media/kckern` paths, Plex/Buxfer/HA/Telegram ids.
- Household data and secrets live only in the mounted data volume (`data/…` YAML); third-party assets live only in mounted folders populated by an installer.
- Private operational material (deploy/kiosk scripts, internal docs, host notes) moves to a private companion repo, **`/opt/Code/DaylightStation-ops`** (local git repo; owner may push it to a private remote). Nothing is deleted outright before a copy exists there.
- `main` stays deployable after every task; deploys follow `CLAUDE.local.md` (gate first).
- History rewrite (G) runs last, only after A–F are green, and only with the owner's explicit go-ahead at that step.

## Review Focus

1. A path or pattern rule that also matches legitimate public files (e.g. `plans` inside a module path) → must not flag them; rules are anchored.
2. Binary files scanned as text → skipped by extension and NUL-byte sniff, never crash the audit.
3. Moving internal docs breaks the 170 source files that cite them → rewritten to a visible `ops:` pointer, not left dangling.
4. A runtime path that executes a moved script (`SshMediaHostHealer` → `scripts/media-source-heal.sh`) → checked before moving; runtime-used scripts stay or are relocated with their caller.
5. `.gitignore` change from global `*.png` → contributors' images get tracked; private PNGs (audit screenshots) are moved first so un-ignoring does not resurface them.

---

## Roadmap

| # | Sub-project | Owner ruling | Size | Depends on | Plan |
|---|---|---|---|---|---|
| **A** | Repo hygiene + public-tree audit + private ops repo | 4 | M | — | **this document** |
| B | Framework decoupling: household defaults → config | 1, 2 | L | A (audit) | own plan |
| C | Asset externalization + installer | 6 | L | A | own plan |
| D | Module contract (manifest discovery) + READMEs/docs | 3 | L (needs design) | A | brainstorm → spec → plan |
| E | Newcomer build/run/test: example data, CI tests | 5 | M | B, C | own plan (from fresh-clone report) |
| F | Tests/fixtures PII → synthetic; hashed-name guard | 1 | M | A | own plan |
| G | History rewrite + publish | 7 | M | A–F green | own plan, owner go-ahead |

**B — Framework decoupling (evidence):** `'user_1'` fallbacks in ~40 production files (`__backend/src/app.mjs:3597,3743`, fitness/health/feed/journalist/weekly-review compositions) → read head-of-household from household config, fail loudly when absent. `TVControlAdapter.mjs:36-50` HA entities, `TriggerDispatchService.mjs:79` zombie-wake automation, `app.mjs:3783` `defaultDevice: 'livingroom-tv'`, kitchen-relay watchdog (`app.mjs:3381-3392`, `KitchenRelayWatchdog.mjs`), `ListAdapter.mjs:37-43` "Come Follow Me" labels, `America/Los_Angeles` defaults (`configLoader.mjs:71`, `configSchema.mjs:22`) → config with neutral defaults (UTC, no devices). LAN-IP / `*.kckern.net` defaults in CLIs and satellites → config or required env. `_extensions/playback-hub/devices.json` → data volume. Done = `audit:public` household ruleset green for `__backend`, `__capabilities`, `__app_modules` production code.

**C — Assets (evidence):** fonts (35 files, 6.5 MB; `measure.mjs:37` hard-codes repo path), webaudiofont soundfonts (3 MB; fetch script exists), tfjs wasm (copy from `node_modules` at build), `shaka.js` + crt-lab media + CRT/Game Boy shaders, chess pieces, school/piano SVG-Repo icons, `scripture.woff2`, weather PNGs, `paper.jpg`, OMR + DS2278 PDFs, Korean textbook fixtures, piano curriculum `676490.json` → one asset manifest (`assets.manifest.yml`: id, source URL/npm path, licence, sha256, target), `npm run install:assets` populating a mounted `media/vendor/` tree, loaders resolving through one `assetPath(id)` helper; tests stub assets. Done = no third-party binaries tracked; fresh install + `install:assets` renders school PDFs and piano sound.

**D — Module contract (evidence):** 1 of 46 modules/capabilities has a README (stub); none has `docs/`. Adding a module requires editing ~10 central files (`app.mjs`, `bootstrap.mjs`, `routers/index.mjs`, `main.jsx`, `appRegistry.js`, `builtins.js`, `owner-entry-policy.mjs`, `APP_CATEGORIES`, `cli/*`). Needs a design: per-module `module.manifest.mjs` (server install, routes, jobs, kiosk/launcher entries, CLIs, public entries) discovered by glob; then READMEs for all 46, `docs/` for the 15 large ones (move from `__docs/reference/<x>`), a template module, and a contributor guide in `__app_modules/README.md`.

**E — Newcomer path:** builds on the fresh-clone report (install, test, boot, frontend build findings) — an `data.example/` tree that boots a household-less instance, CI running the unit suites, and node:test files moved out of vitest's glob.

**F — Fixtures PII:** real names in tests (`TeacherGate.test.mjs:7`, `GetTeachers.test.mjs`, `DataServiceAuthSessionStore.test.mjs:74`, `reports.render.test.mjs:39`), Telegram user/bot ids, real MACs, camera NVR dumps, real fitness sessions, jamcorder MIDI → synthetic. Guard: a committed list of **SHA-256 hashes** of denied tokens (family names, ids) checked by `audit:public` — the guard ships without revealing the names. Replaces the fail-open `pre-push` pattern file.

**G — History:** pack is 1.45 GiB / 15.5k commits; history holds ~640 MB news videos, `dev.log.2`, firmware `.a` blobs, `data/household` configs, family names (one child's name in ~420 commits). Plan: `git filter-repo` with a path list + the `.pii-scrub` replace map, verify with the hashed guard over all history, then force-push; or squash pre-cutoff history to one commit if filter-repo leaves residue. Owner confirms at the step.

---

## Sub-project A — Repo Hygiene: detailed tasks

### Task A1: Public-tree audit (`npm run audit:public`)

**Files:**
- Create: `scripts/audit-public-tree.mjs`
- Test: `tests/unit/tooling/auditPublicTree.test.mjs`
- Modify: `package.json` (scripts), `.github/workflows/architecture.yml` (step)

**Interfaces — Produces:**
- `PATH_RULES: Array<{ id: string, test: (path: string) => boolean, why: string }>`
- `CONTENT_RULES: Array<{ id: string, re: RegExp, scope: string[], why: string }>` — `scope` = path prefixes the rule applies to (sub-projects B/F widen it)
- `auditPaths(paths: string[]) → Array<{ rule: string, path: string }>`
- `auditContent(path: string, text: string) → Array<{ rule: string, path: string, line: number }>`
- `isProbablyBinary(path: string, buf: Buffer) → boolean`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/tooling/auditPublicTree.test.mjs
import { describe, it, expect } from 'vitest';
import { auditPaths, auditContent, isProbablyBinary } from '../../../scripts/audit-public-tree.mjs';

describe('auditPaths', () => {
  it('flags internal docs folders, build junk and scratch files', () => {
    const v = auditPaths([
      '__docs/_wip/plans/x.md',
      '__docs/superpowers/specs/y.md',
      '__docs/_archive/z.md',
      '__docs/plans/p.md',
      '__docs/notes/n.txt',
      '_extensions/playback-hub/__pycache__/web.cpython-313.pyc',
      '_extensions/portal-keys/app/shell-api/bin/main/A.class',
      '_extensions/portal-keys/app/build/reports/problems/problems-report.html',
      'cli/_tmp_plex_poll.mjs',
      '__app_modules/learning/piano/cli/_proto-graph.mjs',
      'docker/nginx/logs.kckern.net.conf',
    ]);
    expect(v.map((x) => x.path).sort()).toHaveLength(11);
  });

  it('does not flag public files that merely contain the same words', () => {
    expect(auditPaths([
      '__docs/reference/school/README.md',
      '__app_modules/money/finance/server/plans/BudgetPlan.mjs',
      'scripts/audit-public-tree.mjs',
      '__docs/runbooks/dev-server.md',
    ])).toEqual([]);
  });
});

describe('auditContent', () => {
  it('flags private infrastructure markers inside its scope, with the line number', () => {
    const v = auditContent('scripts/x.sh', 'echo ok\nssh homeserver.local uptime\n');
    expect(v).toEqual([{ rule: 'private-host', path: 'scripts/x.sh', line: 2 }]);
  });

  it('flags host paths, personal domains and LAN addresses', () => {
    const text = '/media/kckern/Media\nhttps://logs.kckern.net\n10.0.0.92:2323\n192.168.1.4';
    const rules = auditContent('docker/a.conf', text).map((x) => x.rule);
    expect(rules).toEqual(['host-path', 'personal-domain', 'lan-address', 'lan-address']);
  });

  it('ignores files outside the rule scope (widened by later sub-projects)', () => {
    expect(auditContent('__app_modules/x/cli/a.mjs', 'ssh homeserver.local')).toEqual([]);
  });

  it('allows documentation-reserved example ranges', () => {
    expect(auditContent('scripts/x.sh', 'curl http://192.0.2.10/\ncurl http://10.0.0.0/8')).toEqual([]);
  });
});

describe('isProbablyBinary', () => {
  it('skips by extension and by NUL byte', () => {
    expect(isProbablyBinary('a.png', Buffer.from('x'))).toBe(true);
    expect(isProbablyBinary('a.txt', Buffer.from([0x61, 0x00, 0x62]))).toBe(true);
    expect(isProbablyBinary('a.md', Buffer.from('hello'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run --config tests/_infrastructure/config/vitest.config.mjs tests/unit/tooling/auditPublicTree.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
#!/usr/bin/env node
// scripts/audit-public-tree.mjs
// Public-tree audit: the machine-checked definition of "nothing private in the
// repo". Path rules forbid whole files; content rules forbid markers inside a
// SCOPE of path prefixes — each open-source sub-project widens a scope as it
// cleans that area, so the audit is green at every step and "done" is a rule,
// not a judgement. Exit 1 on any violation.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INTERNAL_DOCS = /^__docs\/(_wip|_archive|superpowers|plans|notes|roadmap|marketing)\//;
const BUILD_JUNK = /(^|\/)(__pycache__\/|.*\.pyc$|.*\.class$|build\/reports\/)/;
const SCRATCH = /(^|\/)(_tmp_[^/]*|_proto-[^/]*)$/;
const PRIVATE_FILES = new Set(['docker/nginx/logs.kckern.net.conf']);

export const PATH_RULES = [
  { id: 'internal-docs', test: (p) => INTERNAL_DOCS.test(p), why: 'internal docs live in DaylightStation-ops' },
  { id: 'build-junk', test: (p) => BUILD_JUNK.test(p), why: 'build output is not source' },
  { id: 'scratch-file', test: (p) => SCRATCH.test(p), why: '_tmp_/_proto- files are scratch' },
  { id: 'private-file', test: (p) => PRIVATE_FILES.has(p), why: 'private infrastructure config' },
];

// Sub-project A scope: tooling, config and root docs. B and F extend it.
const A_SCOPE = ['.claude/', 'docker/', 'scripts/', '.github/', '.githooks/',
  'package.json', 'Readme.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md'];

export const CONTENT_RULES = [
  { id: 'private-host', re: /\b(homeserver\.local|kckern-server|kckern-macbook)\b/, scope: A_SCOPE, why: 'private hostname' },
  { id: 'host-path', re: /\/(Users|media|home)\/kckern\b/, scope: A_SCOPE, why: 'absolute host path' },
  { id: 'personal-domain', re: /\b[\w.-]*kckern\.(net|com|info)\b/, scope: A_SCOPE, why: 'personal domain' },
  // RFC1918 hosts, but not network/example notations (x.x.x.0, /8 CIDR) or RFC5737 doc ranges.
  { id: 'lan-address', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.(?!0\b)\d{1,3}|192\.168\.\d{1,3}\.(?!0\b)\d{1,3})\b(?!\/)/, scope: A_SCOPE, why: 'LAN address' },
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|wasm|woff2?|ttf|otf|mp[34]|webm|wav|mid|sf2|a|o|so|jar|class|pyc)$/i;

export function isProbablyBinary(path, buf) {
  if (BINARY_EXT.test(path)) return true;
  return buf.subarray(0, 8000).includes(0);
}

export function auditPaths(paths) {
  const out = [];
  for (const path of paths) {
    for (const rule of PATH_RULES) if (rule.test(path)) out.push({ rule: rule.id, path });
  }
  return out;
}

const inScope = (path, scope) => scope.some((s) => (s.endsWith('/') ? path.startsWith(s) : path === s));

export function auditContent(path, text) {
  const out = [];
  const rules = CONTENT_RULES.filter((r) => inScope(path, r.scope));
  if (!rules.length) return out;
  text.split('\n').forEach((line, i) => {
    for (const rule of rules) if (rule.re.test(line)) out.push({ rule: rule.id, path, line: i + 1 });
  });
  return out;
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const violations = auditPaths(files);
  for (const path of files) {
    let buf;
    try { buf = readFileSync(path); } catch { continue; }
    if (isProbablyBinary(path, buf)) continue;
    violations.push(...auditContent(path, buf.toString('utf8')));
  }
  for (const v of violations) console.log(`${v.rule}\t${v.path}${v.line ? `:${v.line}` : ''}`);
  console.log(violations.length ? `audit:public FAILED — ${violations.length} violation(s)` : 'audit:public OK');
  process.exit(violations.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4:** re-run the test → PASS (all 7).
- [ ] **Step 5:** add `"audit:public": "node scripts/audit-public-tree.mjs"` to `package.json` scripts; run `npm run -s audit:public` → expect FAIL listing the A-scope files (`.claude/settings.json`, `.claude/skills/prod-config-audit/*`, `docker/nginx/logs.kckern.net.conf`, `scripts/{audit-household-paths.mjs,deploy-gate.sh,media-source-heal.sh,plex-prune-api-devices.sh,reload-piano-kiosk.sh,school-reorg-rehearse.sh}`) plus path-rule hits (`__docs/_wip` etc., junk, scratch). Save the list to the ledger — Tasks A2–A5 drive it to zero.
- [ ] **Step 6:** commit `chore(oss): public-tree audit (path + scoped content rules)`. Do **not** add the CI step yet (it would be red); A6 adds it.

### Task A2: Private ops repo; move private infrastructure out

**Files:**
- Create: `/opt/Code/DaylightStation-ops/` (outside this repo: `git init`, `README.md`)
- Move (git rm here, copy there): `scripts/{deploy-gate.sh,piano-kiosk-idle.sh,livingroom-reading-idle.sh,school-portal-idle.sh,reload-piano-kiosk.sh,plex-prune-api-devices.sh,school-reorg-rehearse.sh,audit-household-paths.mjs}`, `tests/isolated/tooling/auditHouseholdPaths.test.mjs`, `docker/nginx/logs.kckern.net.conf`, `.claude/skills/prod-config-audit/`
- Modify: `.claude/settings.json` (drop the SessionStart SSH hook; move it to `.claude/settings.local.json`, already gitignored), `package.json` (drop scripts pointing at moved files), `CLAUDE.local.md` + memory notes (gate path → ops repo)

- [ ] **Step 1:** Check runtime callers before moving: `git grep -n "media-source-heal" -- __app_modules __backend __capabilities` — `SshMediaHostHealer.mjs:8` references `scripts/media-source-heal.sh`. Read how it is invoked (`sed -n 1,60p __app_modules/media/media/server/adapters/SshMediaHostHealer.mjs`). If the app executes it over SSH on the host by an installed path, move it with the other ops scripts and make the installed path come from config (`media.healer.scriptPath`); if it executes the repo copy, keep it in the repo and genericize its hard-coded `/media/kckern` root to a required argument. Record which in the ledger.
- [ ] **Step 2:** `mkdir -p /opt/Code/DaylightStation-ops/{scripts,docker,claude-skills} && cd /opt/Code/DaylightStation-ops && git init -q` ; write `README.md`:

```markdown
# DaylightStation-ops (private)

Household-specific operations for one DaylightStation deployment: deploy gate,
kiosk scripts, host config, and the project's internal design history. Never
published. The public framework lives in ../DaylightStation.
```

- [ ] **Step 3:** copy then remove: `cp -p` each listed file into the ops tree (preserving relative paths under `scripts/`, `docker/`, `claude-skills/`), commit there (`git -C /opt/Code/DaylightStation-ops add -A && git -C … commit -m "import ops scripts from DaylightStation"`), then `git rm` them here.
- [ ] **Step 4:** fix references: update `package.json` scripts that call moved files (`audit:paths` etc.: remove), `scripts/build-daylight.sh` unaffected. Update `CLAUDE.local.md` deploy commands from `./scripts/deploy-gate.sh` to `/opt/Code/DaylightStation-ops/scripts/deploy-gate.sh` (gate scripts resolve sibling idle scripts by `$(dirname "$0")` — verify with `grep -n 'dirname' …/deploy-gate.sh`). Update the memory notes that name the gate path.
- [ ] **Step 5:** `.claude/settings.json`: remove the `SessionStart` hook block; put the identical block in `.claude/settings.local.json` (verify ignored: `git check-ignore .claude/settings.local.json`).
- [ ] **Step 6:** verify the gate still runs from its new home: `/opt/Code/DaylightStation-ops/scripts/deploy-gate.sh; echo $?` → prints the same five-surface report.
- [ ] **Step 7:** `npm run -s audit:public | grep -cE "^(private-|host-path|personal-domain|lan-address)"` → 0 for these files; commit `chore(oss): move private ops scripts and host config to DaylightStation-ops`.

### Task A3: Internal docs out; references rewritten

**Files:**
- Move: `__docs/{_wip,_archive,superpowers,plans,notes,roadmap,marketing}/`, `__docs/{project-history.md,_docs-last-updated.txt,docs-last-updated.txt}` → `/opt/Code/DaylightStation-ops/docs/`
- Modify: the ~170 non-docs files and 63 reference/runbook docs that cite those paths; `CLAUDE.md` "Documentation Management"; `.gitignore`, `.githooks/pre-push` references

- [ ] **Step 1:** `rsync -a __docs/{_wip,_archive,superpowers,plans,notes,roadmap,marketing} /opt/Code/DaylightStation-ops/docs/` (+ the three loose files); commit in the ops repo.
- [ ] **Step 2:** rewrite citations to a visible private pointer (keeps provenance, never dangles silently):

```bash
git grep -lzE "__docs/(_wip|_archive|superpowers|plans|notes|roadmap|marketing)/" -- . ':(exclude)__docs/_wip/**' ':(exclude)__docs/_archive/**' ':(exclude)__docs/superpowers/**' ':(exclude)__docs/plans/**' ':(exclude)__docs/notes/**' ':(exclude)__docs/roadmap/**' ':(exclude)__docs/marketing/**' \
  | xargs -0 sed -i -E 's#__docs/(_wip|_archive|superpowers|plans|notes|roadmap|marketing)/#ops:docs/\1/#g'
```

- [ ] **Step 3:** `git rm -r -q __docs/{_wip,_archive,superpowers,plans,notes,roadmap,marketing} __docs/project-history.md __docs/_docs-last-updated.txt __docs/docs-last-updated.txt`.
- [ ] **Step 4:** `CLAUDE.md`: replace the `_wip`/`_archive` rules in "Documentation Management" with: public reference docs stay in `__docs/reference/` and module `docs/` folders; plans, audits, bugs and archive go to `/opt/Code/DaylightStation-ops/docs/` (path in `.claude/settings.local.json` `env.ops_docs`). Update the superpowers spec/plan default location note the same way.
- [ ] **Step 5:** run the whole vitest unit gate (`npm run test:unit:vitest`) and `npm run -s audit:links` → no new failures vs a baseline taken before Step 2 (citations are comments/markdown; any failure means a citation was code — fix by reverting that file's rewrite and recording it).
- [ ] **Step 6:** `npm run -s audit:public | grep -c "^internal-docs"` → 0; commit `chore(oss): internal docs to DaylightStation-ops; citations become ops: pointers`.

### Task A4: Build junk, scratch files, one-off migrations

**Files:** `git rm` the 7 junk paths and 29 `_tmp_`/`_proto-` files listed by A1; copy-then-remove one-offs to `/opt/Code/DaylightStation-ops/retired/`: `cli/{backfill-media-durations.mjs,backfill-toc-offset.cli.mjs,chess-backfill.cli.mjs,headline-image-backfill.cli.mjs,health-budget-settings-migrate.cli.mjs,migrate-list-configs.mjs,migrate-saved-meals-to-templates.mjs,migrate-watch-history.mjs,nutrition-auditor-backfill.cli.mjs,paged-media-toc-backfill.cli.mjs,piano-game-rivalry-backfill.cli.mjs,piano-producer-migrate.cli.mjs,rings-migration.mjs}`, `cli/migrations/`, `cli/scripts/{backfill-*,migrate-*}`, `scripts/{migrate-*.mjs,migrate-content-structure.sh,update-test-imports.mjs,school/migrate-issued-artifacts.mjs}`, `scripts/migrations/` — **plus** each `cli/` wrapper's module-side target when the target is itself a one-off.

- [ ] **Step 1:** for every one-off, check it is not imported: `git grep -n "<basename>" -- . ':(exclude)__docs/**'` ; anything imported by non-retired code stays (ledger it).
- [ ] **Step 2:** copy to ops `retired/` preserving paths, commit there; `git rm` here; drop matching `package.json` scripts (`chess:*`/`piano-games:*` backfills, `ingest:health-archive` if retired, the dangling `smoke:yaml`).
- [ ] **Step 3:** `npm run test:unit:vitest` + `npm run -s audit:links` → no new failures vs baseline; `npm run -s audit:public | grep -cE "^(build-junk|scratch-file)"` → 0.
- [ ] **Step 4:** commit `chore(oss): remove build junk, scratch files and retired one-off migrations`.

### Task A5: `.gitignore` and untracked clutter guards

**Files:** `.gitignore`

- [ ] **Step 1:** replace the global `*.png` ignore (`.gitignore:210`) with scoped ignores for generated output only (`test-results/`, `**/__screenshots__/actual/`, `_appschool.tmp.png` pattern `*.tmp.png`); confirm no private PNG becomes tracked: `git status --short --ignored=no | grep -E "\.png$"` → only intended files (audit screenshots already left with A3).
- [ ] **Step 2:** ignore the stale pre-restructure roots so a careless `git add` cannot resurrect them: add `/backend/`, `/docs/`, `/modules/`, `/capabilities/`, `/recording-analysis/`, `/data-drafts/`, `/households/`, `/test-results/`, `/dev.log*`.
- [ ] **Step 3:** `git status --short | head` → no new untracked entries; commit `chore(oss): scoped .gitignore; guard stale pre-restructure roots`.

### Task A6: Community files, CI enforcement

**Files:**
- Create: `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, contact = repo security email from `SECURITY.md`), `SECURITY.md` (private reporting via GitHub Security Advisories; secrets never in issues), `.github/ISSUE_TEMPLATE/{bug_report.md,feature_request.md}`, `.github/PULL_REQUEST_TEMPLATE.md` (checklist: tests, `npm run audit:public`, module README updated), `NOTICE` (header + "third-party assets are installed by `npm run install:assets`; see `assets.manifest.yml`" — C fills the list)
- Modify: `Readme.md` (add "Architecture for contributors": `__app_modules/` vs `__backend/` + `__capabilities/`, link to `__app_modules/README.md`), `.github/workflows/architecture.yml` (add `npm run audit:public` step)

- [ ] **Step 1:** write the files (contents as described; Covenant text verbatim from contributor-covenant.org v2.1).
- [ ] **Step 2:** `npm run -s audit:public` → `audit:public OK`. If anything remains, it is A-scope and must be fixed here, not allow-listed.
- [ ] **Step 3:** add the CI step after the existing audits:

```yaml
      - name: Public-tree audit (no private data)
        run: npm run audit:public
```

- [ ] **Step 4:** commit `chore(oss): community files; enforce audit:public in CI`; push only with the owner (pushes are outward-facing).

**A is done when:** `npm run audit:public` → OK in CI; `DaylightStation-ops` holds every moved file; `main` deploys (gate run from the ops repo) and the unit gate shows no new failures.
