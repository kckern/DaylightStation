# Unified Gaming big-bang cutover

Status: implementation verified locally on 2026-08-24; deployment pending.

The cutover establishes the thin Gaming kernel, snapshot-plus-journal
coordinator, deterministic mechanics, context-owned rulesets, semantic input
contracts, native surfaces, optional renderers, and the `group-play`
environment as one canonical architecture.

There is one runtime contract. No translator, compatibility route, product
alias, fallback definition, or source-level product pack participates in the
new authority. A session begins from current mounted rules, content, and a
version-pinned experience manifest. Repository source supplies protocols,
rules behavior, adapters, and presenter implementations only.

Franchise identity, characters, encounters, decks, artwork, themes, and copy
are mounted artifacts. They are not source exports, test contracts, CLI
assumptions, or presenter branches.

Completion gates are reducer determinism, authority conformance, idempotency,
revision conflicts, terminal-state rejection, journal corruption recovery,
projection secrecy, authorization, input identity and binding, drawing cleanup,
dice and selection determinism, optional-effect isolation, mounted-artifact
validation, repository import/literal boundaries, and a production frontend
build.

## Verification record

- Final Gaming/component scope: 73 Vitest files and 358 tests passed; the
  assessment regression slice added 6 files and 74 passing tests.
- Final native Gaming slice: 54 tests passed and one mounted-media test skipped;
  no failures.
- Targeted frontend lint: zero errors and zero warnings across Gaming, Piano
  challenge/Card Game adapters, and the runtime browser test.
- Backend Gaming domain, application, persistence, rendering, API, and composition
  modules pass `node --check`.
- Production frontend build completed successfully.
- The 1280x800 Card Game browser regression passes through session creation,
  card selection, challenge preparation, and score engraving.
- All six mounted game bundles and all six version-pinned experience manifests
  validated against the canonical artifact contracts.
- Generic Gaming source, documentation, tests, filenames, and the Piano
  challenge adapter contain no franchise identity. Generic Gaming code also
  rejects franchise-shaped schema fields; unrelated product-specific tooling
  remains outside that boundary.
- Import-boundary tests, canonical-path scans, and `git diff --check` passed.

The repository-wide Vitest gate is not represented as green: its remaining
failures are in concurrent School, printer/Ghostscript, report-card, and
play-log work outside this cutover. Gaming's registry failure from the first
wide run was fixed by migrating the mounted environment configuration from
`gaming/gameshow/config.yml` to `gaming/group-play/config.yml`.
