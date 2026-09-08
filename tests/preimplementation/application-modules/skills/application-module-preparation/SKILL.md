---
name: application-module-preparation
description: Continue the DaylightStation application-module preparation plan using its existing inventories, contract runners, and evidence ledger. Use for preparation progress, remaining investigations, and rehearsal planning.
---

Complete the accepted pre-implementation plan through the detailed Gratitude
rehearsal instructions. Preserve all four objectives: inventory, boundaries,
verification, and implementation cards. Existing source, tests, assets,
manifests, locks, CI and layer guidance remain protected under this scope.

## Resume cheaply

Work in the existing `preimplementation/application-modules` worktree. Run:

```sh
node tests/preimplementation/application-modules/tooling/preparation-status.mjs
```

This reads the existing ledger and reports the last audited checkpoint, Git
scope, recent evidence and next unresolved leaf tasks. It does not execute tests
or certify current source freshness. To focus the report, append an existing
leaf ID, for example `PRE-7.3.2`.

Read the selected task's exact exit in
`docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md`.
Read only its relevant specification and evidence under
`docs/_wip/audits/2026-09-05-application-module-preimplementation/`.
Use `rg` for the named task, contract or source. Avoid loading the whole roadmap,
all inventories, all runner implementations, or historical conversation again.

## Work from existing machinery

- Use the current `tooling/run-*.mjs` runners and `tooling/review-*.mjs`
  inventory generators. Their commands and scope are in the preparation README
  and `command-safety.json`. Inspect implementation when modifying a tool or
  resolving a concrete failure, rather than on every invocation.
- Set `PRE_TOOLCHAIN_ROOT` to the inspected installed checkout when required.
  Runners derive Node from `process.execPath`; do not invent a binary path.
  Use the existing OS profiles and disposable fixture roots.
- A test setup failure is a setup failure. Read its receipt, fix the specific
  preparation defect and retry that command. Preserve original assertions and
  record genuine product failures as separate implementation prerequisites.
- Reuse fresh receipts. Run a generator or test again when a relevant source,
  specification, runner or dependency changes, or a new concern requires it.
  Do not repeat the entire generator chain after a documentation-only edit.
- Add a helper only when it replaces repeated manual work or supplies missing
  contract evidence. Extend an existing runner when its scope fits. Avoid
  building another generalized audit framework or a second progress ledger.

## Close tasks with evidence

Choose a concrete outstanding deliverable and work it through verification and
documentation. If its exit still has missing requirements, retain the open
checkbox and name the remaining evidence. Documented gaps do not satisfy proof
requirements. Preserve the user-required layers-of-abstraction rules; ownership
and physical location do not change allowed dependencies.

After substantive evidence or task-status changes, use the existing commands as
applicable:

```sh
node tests/preimplementation/application-modules/tooling/review-progress.mjs
node tests/preimplementation/application-modules/tooling/progress.mjs
PRE_TOOLCHAIN_ROOT=<installed-checkout> node tests/preimplementation/application-modules/tooling/audit-packet.mjs
```

The review script contains explicit adjudications: update the relevant decision
only when the exit is proved. Never infer completion from a passing subset, a
file's existence or a tool exit alone. Preserve task and phase rollups. Report
leaf counts and concrete deliverables; checkbox ratios are not effort estimates.

Keep updates brief: result, relevant limitation, next executable task. Routine
tool output should be compact JSON; inspect detailed logs only on failure.
Reserve extended reasoning for unresolved ownership, contract or layer decisions.
Request independent review only when required by the accepted plan or user.

The skill lives inside the authorized preparation folder. Its README link makes
it available for explicit reuse; global skill installation is a separate action.
