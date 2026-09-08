# Utility references beyond ordinary imports

`utility-reference-review.json` inventories selected utility references in all
13,083 protected tracked artifacts: 12,983 regular UTF-8 texts, 98 binary files
and two symlinks. Symlinks are not traversed. All 9,273 JavaScript/TypeScript files
parse, including three valid source files containing embedded NUL characters;
binary heuristics must not silently omit those files. Each read is checked
against its protected source hash. No source, test or operator command executes.

The scan resolves whole root paths, module-relative tokens and known aliases,
then checks likely path-construction calls and import expressions. It identifies
**762 references across 557 files**. All 541 source-import edits from the utility
specification have matching reference IDs; those are not added a second time.
There are no unclassified matched utility references or unresolved construction
candidates in this defined scan. This is not a claim about arbitrary evaluated,
runtime-generated or untracked external paths.

## Dispositions and exact changes

| Reference kind | Count | Treatment |
|---|---:|---|
| Existing source-import edits | 541 | Reuse `utility-boundary.json` |
| References inside retiring barrels | 10 | Disappear with gated barrel retirement |
| Source/JSDoc references | 8 | Exact spelling/location updates |
| Piano ID-generator mock targets | 2 | Retarget with the production import; preserve mock factory/hoisting |
| Stale payroll CLI comment | 1 | Replace only the misleading comment; no CLI execution or behavior change |
| Historical/planning references | 182 | Retain baseline paths as source-history evidence |
| Live reference-guide examples/categories | 12 | Exact future spelling updates; preserve semantic rules |
| D4 decision-register references | 2 | Leave settled ruling untouched; migration design supplies location mapping |
| SchoolCalc architecture filter | 1 | Three precise core-error predicate additions, not a platform-wide allowlist |
| Legacy layer-audit fixture references | 3 | Retain old-path tests and add new-path counterparts separately |

The proposal contains **26 additional edit groups in 18 files**: eight source
comments, two mock literals, twelve documentation references, three SchoolCalc
predicates and one complete stale-comment replacement. The JSON records exact
baseline offsets, before/after text and per-file planned hashes. Code results
parse in memory; nothing is applied to protected files.

The two Piano mocks are in `piano.effect-audit.test.mjs` and
`piano.history.test.mjs`. Their new target is
`@daylight/platform/server/system/utils/id`, matching the proposed retained-code
imports. Do not rewrite only production imports and leave the mock addressing
an obsolete module. Actual Vitest module identity, hoisting, partial mock exports
and preexisting fixture behavior still need execution proof.

SchoolCalc's current local source test admits `#domains/` imports but rejects
new public package names. Three domain/application/adapter filters gain only
the exact `@daylight/platform/server/domain/core/errors` spelling. The target is
verified as domain context `core`, rank 0. Existing predicates remain intact;
system clocks, FileIO, rendering, composition and arbitrary platform entries do
not gain admission. Global resolved-target/rank enforcement remains mandatory.

The adapter guide exposes one demand the runtime-only export count missed:
`parseToDate` is part of its documented utility API. The selected pure-time entry
therefore exports it, bringing the proposal to **31 names across 11 entries**:
thirty with current runtime/test consumers and one explicitly documented helper.
The same original pure binding is retained; the clock formatter remains a
different wrapper. The guide names both public time entries without confusing
the two. Directory categories are mapped to directories, not a clock-only entry.

## Cross-boundary findings, not hidden exemptions

Path-construction inspection also records:

- **22 FileIO mocks**, with exact source/call locations and proposed shared-entry
  target, under `FILEIO-MOCK-IDENTITY` (platform test reviewer). Preserve factory,
  hoisting and public/private module identity before adopting that target.
- **23 FileIO dynamic imports**, linked to their existing dependency-edge IDs,
  under `FILEIO-DYNAMIC-IDENTITY`. These are already in the storage import census;
  they are not 23 additional imports. Preserve lazy timing and whether each
  import observes the real module or a test's mock.
- Other source-target constructions remain with their owners. Directory-scanner
  and root-predicate adoption remains `IMP-BASE.02`; a zero unmatched-literal
  result does not prove scanner coverage of new roots.

FileIO's complete mock/namespace/loaded-cache proof, arbitrary computed paths,
native package loading, controller behavior and actual test outcomes are not
certified here. The existing two stale Home Automation imports also remain
separately approved prerequisite repairs. No original test was changed or run
by this scanner.

## Acceptance and integration

The exact edits join **IMP-SHARED.04.1**. Resolve the named FileIO and global
scanner/package gates before calling the whole reference gate complete. Retain
historical and intentional legacy-fixture references by accountable policy;
never suppress them merely to obtain a zero-string search result.

The [combined review](combined-boundary-review.md) applies these 26 changes with
the utility and Feed/Homebot/household source plans in memory. Its four verifier
controls are edit-plan checks, not additional product contract tests or proof
of successful migration.
