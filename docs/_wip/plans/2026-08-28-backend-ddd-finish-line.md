# Backend DDD Compliance: Finish-Line Checklist

**Updated:** 2026-08-29
**Status:** Independently signed off; clean integration remains
**Report:** [Backend DDD compliance remediation](../bugs/2026-08-28-backend-ddd-compliance.md)

## Frozen Contract

- [x] Preserve route paths, methods, middleware order, status, headers, body
      envelopes, and values.
- [x] Preserve WebSocket, streaming, download, and proxy behavior.
- [x] Preserve YAML/JSON/JSONL paths, fields, optional values, ordering, dates,
      IDs, and failure semantics.
- [x] Require no backup, rewrite, backfill, or migration.
- [x] Characterize affected behavior before moving ownership.
- [x] Classify rather than globally rewrite HTTP 500 and `success:false`
      contracts.

## Audit and Enforcement

- [x] Add AST coverage for multiline, re-export, CommonJS, and literal dynamic
      imports.
- [x] Add API Node-infrastructure and application-infrastructure rules.
- [x] Add domain ambient-clock and nondeterminism rules.
- [x] Add D3/D7 port graph, zero-importer, and explicit-implementation rules.
- [x] Add domain hierarchy and storage-path rules.
- [x] Add focused rule tests, including false positives.
- [x] Ratchet every confirmed hard rule to zero.
- [x] Add the full-runtime raw-filesystem scanner.
- [x] Run that scanner from a repository pre-commit hook.

## Remediation

- [x] Remove ambient time, entropy, and serialization from domains.
- [x] Make API modules HTTP-only and dependency-injected.
- [x] Remove filesystem, process, network, config-tree, timer, and generic
      event-bus mechanics from applications.
- [x] Move application-facing ports to applications and make adapters declare
      their live contracts.
- [x] Remove adapter peer/rendering dependencies and raw `fs` imports.
- [x] Return system to generic primitives and move feature providers to adapters.
- [x] Move semantic policy out of adapters and the composition root.
- [x] Bind all concrete implementations from composition.
- [x] Preserve exact boundary hydration/dehydration and route translation.

## Compatibility Proof

- [x] API route comparison: no removed literal registrations.
- [x] Stored-shape characterization: legacy record shapes remain intact.
- [x] Parse/conflict-marker gate: 8,758 parsed; 10,110 scanned.
- [x] Layer/AST/application-infrastructure/hierarchy reports: all hard findings
      zero.
- [x] Filesystem gate: 2,398 runtime files; zero violations.
- [x] Refactor suite: 192 passed.
- [x] Unit harness: 480 passed in the pre-sandbox run; a rerun is blocked only
      by this sandbox denying Supertest's ephemeral listener.
- [x] Integrated harness: 55 passed; 4 existing todos.
- [x] Deployment-shaped integration: 2 passed.
- [x] Isolated backend suite: 10,602 passed; 52 explicitly skipped; 3 todos.
- [x] Backend app import passed.
- [x] `git diff --check` passed.
- [x] Centralize the 83 historical API 500 sites without changing their
      responses; ratchet `api-handrolled-500=0` and document the intentional
      `apps-success-false=44` contracts.
- [x] Update the audit and comprehensive remediation report with final evidence.

## Finish Line

- [x] Obtain a fresh independent `gpt-5.6-sol` architecture/compatibility review.
      Final rerun signed off with no P0/P1/P2 finding after independently
      checking the four corrected boundary leaks and Playback Hub serializers.
- [x] Resolve every finding it produced: named screen fallback, receipt renderer,
      Strava access adapter, Telegram identity adapter, kitchen relay watchdog,
      router-owned QR/e-ink/fitness/device/home-volume parsing, typed device
      prewarm/screen-duration input, public presentation selection, Playback
      Hub wire-command translation, and list menu-selection timestamping.
- [x] Re-run affected tests and all static DDD gates after review fixes.
      Affected suite: 5 files / 66 tests passed; layer hard rules are zero;
      filesystem, ESM-link, parse, diff, and app-import gates passed.
- [x] Separate unrelated user work from the final commit. User-authorized
      Homeline Call work is deliberately included because it closes the
      staged timer and module-link boundary; frontend and unrelated Gaming work
      remain outside this integration set.
- [x] Resolve the Homeline boundary overlap: the complete timer-free Call
      application/adapter/API boundary is staged, and the exact staged layer
      audit reports zero hard findings.
- [ ] Commit the complete verified remediation and documentation.
- [ ] Confirm local `main`, `origin/main`, and the deployed homeserver source are
      reconciled without discarding user-owned work. As of 2026-08-29, local and
      origin `main` agree at `0673cdde6`; the clean homeserver checkout is at
      `3d497cf5` (seven commits behind), so it must be fast-forwarded only after
      the verified DDD merge is pushed.
- [ ] Merge the remediation to `main`.
- [ ] Push `main`.
