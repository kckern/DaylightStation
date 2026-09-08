# Runner selection and command reconciliation

`runner-review.json` and each file's `caseExpansion` in `test-population.json`
separate static declarations, actual files-only selection, and actual assertions.
All discovery below used fresh evidence and the existing installed dependencies
read-only. No test bodies, live services, global setup or controller were started.

| Actual reviewed command projection | Selected files | Meaning |
|---|---:|---|
| Root Vitest policy | 3,886 paths / 3,821 canonical files | 65 symlink aliases and five exclusions reconciled separately |
| Dedicated frozen-census Vitest discovery | 3,826 | Canonical tracked test file census, not normal runner ownership |
| Root Jest `--listTests --runInBand` | 1,521 | Includes 992 Vitest, 37 node:test and 186 Playwright import owners; not 1,521 runnable Jest suites |
| Backend Jest `--listTests --runInBand` | 0 | Current `__tests__`/`spec` rules select no files |
| Isolated harness `--dry-run` | 2,182 | 2,086 explicit Vitest imports plus 96 globals; includes frontend colocated tests |
| `test:backend` exact harness arguments plus `--dry-run` | 850 | 795 explicit Vitest imports plus 55 globals, all selected from `tests/isolated` |
| Legacy unit harness `--dry-run` | Command only | Captures exact anchored Jest selection and explicit Vitest exclusions, not test execution |

The root Jest count is the configuration's broad selection, not the narrower
`test:unit` harness's execution population. Neither the empty backend selection
nor a discovered wrong-runner file is a passing product result.

## Case population accounting

The AST review records source positions, literal/computed titles, suites versus
cases, `.each` syntax/literal table sizes, skip/todo/conditional modifiers and
enclosing loops. Counts describe syntax, not expanded executable cases. Aliased
test APIs and callback-created cases need their file's source review as well.
Every file has an attributed `CASE-EXPANSION-...` gap with a test-owner next action.
Selected actual execution is linked separately to immutable RUN receipts.

Full case collection for the remaining tree would import test modules. It is
not performed just to turn an inventory into a green-looking count. Imports,
setup, household access and external effects must be reviewed per affected owner
before collection under its correct runner. This disposition satisfies inventory
accounting, not the later required baseline or missing-test negative-proof gates.

## Unsafe discovery paths—not executed

- Integrated harness calls `ensureHouseholdDemo()` **before** checking dry-run;
  it can spawn a generator and write existing infrastructure.
- Live harness loads configured environments and fetches backend health **before**
  dry-run. Read-only HTTP intent is not an effect-isolation boundary.
- Playwright configuration evaluates `getAppPort`; collecting cases imports test
  modules. Normal execution starts `npm run dev` and permits existing-server reuse.
- `node --test` runs tests; it is not a safe files-only listing command.
- `npm test` has a port-killing pretest. The Vitest ratchet executes cases and
  writes a repository report; `--update` also changes its baseline. Neither ran.

## Exact follow-up split inside IMP-BASE.03

Keep these as separately reviewed changesets; none is performed here:

1. **Documentation-only correction:** `docs/ai-context/testing.md` must describe
   the actual `test:backend` expansion, current runner/import ownership, current
   `#` aliases/layer paths and synthetic-only preparation policy. Remove claims
   that missing `scripts/test-backend.mjs` is the current command implementation.
   Acceptance: every documented command/path resolves and matches manifest source.
2. **Pure discovery entry:** `tests/_infrastructure/harnesses/integrated.harness.mjs`
   and `live.harness.mjs` must return their discovery result before generators,
   environment-target reads or backend probes. Tests must make those effects throw
   during discovery and still find the expected files. Ordinary execution keeps
   its required setup; do not simply remove it.
3. **Runner ownership enforcement:** `backend/jest.config.js`, `jest.config.js`,
   `isolated.harness.mjs`, `scripts/gate-vitest.mjs`, and root script definitions
   need an approved ownership matrix before changing globs. A correctly owned
   canary must be collected and execute; a removed/misrouted canary must fail the
   gate. Preserve every canonical baseline file's disposition and known failures.
   Do not change `test:backend` by name alone or accept an empty result.
4. **Missing script resolution:** decide whether root `smoke:yaml` should target
   an existing equivalent suite or be removed as stale documentation/API. Adding
   a success-only replacement script is forbidden. Exact choice depends on the
   contract owner's reviewed existing coverage, not this inventory.
5. **Historical fixture repair:** reproduce the separately recorded Piano failures
   safely before editing either router or composition fixtures. No failure count
   is grandfathered or baseline ratchet increased by this preparation.

Before/after verification uses the dedicated discovery commands and the canonical
source ledger. New owner paths must be included explicitly; old path aliases must
not inflate counts. Discovery receipt freshness is tied to the harness/config
hashes. The preparation files use `.case.mjs` intentionally and remain outside
ordinary test globs unless a later approved command explicitly owns them.
